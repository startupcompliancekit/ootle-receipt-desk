# Validation record

Tested 10 November 2026 with Node.js 22.22.1 and Chromium through Playwright 1.62.1.

## Core

`node --test tests/*.test.mjs`: **28 passed, 0 failed**. These tests run without network access or package installation. The real receipts in `fixtures/` are unchanged base64 responses from the public Esmeralda indexer; transaction bodies and signatures are omitted from the fixture packets.

## Browser

Eleven checks passed in a Linux bubblewrap namespace without network access, host credentials or host home directories:

1. No indexer request on initial load.
2. Actual fee-only fixture displays 0.030151 TARI and action failure.
3. Duplicate reconciliation rejected.
4. Default summary omits transaction ID.
5. Evidence download/import round trip makes no network request.
6. GET lookup browser workflow with a mocked transport.
7. Real transfer fixture shows withdrawal/deposit events and enters the tray.
8. Default CSV omits transaction IDs.
9. 390px phone layout has no page-level horizontal overflow.
10. Stealth example does not invent public events or a private amount.
11. Malformed import preserves the previous valid result.

The browser transport test is mocked; it is not evidence of a live transaction.

## Actual endpoint check

A separate GET-only CLI run in bubblewrap, with network access and no credentials, queried:

`ab778b1ecf8fa3e1c3e01ce6f4074f93a4aa766e2a930c6c5272a9d32f3df565`

The public indexer reported Esmeralda network byte 38, version 0.52.0. At `2026-11-10T03:46:26.977Z`, the decoded receipt again reported `FeeIntentCommit`, 30,151 µTARI paid, epoch 12984, two written substates and one removed substate. This checks the real adapter and schema, not the authenticity of consensus proofs.

No transaction was submitted and no funds were used. Live fixtures may disappear after pruning or a testnet reset; the saved examples remain usable.
