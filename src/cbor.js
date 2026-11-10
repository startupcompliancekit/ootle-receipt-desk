// A deliberately small, bounded decoder for the definite-length CBOR emitted by
// Ootle's minicbor codec. No evaluation, network access or external dependencies.
export function decodeBase64(value) {
  if (typeof value !== 'string' || value.length > 1400000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid or oversized base64 receipt.');
  }
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  return decodeCbor(bytes);
}

export function decodeCbor(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 1048576) throw new Error('CBOR size limit.');
  let offset = 0, items = 0;
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const take = n => {
    if (!Number.isSafeInteger(n) || n < 0 || offset + n > bytes.length) throw new Error('Truncated CBOR.');
    const b = bytes.subarray(offset, offset + n); offset += n; return b;
  };
  function length(additional) {
    if (additional < 24) return BigInt(additional);
    if (additional > 27) throw new Error('Unsupported CBOR encoding.');
    let n = 0n;
    for (const b of take(2 ** (additional - 24))) n = (n << 8n) | BigInt(b);
    return n;
  }
  const numeric = n => n <= BigInt(Number.MAX_SAFE_INTEGER) && n >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(n) : n;
  function read(depth = 0) {
    if (depth > 48 || ++items > 50000) throw new Error('CBOR complexity limit.');
    const initial = take(1)[0], major = initial >> 5, additional = initial & 31;
    if (major === 7) {
      if (additional === 20) return false;
      if (additional === 21) return true;
      if (additional === 22) return null;
      throw new Error('Unsupported CBOR simple value.');
    }
    const n = length(additional);
    if (major === 0) return numeric(n);
    if (major === 1) return numeric(-1n - n);
    if (major === 6) return { tag: numeric(n), value: read(depth + 1) };
    if (n > BigInt(bytes.length)) throw new Error('Invalid CBOR length.');
    const size = Number(n);
    if (major === 2) return new Uint8Array(take(size));
    if (major === 3) return utf8.decode(take(size));
    if (major === 4) return Array.from({ length: size }, () => read(depth + 1));
    if (major === 5) {
      const map = new Map();
      for (let i = 0; i < size; i++) {
        const key = read(depth + 1);
        if (map.has(key)) throw new Error('Duplicate CBOR map key.');
        map.set(key, read(depth + 1));
      }
      return map;
    }
    throw new Error('Unsupported CBOR type.');
  }
  const result = read();
  if (offset !== bytes.length) throw new Error('Trailing CBOR data.');
  return result;
}

export const hex = b => [...b].map(v => v.toString(16).padStart(2, '0')).join('');

export function printable(value) {
  if (value instanceof Uint8Array) return hex(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), printable(v)]));
  if (Array.isArray(value)) return value.map(printable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, printable(v)]));
  return value;
}
