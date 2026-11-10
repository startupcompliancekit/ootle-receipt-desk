import { analyze, parsePacket, privateSummary, reconcile, csv, units, SCHEMA, INDEXER } from './receipt.js';
import { lookup, recent } from './client.js';

const $ = id => document.getElementById(id);
let packet = null, report = null, busy = false;
const tray = [];
const text = (id, value) => { $(id).textContent = value; };
const message = value => text('notice', value);
const element = (tag, value, className) => { const e = document.createElement(tag); if (value !== undefined) e.textContent = value; if (className) e.className = className; return e; };
function download(name, value, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'], { type }));
  const a = element('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function action(fn) {
  if (busy) return;
  busy = true; message('Opening evidence…');
  document.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try { await fn(); } catch (e) { message(e.message); }
  finally { busy = false; document.querySelectorAll('button').forEach(b => { b.disabled = false; }); $('tray-csv').disabled = !tray.length; }
}

function render(value) {
  const next = analyze(value); // Keep the previous valid result on parser failure.
  packet = value; report = next;
  $('empty-state').hidden = true; $('receipt').hidden = false; $('export-panel').hidden = false;
  text('provenance', value.origin === 'live' ? 'LIVE INDEXER RESPONSE' : value.origin === 'imported' ? 'IMPORTED · NOT AUTHENTICATED' : 'RECORDED NETWORK RESPONSE');
  text('outcome-title', report.title); text('outcome-explanation', report.explanation);
  $('outcome-block').className = 'outcome ' + report.status;
  text('outcome-icon', report.status === 'success' ? '✓' : report.status === 'fee-only' ? '!' : '?');
  text('receipt-id', report.id); text('receipt-network', report.network === 'esmeralda' ? 'Esmeralda · testnet' : report.network);
  text('receipt-epoch', report.receipt?.epoch ?? 'Not established');
  text('receipt-observed', report.observedAt.replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC'));
  const fees = report.receipt?.fees;
  text('fee-paid', fees ? units(fees.paid) : 'Unknown'); text('fee-raw', fees ? fees.paid + ' µTARI · testnet' : 'No receipt available');
  text('fee-refund', fees ? units(fees.refunded) : 'Unknown'); text('fee-overcharge', fees ? units(fees.overcharge) : 'Unknown');
  const state = report.receipt?.state;
  text('state-summary', state ? `${state.written} substates written · ${state.removed} removed without a later version${report.status === 'fee-only' ? ' · fee intent only' : ''}` : 'No committed state summary available.');
  const events = report.receipt?.events ?? [];
  text('event-count', String(events.length)); $('events-list').replaceChildren();
  if (!events.length) $('events-list').append(element('p', 'No public events in this receipt. Hidden amounts and recipients cannot be inferred.'));
  for (const event of events) {
    const row = element('div', undefined, 'event'); row.append(element('code', event.topic));
    row.append(element('pre', JSON.stringify(event.payload, null, 2))); $('events-list').append(row);
  }
  text('assurance', report.assurance); $('coverage').replaceChildren();
  const facts = { 'Indexer version': report.indexerVersion, 'Transaction retention (epochs)': report.transactionRetention ?? 'unknown',
    'Receipt retention (epochs)': report.receiptRetention ?? 'unknown', 'Response codes': Object.entries(report.responses).map(([k, v]) => `${k}: ${v === 0 ? 'unavailable' : v}`).join(' · '),
    'Lookup endpoint': INDEXER, 'Finalized timestamp': report.finalizedAt ?? 'not supplied' };
  for (const [label, value] of Object.entries(facts)) $('coverage').append(element('dt', label), element('dd', String(value)));
  const steps = {
    success: 'For a payment: reconcile the expected resource, recipient and amount with the receiving wallet ledger. A public commit alone is not enough.',
    'fee-only': 'For support: share the outcome and fee amount. Investigate the failing action before submitting another transaction; this desk never resubmits one.',
    unknown: 'Check the network and transaction ID, then retry the lookup or import a saved receipt. A pruned or missing record does not establish the outcome.',
    pending: 'Check this same transaction again after finalization. A second send could duplicate the intended action.',
    rejected: 'Review the original wallet or application error before trying again. This desk cannot fix or resend the transaction.',
    aborted: 'Inspect the original execution result and input state before retrying. This desk only reads.',
    conflict: 'Keep this item unresolved. Compare the receipt with another trusted source before treating it as settled.'
  };
  text('next-step', steps[report.status]);
  message(value.origin === 'live' ? 'Lookup finished. Results are reported by the indexer, not independently proof-verified.' : 'Saved evidence loaded locally. No live check has been made.');
}

document.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', () => action(async () => {
  const response = await fetch(`./fixtures/${button.dataset.demo}.json`, { credentials: 'omit' });
  if (!response.ok) throw new Error('Recorded example could not be loaded.');
  const value = parsePacket(await response.text()); value.origin = 'saved'; render(value);
  if (innerWidth < 621) $('notice').scrollIntoView({ behavior: 'smooth', block: 'start' });
})));

$('lookup-form').addEventListener('submit', e => { e.preventDefault(); action(async () => render(await lookup($('transaction-id').value))); });
$('recheck').addEventListener('click', () => action(async () => render(await lookup(report.id))));
$('recent-button').addEventListener('click', () => action(async () => {
  const rows = await recent(); $('recent-list').replaceChildren();
  for (const row of rows) {
    const b = element('button', row.id.slice(0, 18) + '…', 'recent-item'); b.append(element('small', row.outcome));
    b.addEventListener('click', () => action(async () => { $('transaction-id').value = row.id; render(await lookup(row.id)); }));
    $('recent-list').append(b);
  }
  message('Recent sample fetched. Choose an ID to inspect its receipt; absence from this list proves nothing.');
}));

$('import-file').addEventListener('change', e => action(async () => {
  const file = e.target.files[0]; if (!file) return;
  if (file.size > 2000000) throw new Error('Evidence file exceeds 2 MB.');
  render(parsePacket(await file.text()));
  $('import-file').value = '';
}));

$('download-summary').addEventListener('click', () => download('receipt-summary.json', privateSummary(report, $('include-id').checked)));
$('download-evidence').addEventListener('click', () => {
  // Only the reviewed public receipt and selected node metadata travel. Never
  // re-export arbitrary imported fields, wallet data, signatures or logs.
  const info = packet.responses.info?.body ?? {};
  const selectedInfo = Object.fromEntries(['network', 'network_byte', 'version', 'transaction_retention_epochs', 'transaction_receipt_retention_epochs'].filter(k => info[k] !== undefined).map(k => [k, info[k]]));
  const responses = { info: { status: packet.responses.info?.status ?? 0, body: selectedInfo } };
  if (packet.responses.receipt?.status === 200) responses.receipt = { status: 200, body: { receipt: packet.responses.receipt.body.receipt } };
  // Export pending/rejection/abort observations without custom free text.
  if (!report.receipt && packet.responses.result?.status === 200) {
    const result = packet.responses.result.body?.result;
    if (result === 'Pending') responses.result = { status: 200, body: { result: 'Pending' } };
    else if (result?.Rejected) responses.result = { status: 200, body: { result: { Rejected: { details: 'Details omitted from export.' } } } };
    else if (report.status === 'aborted') responses.result = { status: 200, body: { result: { Finalized: { final_decision: 'Abort' } } } };
  }
  // Preserve contradictions instead of laundering them into a clean commit.
  if (report.status === 'conflict') { message('Conflicting evidence cannot be exported as a clean packet. Keep the original file and investigate.'); return; }
  download('receipt-evidence.json', { schema: SCHEMA, network: report.network, transactionId: report.id,
    observedAt: report.observedAt, origin: 'saved', source: INDEXER, responses });
});
$('print-receipt').addEventListener('click', () => window.print());

function renderTray() {
  $('tray-body').replaceChildren(); $('tray-totals').replaceChildren(); $('tray-csv').disabled = !tray.length;
  if (!tray.length) { const tr = element('tr', undefined, 'tray-empty'), td = element('td', 'Your tray is empty. Nothing is stored after this page closes.'); td.colSpan = 5; tr.append(td); $('tray-body').append(tr); return; }
  for (const group of reconcile(tray)) $('tray-totals').append(element('div', `${group.network} · ${group.committed} committed · ${group.feeOnly} fee-only · ${group.unresolved} unresolved · ${units(group.fees)} TARI fees`, 'total-chip'));
  tray.forEach((row, i) => {
    const tr = element('tr'); const td = element('td'); td.append(element('code', row.id.slice(0, 12) + '…')); tr.append(td);
    tr.append(element('td', row.network), element('td', row.title), element('td', ['success', 'fee-only'].includes(row.status) ? units(row.receipt.fees.paid) : '—'));
    const removeCell = element('td'), remove = element('button', '×', 'text-button'); remove.setAttribute('aria-label', `Remove ${row.id.slice(0, 12)}`);
    remove.addEventListener('click', () => { tray.splice(i, 1); renderTray(); }); removeCell.append(remove); tr.append(removeCell); $('tray-body').append(tr);
  });
}
$('add-tray').addEventListener('click', () => {
  if (tray.length >= 50) { message('Tray limit is 50 transactions. Export and clear it before adding more.'); return; }
  try { reconcile([...tray, report]); tray.push(report); renderTray(); message('Added to your temporary reconciliation tray.'); }
  catch (e) { message(e.message); }
});
$('tray-csv').addEventListener('click', () => download('ootle-reconciliation.csv', csv(tray, $('include-id').checked), 'text/csv'));
$('clear-tray').addEventListener('click', () => { tray.length = 0; renderTray(); message('Reconciliation tray cleared.'); });
