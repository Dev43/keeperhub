export type ZeroGComputeCredentials = {
  ZERO_G_COMPUTE_CHAIN_ID?: string;
};

// Chain id 16_602 = 0G Galileo testnet V3 (seeded in scripts/seed/seed-chains.ts).
// Mainnet is 16_661.
export const ZERO_G_COMPUTE_DEFAULT_CHAIN_ID = 16_602;

export function resolveZeroGComputeChainId(
  credentials: ZeroGComputeCredentials
): number {
  const raw =
    credentials.ZERO_G_COMPUTE_CHAIN_ID ??
    process.env.ZERO_G_COMPUTE_CHAIN_ID ??
    undefined;
  if (!raw) {
    return ZERO_G_COMPUTE_DEFAULT_CHAIN_ID;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : ZERO_G_COMPUTE_DEFAULT_CHAIN_ID;
}
