export type ZeroGStorageCredentials = {
  ZERO_G_INDEXER_URL?: string;
  ZERO_G_FLOW_ADDRESS?: string;
  ZERO_G_CHAIN_ID?: string;
};

export const ZERO_G_DEFAULT_INDEXER_URL =
  "https://indexer-storage-testnet-turbo.0g.ai";
// Flow contract on 0G Galileo testnet. Source: 0g-ts-sdk and docs.0g.ai.
export const ZERO_G_DEFAULT_FLOW_ADDRESS =
  "0x22E03a6A89B950F1c82ec5e74F8eCa321a105296";
// Chain id 16_602 = 0G Galileo testnet V3 (eth_chainId on
// https://evmrpc-testnet.0g.ai returns 0x40da). Seeded in
// scripts/seed/seed-chains.ts. Mainnet is 16_661.
export const ZERO_G_DEFAULT_CHAIN_ID = 16_602;

export function resolveZeroGIndexerUrl(
  credentials: ZeroGStorageCredentials
): string {
  return (
    credentials.ZERO_G_INDEXER_URL ??
    process.env.ZERO_G_INDEXER_URL ??
    ZERO_G_DEFAULT_INDEXER_URL
  );
}

export function resolveZeroGFlowAddress(
  credentials: ZeroGStorageCredentials
): string {
  return (
    credentials.ZERO_G_FLOW_ADDRESS ??
    process.env.ZERO_G_FLOW_ADDRESS ??
    ZERO_G_DEFAULT_FLOW_ADDRESS
  );
}

export function resolveZeroGChainId(
  credentials: ZeroGStorageCredentials
): number {
  const raw =
    credentials.ZERO_G_CHAIN_ID ?? process.env.ZERO_G_CHAIN_ID ?? undefined;
  if (!raw) {
    return ZERO_G_DEFAULT_CHAIN_ID;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : ZERO_G_DEFAULT_CHAIN_ID;
}
