export type ZeroGNetwork = "mainnet" | "testnet";

export type ZeroGStorageCredentials = {
  ZERO_G_STORAGE_NETWORK?: string;
  ZERO_G_STORAGE_INDEXER_URL?: string;
  ZERO_G_STORAGE_PRIVATE_KEY?: string;
};

export const ZERO_G_STORAGE_INDEXER_URLS: Record<ZeroGNetwork, string> = {
  mainnet: "https://indexer-storage-turbo.0g.ai",
  testnet: "https://indexer-storage-testnet-turbo.0g.ai",
};

export function resolveZeroGStorageNetwork(value: string | undefined): ZeroGNetwork {
  return value === "mainnet" ? "mainnet" : "testnet";
}

export function resolveZeroGStorageIndexerUrl(
  credentials: ZeroGStorageCredentials
): string {
  if (credentials.ZERO_G_STORAGE_INDEXER_URL) {
    return credentials.ZERO_G_STORAGE_INDEXER_URL;
  }
  if (process.env.ZERO_G_STORAGE_INDEXER_URL) {
    return process.env.ZERO_G_STORAGE_INDEXER_URL;
  }
  const network = resolveZeroGStorageNetwork(
    credentials.ZERO_G_STORAGE_NETWORK ?? process.env.ZERO_G_STORAGE_NETWORK
  );
  return ZERO_G_STORAGE_INDEXER_URLS[network];
}
