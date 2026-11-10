# Protocol mapping

The interface reference is the official [Tari Ootle repository](https://github.com/tari-project/tari-ootle/tree/8d847b6380cd4abe3350b833408b22ee88a2899f), commit `8d847b6380cd4abe3350b833408b22ee88a2899f`.

Reviewed release interfaces: `@tari-project/indexer-client` 1.13.0 and `@tari-project/ootle-ts-bindings` 1.64.0. Their npm archives matched the registry's SHA-512 integrity values. These are interface references, not runtime dependencies; no package hooks or generated scripts are run. Registry integrity is not an independent author signature.

The GET-only adapter corresponds to `getTransaction`, `getTransactionResult`, `getTransactionReceipt` and `listRecentTransactions` in the official JavaScript client, plus the node's `/info` route. The receipt route expects the bare 64-character hash in the tested release, even though a substate address is displayed with a `txreceipt_` prefix elsewhere. No submit or dry-run method is implemented.

## Sources

- [JavaScript indexer interface](https://github.com/tari-project/tari-ootle/blob/8d847b6380cd4abe3350b833408b22ee88a2899f/clients/javascript/indexer_client/src/index.ts)
- [REST response types](https://github.com/tari-project/tari-ootle/blob/8d847b6380cd4abe3350b833408b22ee88a2899f/clients/tari_indexer_client/src/types.rs)
- [Receipt and outcome codec](https://github.com/tari-project/tari-ootle/blob/8d847b6380cd4abe3350b833408b22ee88a2899f/crates/engine_types/src/transaction_receipt.rs)
- [Fee receipt fields](https://github.com/tari-project/tari-ootle/blob/8d847b6380cd4abe3350b833408b22ee88a2899f/crates/engine_types/src/fees/mod.rs)
- [Event codec](https://github.com/tari-project/tari-ootle/blob/8d847b6380cd4abe3350b833408b22ee88a2899f/crates/engine_types/src/events.rs)
- [Official indexer API reference](https://ootle.tari.com/indexer/indexer-api)

## Outcome rules

| Available evidence | Desk outcome |
| --- | --- |
| Receipt `Commit` | Action committed |
| Receipt `FeeIntentCommit` | Fee paid; action failed |
| Result `Pending`, no receipt | Pending at this observation |
| Result `Rejected`, no receipt | Rejected before consensus |
| Result `Finalized` with `Abort`, no receipt | Transaction aborted |
| Consensus `Commit`, receipt unavailable | Outcome not established |
| Missing or failed responses | Outcome not established |
| Receipt/result/summary disagreement | Conflicting evidence |

An available receipt can be ahead of a stale pending result. This is distinct from contradictory terminal outcomes. The recent-transaction list is gossip-based and incomplete; receipt retention and transaction retention can differ. The fixed endpoint is checked for Esmeralda network byte 38 before every live lookup.

This MVP has no independent proof verification, schema negotiation, automatic retry/polling, persistent history or mainnet switch. These limits are visible in the interface. Future work should add authenticated proof verification and resource-aware balance reconciliation before presenting stronger assurances.
