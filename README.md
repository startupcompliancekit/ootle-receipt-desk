# Ootle Receipt Desk

A read-only desk for answering **what actually committed?** on Tari Ootle.

Ootle can commit a transaction's fee intent while its requested action fails. Receipt Desk distinguishes that outcome from a full commit, keeps absent records unresolved, and exports evidence without needing a wallet.

**[Open the app](https://startupcompliancekit.github.io/ootle-receipt-desk/)** · [Evidence format](docs/format.md) · [Source mapping and limits](docs/protocol.md)

## Try it in one minute

1. Open the app and choose **Fee paid, action failed**. This is a saved, real Esmeralda receipt: 30,151 µTARI in fees, with only the fee intent committed.
2. Add it to reconciliation. Open **Public vault transfer** and add that receipt too. Fees total exactly 44,651 µTARI; one action committed and one failed.
3. Export the CSV or a minimal summary. Transaction IDs are omitted by default.
4. Choose **Check this ID live** for a fresh public-indexer lookup, or import the saved evidence offline. The app labels the two paths separately.

The third example is a real stealth transaction. Its receipt does not reveal a private transfer amount. No estimate is substituted.

## Run locally

Requires Node.js 22 or newer. No package installation or build step is needed.

```sh
node serve.mjs
```

Open http://127.0.0.1:4177. The server listens only on loopback.

```sh
node --test tests/*.test.mjs
node cli.mjs fixtures/fee-only.json
```

An optional live, read-only check:

```sh
node cli.mjs --live ab778b1ecf8fa3e1c3e01ce6f4074f93a4aa766e2a930c6c5272a9d32f3df565
```

All three fixtures are included, so the demo remains reproducible after testnet resets or indexer pruning. Live results may differ as records expire.

## What works

- Live lookup through the public Esmeralda indexer, with network identity checked first.
- Decoding the actual CBOR transaction receipt, including full versus fee-only outcome, exact fees, state-change counts and public events.
- Explicit pending, rejected, aborted, unknown and conflicting-evidence states.
- Receipt-first lookup: a pruned transaction body does not erase an available receipt.
- A temporary reconciliation tray with duplicate rejection and separate network totals.
- Offline evidence import, minimal summary JSON, public evidence JSON, CSV and printing.
- Desktop and mobile layouts; no analytics, storage, wallet connection, signing or transaction submission.

## Verification

The repository has 28 native Node regression tests covering real network fixtures, fee-only outcomes, mismatched network and transaction IDs, contradictory evidence, malformed/oversized CBOR, exact 64-bit integers, import provenance, duplicate handling, export privacy, and the GET-only transport.

Browser checks cover the demo flows, mocked lookup, CSV/download/import round trip, zero network requests on import, malformed files, desktop layout and a 390px phone layout. Real endpoint checks are separate from the mocked browser transport. See [validation](docs/validation.md).

## Trust and privacy

This is an **indexer-response reader**, not an independent consensus-proof verifier. A parsed receipt does not prove a named person received a particular asset or amount. Confirm payments using the expected resource and the receiving wallet ledger.

Live queries disclose the transaction ID and ordinary connection metadata to the public indexer. Loading the website discloses ordinary connection metadata to its host. Imported files are processed locally; nothing is sent on import. Files are untrusted and imported provenance is never treated as a fresh network check.

Minimal exports omit IDs by default, event payloads, signatures and error text. Evidence exports include the transaction ID and the public receipt; custom public events may themselves contain sensitive data. Review the file before sharing.

## Scope

This MVP reads **Esmeralda Ootle testnet**. It does not check XTM L1 payouts, decrypt stealth amounts, establish recipient identity, or move funds. No contract deployment is necessary for its read-only workflow. It uses the official indexer REST interfaces with a small dependency-free JavaScript adapter and a bounded decoder pinned to the upstream schema. No code from earlier contest entries is reused.

MIT licensed. Independent community tool; not an official Tari product.
