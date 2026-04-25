# 0G integration — Phulax bridge

Internal spec for the 0G chain seed and plugins shipped on `feature/0g-integration`. Public-facing docs deliberately omitted; this is the working doc.

## Surface added

1. **0G Galileo Testnet (chain ID 16601)** wired into `lib/rpc/rpc-config.ts` and seeded from `scripts/seed/seed-chains.ts`. Symbol `OG`, primary RPC `https://evmrpc-testnet.0g.ai`, explorer `https://chainscan-galileo.0g.ai` (Blockscout-family API).
2. **`plugins/0g-storage`** — three actions:
   - `kv-get` — read a KV value from a 0G Storage stream (no signer required).
   - `kv-put` — write a KV value (requires `ZERO_G_STORAGE_PRIVATE_KEY`). `maxRetries = 0`.
   - `log-append` — append to an append-only log stream. `maxRetries = 0`.
3. **`plugins/0g-compute`** — one action:
   - `sealed-inference` — call a 0G-hosted model and return `{output, attestation, modelHash}`. `maxRetries = 0`.
4. **`plugin-allowlist.json`** — adds `0g-storage` and `0g-compute`.
5. **Generated** by `pnpm discover-plugins`: `lib/types/integration.ts`, `lib/step-registry.ts`, `lib/codegen-registry.ts`, `plugins/index.ts`, codegen templates.

## Implementation notes

- Both plugins use `fetch()` directly against gateway/indexer HTTP endpoints, not `@0glabs/0g-ts-sdk`. Rationale: step files cannot pull heavy SDKs through the workflow bundler (see `plugins/CLAUDE.md` "Step File Rules"), and the SDK has documented gaps around indexer auth flows. When the SDK matures we can swap the inner `fetch` for SDK calls without changing the action surface.
- `0g-storage` indexer URL defaults to `https://indexer-storage-testnet-turbo.0g.ai` and is overridable via the `ZERO_G_STORAGE_INDEXER_URL` integration field.
- `0g-compute` gateway URL defaults to `https://compute-testnet.0g.ai` and is overridable via `ZERO_G_COMPUTE_GATEWAY_URL`.
- The Phulax demo does **not** call `0g-compute/sealed-inference` on the hot path because 0G sealed inference does not currently serve our LoRA-adapted Qwen2.5-0.5B. The plugin still ships in this PR so any KeeperHub user can hit a 0G-served base model from a workflow. The demo workflow calls a self-hosted classifier endpoint via the existing HTTP Request system action.

## Per-tx detection workflow shape

No new trigger type is introduced. Per-tx detection on the FakeLendingPool uses:

1. Existing `Block` trigger fires every block on chain 16601.
2. Existing `web3/query-transactions` step with `contractAddress = <FakeLendingPool>`, `fromBlock = toBlock = trigger.blockNumber` returns `0..N` decoded txs.
3. Existing `code/run-code` (or `math/aggregate`) step folds the array into a `maxScore`.
4. Existing HTTP Request system action calls the self-hosted classifier `POST /classify` for any tx whose invariants/oracle tier already raised the score.
5. New `0g-storage/log-append` writes the signed receipt to the per-account incident log.
6. Existing `web3/write-contract` (private mempool variant when available) calls `PhulaxAccount.withdraw(adapter)` if `maxScore > threshold`.

Workflow JSON skeleton lives at `specs/0g-integration/per-tx-detection.workflow.json` (added in a follow-up commit once Track B has the deployed `FakeLendingPool` address).

## Day-1 measurements (to be filled after running on 0G testnet)

The dispatch prompt requires:

- Average 0G testnet block time (sample 200 blocks).
- p50 / p95 RPC latency for `eth_getBlockByNumber` from KeeperHub's Fly region.
- WSS `eth_subscribe("newHeads")` stability over a 30-minute window — count drops, average reconnect interval.

Run the scaffold script:

```bash
pnpm tsx scripts/0g/measure-block-time.ts
```

Findings go in `tasks/todo.md` Review section back in the parent Phulax repo, **not** here.

## Rollout

- Feature branch only (`feature/0g-integration`). Do not push.
- Upstream PR to KeeperHub `staging` is opened **after** the demo is recorded — see Phulax `tasks/todo.md` §7.5.
- `FEEDBACK.md` ships in this repo at the same time as the upstream PR.
