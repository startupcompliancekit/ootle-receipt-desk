import { decodeBase64, printable } from './cbor.js';

export const SCHEMA = 'ootle-receipt-desk/v1';
export const INDEXER = 'https://ootle-indexer-a.tari.com';
export const NETWORK = 'esmeralda';
export const MAX_PACKET_BYTES = 2000000;

export function transactionId(value) {
  if (typeof value !== 'string') throw new Error('Enter a transaction ID.');
  const id = value.trim().replace(/^txreceipt_/, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Use a 64-character hexadecimal transaction ID or txreceipt_ address.');
  return id;
}

function array(value, min, label) {
  if (!Array.isArray(value) || value.length < min) throw new Error(`Unsupported ${label} layout.`);
  return value;
}

export function unsigned(value, label = 'amount') {
  if ((typeof value === 'number' && !Number.isSafeInteger(value)) ||
      !['number', 'bigint', 'string'].includes(typeof value) || !/^\d+$/.test(String(value))) {
    throw new Error(`Invalid ${label}.`);
  }
  const n = BigInt(value);
  if (n > 18446744073709551615n) throw new Error(`${label} exceeds u64.`);
  return n;
}

export function units(value, decimals = 6) {
  const n = unsigned(value), scale = 10n ** BigInt(decimals);
  return `${n / scale}.${String(n % scale).padStart(decimals, '0')}`;
}

// Numeric field positions pinned to tari-ootle 8d847b6, transaction_receipt.rs,
// fees/mod.rs and events.rs. Unknown outcomes fail closed.
export function decodeReceipt(encoded) {
  const r = array(decodeBase64(encoded), 6, 'receipt');
  const variant = array(r[0], 2, 'outcome');
  const outcome = variant[0] === 0 ? 'Commit' : variant[0] === 1 ? 'FeeIntentCommit' : null;
  if (!outcome) throw new Error('Unknown receipt outcome; update the decoder before relying on it.');
  const diff = array(r[1], 2, 'state summary');
  const up = array(diff[0], 0, 'written substates'), down = array(diff[1], 0, 'removed substates');
  const fee = array(r[4], 5, 'fee receipt');
  const paid = unsigned(fee[1]), payment = unsigned(fee[0]), overcharge = unsigned(fee[2]), burn = unsigned(fee[4]);
  if (paid > payment || overcharge > paid || burn > paid) throw new Error('Inconsistent receipt fee accounting.');
  const events = array(r[3], 0, 'events').map(e => {
    array(e, 4, 'event');
    if (typeof e[2] !== 'string') throw new Error('Invalid event topic.');
    return { topic: e[2], payload: printable(e[3]), substate: printable(e[0]), template: printable(e[1]) };
  });
  const breakdown = fee[3] instanceof Map ? [...fee[3]].map(([key, amount]) => ({
    source: Array.isArray(key) ? String(key[0]) : String(key), units: unsigned(amount).toString()
  })) : [];
  return {
    outcome, epoch: unsigned(r[5], 'epoch').toString(),
    fees: { paid: paid.toString(), payment: payment.toString(), refunded: (payment - paid).toString(),
      overcharge: overcharge.toString(), burn: burn.toString(), breakdown },
    state: { written: up.length, removed: down.length }, events,
    intentCommitment: r[6] ? printable(r[6]) : null
  };
}

const MESSAGES = {
  success: ['Action committed', 'The receipt reports a full commit. This alone does not prove a particular person received a particular amount.'],
  'fee-only': ['Fee paid · action failed', 'Only the fee intent committed. Do not mark the requested action or payment as completed.'],
  aborted: ['Transaction aborted', 'Consensus reports an abort. The requested transaction did not commit.'],
  rejected: ['Rejected before consensus', 'The indexer reports a mempool rejection. The transaction was not sequenced.'],
  pending: ['Pending at this observation', 'The indexer has not returned a finalized result. Check again before taking another action.'],
  unknown: ['Outcome not established', 'Missing data is not evidence of failure. Indexer retention, syncing or testnet resets can remove records.'],
  conflict: ['Conflicting evidence', 'The responses disagree. Do not reconcile this transaction until the mismatch is resolved.']
};

export function analyze(packet) {
  if (!packet || packet.schema !== SCHEMA) throw new Error('Use a Receipt Desk evidence packet (v1).');
  const id = transactionId(packet.transactionId);
  if (!packet.network || !/^[a-z0-9_-]{1,32}$/.test(packet.network)) throw new Error('Missing or invalid network.');
  const responses = packet.responses;
  if (!responses || typeof responses !== 'object') throw new Error('Missing responses.');
  const info = responses.info?.body;
  if (info?.network && info.network !== packet.network) throw new Error('Network mismatch in evidence.');
  const entry = responses.transaction?.status === 200 ? responses.transaction.body?.transaction : null;
  if (entry && transactionId(entry.transaction_id) !== id) throw new Error('Transaction ID mismatch in evidence.');
  const txNetwork = entry?.transaction?.V1?.body?.transaction?.network;
  if (txNetwork !== undefined && info?.network_byte !== undefined && txNetwork !== info.network_byte) throw new Error('Transaction network byte mismatch.');
  let receipt = null;
  if (responses.receipt?.status === 200) receipt = decodeReceipt(responses.receipt.body?.receipt);
  const result = responses.result?.status === 200 ? responses.result.body?.result : null;
  let status = 'unknown', detail = null;
  if (receipt) status = receipt.outcome === 'Commit' ? 'success' : 'fee-only';
  else if (result === 'Pending') status = 'pending';
  else if (result?.Rejected) { status = 'rejected'; detail = String(result.Rejected.details ?? ''); }
  else if (result?.Finalized?.final_decision === 'Abort' || (result?.Finalized?.final_decision && typeof result.Finalized.final_decision === 'object' && 'Abort' in result.Finalized.final_decision)) {
    status = 'aborted'; detail = String(result.Finalized.abort_details ?? '');
  }
  // A consensus Commit can be a fee-only commit. Without the receipt, leave
  // action success unknown; never infer it from HTTP 200, signatures or fees.
  if (receipt && (result?.Rejected || (result?.Finalized && result.Finalized.final_decision !== 'Commit') ||
      (entry?.summary && entry.summary.outcome !== receipt.outcome))) status = 'conflict';
  if (receipt && entry?.summary?.total_fees_paid !== undefined && unsigned(entry.summary.total_fees_paid) !== unsigned(receipt.fees.paid)) status = 'conflict';
  const [title, explanation] = MESSAGES[status];
  return { id, network: packet.network, status, title, explanation, detail, receipt,
    observedAt: typeof packet.observedAt === 'string' ? packet.observedAt : 'Not recorded',
    finalizedAt: result?.Finalized?.finalized_time ?? entry?.summary?.finalized_at ?? null,
    indexerVersion: info?.version ?? 'unknown',
    receiptRetention: info?.transaction_receipt_retention_epochs ?? null,
    transactionRetention: info?.transaction_retention_epochs ?? null,
    responses: Object.fromEntries(Object.entries(responses).map(([k, v]) => [k, v.status])),
    origin: packet.origin === 'live' ? 'live' : 'saved',
    // The app decodes node responses; it does not verify consensus proofs.
    assurance: 'Indexer-reported; consensus proof not independently verified.' };
}

export function parsePacket(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_PACKET_BYTES) throw new Error('Evidence file exceeds 2 MB.');
  const packet = JSON.parse(text);
  analyze(packet);
  // Imported provenance is data, never a live verification claim.
  return { ...packet, origin: 'imported' };
}

export function privateSummary(report, includeId = false) {
  const result = { format: 'ootle-receipt-summary/v1', network: report.network,
    outcome: report.status, title: report.title, observedAt: report.observedAt,
    receiptEpoch: report.receipt?.epoch ?? null,
    feesMicroTari: report.receipt?.fees.paid ?? null,
    stateCounts: report.receipt?.state ?? null,
    assurance: report.assurance,
    note: 'Summary only. No proof of recipient ownership, private amount or receipt authenticity.' };
  if (includeId) result.transactionId = report.id;
  return result;
}

export function reconcile(reports) {
  const unique = new Map();
  for (const r of reports) {
    const key = `${r.network}:${r.id}`;
    if (unique.has(key)) throw new Error('Duplicate transaction in reconciliation.');
    unique.set(key, r);
  }
  const groups = new Map();
  for (const r of unique.values()) {
    const g = groups.get(r.network) ?? { network: r.network, transactions: 0, committed: 0, feeOnly: 0, unresolved: 0, fees: 0n };
    g.transactions++;
    if (r.status === 'success') g.committed++;
    else if (r.status === 'fee-only') g.feeOnly++;
    else g.unresolved++;
    if (r.receipt && ['success', 'fee-only'].includes(r.status)) g.fees += unsigned(r.receipt.fees.paid);
    groups.set(r.network, g);
  }
  return [...groups.values()].map(g => ({ ...g, fees: g.fees.toString() }));
}

export function csv(reports, includeId = false) {
  const cell = value => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
  const header = ['network', 'outcome', 'observed_at', 'epoch', 'fee_micro_tari', ...(includeId ? ['transaction_id'] : [])];
  const rows = reports.map(r => [r.network, r.status, r.observedAt, r.receipt?.epoch ?? '',
    ['success', 'fee-only'].includes(r.status) ? r.receipt?.fees.paid ?? '' : '', ...(includeId ? [r.id] : [])]);
  return [header, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
