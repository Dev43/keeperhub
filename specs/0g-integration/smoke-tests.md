# 0G plugin smoke tests

Purpose: prove each new plugin action round-trips against 0G Galileo testnet (chain id 16602) before wiring the full Phulax detection workflow. Throwaway workflows -- keep them in your KH dev project, not in the demo project.

## Prereqs

The 0G plugins sign through the organization's KeeperHub wallet (Para or Turnkey), so there is no plugin-specific private-key env. You only need:

```bash
# Optional RPC overrides (defaults work for Galileo)
export CHAIN_0G_TESTNET_PRIMARY_RPC=https://evmrpc-testnet.0g.ai

# Optional 0G storage overrides (defaults work for Galileo)
export ZERO_G_INDEXER_URL=https://indexer-storage-testnet-turbo.0g.ai
export ZERO_G_FLOW_ADDRESS=<galileo Flow contract>
```

Then `pnpm tsx scripts/seed/seed-chains.ts` once to register chain 16602 (and 16661 mainnet) in the dev DB. Make sure the org wallet is funded with Galileo `0G` before running the write-side smoke tests.

## SMOKE-1 -- `0g-storage/kv-put` then `kv-get`

Workflow: Manual trigger -> `kv-put`(network=16602, streamId=0x..., key="hello", value="world") -> `kv-get`(network=16602, rootHash={{KvPut.rootHash}}, streamId=same, key="hello"). Expect `value === "world"` in the kv-get output and a non-empty `txHash` / `rootHash` from kv-put.

Edge cases to confirm before declaring green:
- Missing `streamId` or `key` returns the validation error, not a 500.
- Org wallet not provisioned for the user returns the configured-instructions error from `resolveOrganizationContext`.

## SMOKE-2 -- `0g-storage/log-append`

Workflow: Manual trigger -> `log-append`(streamId=0x..., payload='{"hello":"world"}', tag="smoke"). Expect non-null `rootHash` and `txHash`.

## SMOKE-3 -- `0g-compute/list-providers`

Workflow: Manual trigger -> `list-providers`(network=16602, modelFilter="llama"). Expect `count > 0` and a `defaultProvider` 0x address. Pipe the address into SMOKE-4.

## SMOKE-4 -- `0g-compute/fund-provider` then `inference`

Workflow: Manual trigger -> `fund-provider`(network=16602, providerAddress={{ListProviders.defaultProvider}}, minBalance="0.01") -> `inference`(network=16602, providerAddress=same, prompt="Reply with the single token OK.", maxTokens=4). Expect `verified === true` and `output` contains "OK".

Note: this verifies the plugin works end-to-end inside KeeperHub. Phulax's demo classifier is self-hosted (LoRA-adapted Qwen2.5-0.5B isn't 0G-served), so this smoke test is for the upstream PR audience, not the demo path.

## SMOKE-5 -- `Block` trigger + `web3/query-transactions` on 0G

Workflow: `Block` trigger (chain 16602, every 1 block) -> `web3/query-transactions`(contractAddress=<any verified contract on Galileo>, fromBlock={{trigger.blockNumber}}, toBlock={{trigger.blockNumber}}). Run for 5 minutes. Confirm the action returns an array and that empty blocks return `[]` rather than an error.

If WSS is flaky, the `Block` trigger drops subscriptions silently -- watch `keeperhub-scheduler` logs for reconnect spam. Findings go in `tasks/todo.md` Review (parent repo §15).

## End-of-Day-1 green E2E

The combined workflow lives at `specs/0g-integration/per-tx-detection.workflow.json`. Replace `{{TODO_FAKE_LENDING_POOL_ADDRESS}}` and the `env.*` placeholders with concrete values once Track B6 ships the deployed FakeLendingPool. Until then, point `contractAddress` at any pool on 0G Galileo to confirm fan-out works.
