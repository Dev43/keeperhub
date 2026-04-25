# 0G plugin smoke tests

Purpose: prove each new plugin action round-trips against 0G Galileo testnet before wiring the full Phulax detection workflow. These are throwaway workflows — keep them in your KH dev project, not in the demo project.

## Prereqs

```bash
export CHAIN_0G_GALILEO_PRIMARY_RPC=https://evmrpc-testnet.0g.ai
# WSS endpoint TBD — check 0G docs and update lib/rpc/rpc-config.ts if/when available
export ZERO_G_STORAGE_INDEXER_URL=https://indexer-storage-testnet-turbo.0g.ai
export ZERO_G_STORAGE_PRIVATE_KEY=0x...           # account funded on Galileo
export ZERO_G_COMPUTE_GATEWAY_URL=https://compute-testnet.0g.ai
export ZERO_G_COMPUTE_API_KEY=0gc_...
```

Then `pnpm tsx scripts/seed/seed-chains.ts` once to register chain 16601 in dev DB.

## SMOKE-1 — `0g-storage/kv-put` then `kv-get`

Workflow: Manual trigger -> `kv-put`(streamId=test-stream, key="hello", value="world") -> `kv-get`(streamId=test-stream, key="hello"). Expect `value === "world"` in output.

Edge cases to confirm before declaring green:
- Empty value rejected with a clear error (validation tier).
- Missing private key returns the configured-instructions error, not a 500.

## SMOKE-2 — `0g-storage/log-append`

Workflow: Manual trigger -> `log-append`(streamId=test-log, payload='{"hello":"world"}', tag="smoke"). Expect non-null `entryId` and `txHash`. Verify the entry is visible at `${ZERO_G_STORAGE_INDEXER_URL}/log/entries?streamId=test-log&tag=smoke`.

## SMOKE-3 — `0g-compute/inference` against any 0G-served base model

Workflow: Manual trigger -> `inference`(model="qwen2.5-0.5b-instruct", prompt="Reply with the single token OK.", maxTokens=4). Expect `output` contains "OK" and `attestation` is non-null.

Note: this verifies the plugin works end-to-end inside KeeperHub. Phulax's demo classifier is self-hosted (LoRA-adapted Qwen2.5-0.5B isn't 0G-served), so this smoke test is for the upstream PR audience, not the demo path.

## SMOKE-4 — `Block` trigger + `web3/query-transactions` on 0G

Workflow: `Block` trigger (chain 16601, every 1 block) -> `web3/query-transactions`(contractAddress=<any verified contract on Galileo>, fromBlock={{trigger.blockNumber}}, toBlock={{trigger.blockNumber}}). Run for 5 minutes. Confirm the action returns an array and that empty blocks return `[]` rather than an error.

If WSS is flaky, the `Block` trigger drops subscriptions silently — watch `keeperhub-scheduler` logs for reconnect spam. Findings go in `tasks/todo.md` Review (parent repo §15).

## End-of-Day-1 green E2E

The combined workflow lives at `specs/0g-integration/per-tx-detection.workflow.json`. Replace `{{TODO_FAKE_LENDING_POOL_ADDRESS}}` and the `env.*` placeholders with concrete values once Track B6 ships the deployed FakeLendingPool. Until then, point `contractAddress` at any pool on 0G Galileo to confirm fan-out works.
