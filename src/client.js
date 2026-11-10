import { INDEXER, NETWORK, SCHEMA, transactionId, MAX_PACKET_BYTES } from './receipt.js';

// GET-only adapter for the official @tari-project/indexer-client 1.13.0
// REST interfaces. The endpoint is fixed: imported files cannot redirect it.
export async function fetchJson(path, { fetchImpl = fetch, signal } = {}) {
  if (!/^\/(?:info|transactions(?:\/recent\?limit=8|\/[a-f0-9]{64}(?:\/result)?)|transaction-receipts\/[a-f0-9]{64})$/.test(path)) throw new Error('Read-only endpoint not allowed.');
  const response = await fetchImpl(INDEXER + path, {
    method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
    signal: signal ?? AbortSignal.timeout(18000), headers: { Accept: 'application/json' }
  });
  if (!response.ok && response.status !== 404) throw new Error(`Indexer HTTP ${response.status}; no outcome inferred.`);
  const reader = response.body?.getReader();
  let bodyText = '';
  if (reader) {
    const decoder = new TextDecoder(); let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_PACKET_BYTES) { await reader.cancel(); throw new Error('Indexer response exceeds 2 MB.'); }
        bodyText += decoder.decode(value, { stream: true });
      }
      bodyText += decoder.decode();
    } finally { reader.releaseLock(); }
  } else bodyText = await response.text();
  if (new TextEncoder().encode(bodyText).length > MAX_PACKET_BYTES) throw new Error('Indexer response exceeds 2 MB.');
  let body;
  try { body = JSON.parse(bodyText); } catch { throw new Error('Indexer returned invalid JSON; no outcome inferred.'); }
  return { status: response.status, body };
}

export async function lookup(value, options = {}) {
  const id = transactionId(value);
  const info = await fetchJson('/info', options);
  if (info.body.network !== NETWORK || info.body.network_byte !== 38) throw new Error('Indexer is not Esmeralda (38). Lookup stopped.');
  const paths = { receipt: `/transaction-receipts/${id}`, result: `/transactions/${id}/result`, transaction: `/transactions/${id}` };
  const responses = { info };
  // A receipt can survive a pruned transaction body or an unavailable validator.
  await Promise.all(Object.entries(paths).map(async ([key, path]) => {
    try { responses[key] = await fetchJson(path, options); }
    catch (error) { responses[key] = { status: 0, error: String(error.message).slice(0, 180) }; }
  }));
  return { schema: SCHEMA, network: NETWORK, transactionId: id, origin: 'live',
    source: INDEXER, observedAt: new Date().toISOString(), responses };
}

export async function recent(options = {}) {
  const info = await fetchJson('/info', options);
  if (info.body.network !== NETWORK || info.body.network_byte !== 38) throw new Error('Indexer network mismatch.');
  const result = await fetchJson('/transactions/recent?limit=8', options);
  if (!Array.isArray(result.body.transactions)) throw new Error('Unexpected recent-transaction format.');
  return result.body.transactions.slice(0, 8).map(t => ({
    id: transactionId(t.transaction_id), outcome: t.summary?.outcome ?? 'No receipt indexed', time: t.created_at
  }));
}
