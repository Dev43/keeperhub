export type ZeroGNetwork = "mainnet" | "testnet";

export type ZeroGComputeCredentials = {
  ZERO_G_COMPUTE_NETWORK?: string;
  ZERO_G_COMPUTE_GATEWAY_URL?: string;
  ZERO_G_COMPUTE_API_KEY?: string;
};

// 0G Compute mainnet gateway is not yet published in official 0G docs; the
// canonical hostname pattern is used here as a sane default and can be
// overridden per-integration via the Gateway URL form field.
export const ZERO_G_COMPUTE_GATEWAY_URLS: Record<ZeroGNetwork, string> = {
  mainnet: "https://compute.0g.ai",
  testnet: "https://compute-testnet.0g.ai",
};

export function resolveZeroGComputeNetwork(value: string | undefined): ZeroGNetwork {
  return value === "mainnet" ? "mainnet" : "testnet";
}

export function resolveZeroGComputeGatewayUrl(
  credentials: ZeroGComputeCredentials
): string {
  if (credentials.ZERO_G_COMPUTE_GATEWAY_URL) {
    return credentials.ZERO_G_COMPUTE_GATEWAY_URL;
  }
  if (process.env.ZERO_G_COMPUTE_GATEWAY_URL) {
    return process.env.ZERO_G_COMPUTE_GATEWAY_URL;
  }
  const network = resolveZeroGComputeNetwork(
    credentials.ZERO_G_COMPUTE_NETWORK ?? process.env.ZERO_G_COMPUTE_NETWORK
  );
  return ZERO_G_COMPUTE_GATEWAY_URLS[network];
}
