# Portable evidence format

A Receipt Desk v1 packet records a transaction ID, a claimed network, an observation time and selected HTTP responses:

```json
{
  "schema": "ootle-receipt-desk/v1",
  "network": "esmeralda",
  "transactionId": "64 hexadecimal characters",
  "origin": "saved",
  "source": "https://ootle-indexer-a.tari.com",
  "observedAt": "2026-11-10T03:37:15Z",
  "responses": {
    "info": {"status": 200, "body": {"network": "esmeralda", "network_byte": 38}},
    "receipt": {"status": 200, "body": {"receipt": "base64 minicbor receipt"}}
  }
}
```

`result` and `transaction` responses are optional. Status 0 means that the transport failed; 404 means not found at this source. Neither establishes failure of the transaction itself. The `source` field is descriptive and can never select a URL for a request.

On import, `origin` is forced to `imported`. All provenance, including timestamps and source labels, remains unauthenticated user-supplied data. ID consistency checks are not a cryptographic binding of a receipt to an ID. There is no signature or consensus-proof verification.

JSON files are bounded at 2 MB. Base64 receipt bytes are bounded at 1 MiB; CBOR decoding has depth and item limits, rejects indefinite encoding and unsupported primitives, preserves large integers, and checks outcome and fee invariants. Unsupported newer schemas must be updated explicitly.

The evidence exporter preserves the public receipt bytes and a small allowlist of metadata. It omits original transaction bodies, signatures, execution logs, arbitrary imported fields and custom failure messages. A contradictory packet cannot be exported as a clean success. A **summary** is a different format and intentionally cannot be imported as receipt evidence.

The native fee unit is µTARI (10^6 per TARI). Exact integer arithmetic is used throughout. Event amounts may refer to other resources and are not summed or relabeled as TARI. Fee totals include full and fee-only commits, exclude unresolved/conflicting entries, and remain separated by network.
