import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyze, decodeReceipt, parsePacket, transactionId, privateSummary, reconcile, csv, units } from '../src/receipt.js';
import { decodeCbor, decodeBase64 } from '../src/cbor.js';
import { lookup, fetchJson } from '../src/client.js';

const fixture = async name => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
const clone = v => structuredClone(v);
const fee = await fixture('fee-only'), transfer = await fixture('transfer'), stealth = await fixture('stealth');
const unknown = () => ({ ...clone(fee), responses: { info: fee.responses.info, receipt: { status: 404 }, result: { status: 404 }, transaction: { status: 404 } } });

test('real fee-only receipt is not successful payment despite consensus commit', () => {
  const p = clone(fee); p.responses.result = { status: 200, body: { result: { Finalized: { final_decision: 'Commit' } } } };
  const r = analyze(p); assert.equal(r.status, 'fee-only'); assert.equal(r.receipt.fees.paid, '30151');
  assert.deepEqual(r.receipt.state, { written: 2, removed: 1 }); assert.equal(r.receipt.epoch, '12984');
});
test('real transfer has a full commit and public deposit/withdraw events', () => {
  const r = analyze(transfer); assert.equal(r.status, 'success');
  assert.deepEqual(r.receipt.events.map(e => e.topic), ['std.vault.withdraw', 'std.vault.deposit']);
  assert.equal(r.receipt.fees.paid, String(transfer.responses.transaction.body.transaction.summary.total_fees_paid));
});
test('real stealth transaction does not invent a payment amount', () => {
  const r = analyze(stealth); assert.equal(r.status, 'success'); assert.equal(r.receipt.events.length, 0);
  assert.equal(r.receipt.fees.paid, '30000'); assert.equal(r.receipt.fees.refunded, '0');
  assert.equal('paymentAmount' in r, false);
});
test('consensus Commit alone is not evidence of action success', () => {
  const p = unknown(); p.responses.result = { status: 200, body: { result: { Finalized: { final_decision: 'Commit' } } } };
  assert.equal(analyze(p).status, 'unknown');
});
test('missing records are unknown rather than failed or pending', () => assert.equal(analyze(unknown()).status, 'unknown'));
test('Pending is explicit, not inferred from a 404', () => {
  const p = unknown(); p.responses.result = { status: 200, body: { result: 'Pending' } };
  assert.equal(analyze(p).status, 'pending');
});
test('mempool rejection and consensus abort remain distinct', () => {
  const p = unknown(); p.responses.result = { status: 200, body: { result: { Rejected: { details: 'invalid input' } } } };
  assert.equal(analyze(p).status, 'rejected');
  p.responses.result.body.result = { Finalized: { final_decision: 'Abort' } }; assert.equal(analyze(p).status, 'aborted');
});
test('disagreeing receipt and summary fail closed', () => {
  const p = clone(fee); p.responses.transaction.body.transaction.summary.outcome = 'Commit'; assert.equal(analyze(p).status, 'conflict');
});
test('disagreeing fee totals fail closed', () => {
  const p = clone(fee); p.responses.transaction.body.transaction.summary.total_fees_paid++; assert.equal(analyze(p).status, 'conflict');
});
test('rejection cannot override a contradictory receipt silently', () => {
  const p = clone(fee); p.responses.result = { status: 200, body: { result: { Rejected: { details: 'bad' } } } };
  assert.equal(analyze(p).status, 'conflict');
});
test('ID and network binding reject mismatches', () => {
  const p = clone(fee); p.transactionId = '1'.repeat(64); assert.throws(() => analyze(p), /ID mismatch/);
  p.transactionId = fee.transactionId; p.network = 'mainnet'; assert.throws(() => analyze(p), /Network mismatch/);
});
test('transaction network byte mismatch is rejected', () => {
  const p = clone(fee); p.responses.transaction.body.transaction.transaction = { V1: { body: { transaction: { network: 0 } } } };
  assert.throws(() => analyze(p), /network byte mismatch/);
});
test('unknown CBOR outcome is never marked successful', () => {
  const b = Buffer.from(fee.responses.receipt.body.receipt, 'base64'); b[2] = 2;
  assert.throws(() => decodeReceipt(b.toString('base64')), /Unknown receipt outcome/);
});
test('CBOR truncation, trailing bytes, indefinite sizes and giant arrays are rejected', () => {
  for (const b of [[0x82, 1], [0, 0], [0x9f, 0xff], [0x9a, 255, 255, 255, 255]]) assert.throws(() => decodeCbor(Uint8Array.from(b)));
});
test('CBOR nesting and size limits reject resource exhaustion', () => {
  assert.throws(() => decodeCbor(Uint8Array.from([...Array(60).fill(0x81), 0])), /complexity/);
  assert.throws(() => decodeCbor(new Uint8Array(1048577)), /size/);
});
test('base64 syntax is checked before decode', () => { assert.throws(() => decodeBase64('!!!!')); assert.throws(() => decodeBase64('AA')); });
test('64-bit CBOR integers retain exact precision', () => {
  assert.equal(decodeCbor(Uint8Array.from([0x1b, 255, 255, 255, 255, 255, 255, 255, 255])), 18446744073709551615n);
  assert.equal(units('18446744073709551615'), '18446744073709.551615');
  assert.throws(() => units(Number.MAX_SAFE_INTEGER + 1));
});
test('transaction ID parsing blocks path, query and URL injection', () => {
  assert.equal(transactionId('txreceipt_' + fee.transactionId.toUpperCase()), fee.transactionId);
  for (const value of ['https://example.com', '../info', 'x'.repeat(64), fee.transactionId + '?x=1', null]) assert.throws(() => transactionId(value));
});
test('imported files cannot claim live verification', () => {
  const p = clone(fee); p.origin = 'live'; assert.equal(parsePacket(JSON.stringify(p)).origin, 'imported');
  assert.throws(() => parsePacket(' '.repeat(2000001)), /2 MB/);
  assert.throws(() => parsePacket('{}'), /v1/);
});
test('minimal summary does not leak ID, signatures, payloads or error text', () => {
  const r = analyze(fee); r.detail = 'secret detail'; r.signature = 'secret signature';
  const exported = JSON.stringify(privateSummary(r));
  for (const word of [r.id, 'secret detail', 'secret signature', 'intentCommitment']) assert.equal(exported.includes(word), false);
  assert.equal(privateSummary(r, true).transactionId, r.id);
});
test('tray rejects duplicates and includes fee-only fees exactly once', () => {
  const a = analyze(fee), b = analyze(stealth);
  assert.throws(() => reconcile([a, a]), /Duplicate/);
  const [g] = reconcile([a, b]); assert.equal(g.fees, '60151'); assert.equal(g.feeOnly, 1); assert.equal(g.committed, 1);
});
test('networks never share one fee total, unresolved fees are excluded', () => {
  const a = analyze(fee), b = { ...analyze(stealth), network: 'mainnet' }, c = { ...analyze(transfer), status: 'conflict' };
  const groups = reconcile([a, b, c]); assert.equal(groups.length, 2); assert.equal(groups[0].fees, '30151'); assert.equal(groups[0].unresolved, 1);
});
test('CSV omits transaction IDs by default and escapes spreadsheet formulas', () => {
  const r = analyze(fee); r.observedAt = '=HYPERLINK("bad")';
  const output = csv([r]); assert.equal(output.includes(r.id), false); assert.ok(output.includes("'=HYPERLINK")); assert.ok(csv([r], true).includes(r.id));
});
test('adapter uses only fixed-host GET without credentials', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options }); let body = {};
    if (url.endsWith('/info')) body = fee.responses.info.body;
    else if (url.includes('/transaction-receipts/')) body = fee.responses.receipt.body;
    else if (url.endsWith('/result')) body = { result: { Finalized: { final_decision: 'Commit' } } };
    else body = fee.responses.transaction.body;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const r = analyze(await lookup(fee.transactionId, { fetchImpl })); assert.equal(r.status, 'fee-only');
  assert.equal(calls.length, 4);
  for (const { url, options } of calls) { assert.ok(url.startsWith('https://ootle-indexer-a.tari.com/')); assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); }
  assert.ok(calls.some(c => c.url.endsWith('/transaction-receipts/' + fee.transactionId)));
});
test('adapter stops on wrong network before transaction queries', async () => {
  let count = 0;
  await assert.rejects(lookup(fee.transactionId, { fetchImpl: async () => { count++; return new Response('{"network":"mainnet","network_byte":0}'); } }), /Esmeralda/);
  assert.equal(count, 1);
});
test('receipt remains useful if result and transaction body have expired', async () => {
  const p = await lookup(fee.transactionId, { fetchImpl: async url => new Response(JSON.stringify(url.endsWith('/info') ? fee.responses.info.body : url.includes('transaction-receipts') ? fee.responses.receipt.body : {}), { status: url.endsWith('/info') || url.includes('transaction-receipts') ? 200 : 404 }) });
  assert.equal(analyze(p).status, 'fee-only');
});
test('transport errors do not masquerade as pending or success', async () => {
  const p = await lookup(fee.transactionId, { fetchImpl: async url => { if (url.endsWith('/info')) return new Response(JSON.stringify(fee.responses.info.body)); throw new Error('offline'); } });
  assert.equal(analyze(p).status, 'unknown'); assert.equal(p.responses.receipt.status, 0);
});
test('HTTP errors, oversized bodies and disallowed methods are rejected', async () => {
  await assert.rejects(fetchJson('/info', { fetchImpl: async () => new Response('{}', { status: 503 }) }), /503/);
  await assert.rejects(fetchJson('/info', { fetchImpl: async () => new Response(' '.repeat(2000001)) }), /2 MB/);
  await assert.rejects(fetchJson('/transactions', { fetchImpl: () => { throw new Error('must not fetch'); } }), /not allowed/);
});
