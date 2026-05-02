/**
 * Etherscan API v2 integration
 *
 * Provides ABI fetching, source code metadata, and transaction listing
 * for Ethereum, Base, Arbitrum, and other Etherscan-supported chains.
 */

type EtherscanResponse = {
  status: string;
  message: string;
  result: string;
};

type EtherscanSourceCodeResponse = {
  status: string;
  message: string;
  result: Array<{
    Proxy?: string;
    Implementation?: string;
    ABI?: string;
    ContractName?: string;
    Facets?: string;
    IsDiamond?: string;
    [key: string]: unknown;
  }>;
};

export type AbiResult = {
  success: boolean;
  abi?: unknown[];
  error?: string;
};

export type SourceCodeResult = {
  success: boolean;
  isProxy?: boolean;
  isDiamond?: boolean;
  implementationAddress?: string;
  facetAddresses?: string[];
  contractName?: string;
  proxyAbi?: string;
  error?: string;
};

/**
 * Fetch ABI from Etherscan API v2
 *
 * @param apiUrl - Base API URL (e.g., "https://api.etherscan.io/v2/api")
 * @param chainId - Chain ID for the request
 * @param contractAddress - Contract address to fetch ABI for
 * @param apiKey - Optional Etherscan API key (recommended for rate limits)
 */
export async function fetchEtherscanAbi(
  apiUrl: string,
  chainId: number,
  contractAddress: string,
  apiKey?: string
): Promise<AbiResult> {
  const params = new URLSearchParams({
    chainid: chainId.toString(),
    module: "contract",
    action: "getabi",
    address: contractAddress,
  });

  if (apiKey) {
    params.set("apikey", apiKey);
  }

  try {
    const response = await fetch(`${apiUrl}?${params}`);
    const data: EtherscanResponse = await response.json();

    if (data.status !== "1") {
      // Parse common Etherscan error messages
      const errorMessage = parseEtherscanError(data.result || data.message);
      return {
        success: false,
        error: errorMessage,
      };
    }

    const abi = JSON.parse(data.result);
    return { success: true, abi };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Fetch source code and proxy metadata from Etherscan API v2
 *
 * @param apiUrl - Base API URL (e.g., "https://api.etherscan.io/v2/api")
 * @param chainId - Chain ID for the request
 * @param contractAddress - Contract address to fetch source code for
 * @param apiKey - Optional Etherscan API key (recommended for rate limits)
 */
export async function fetchEtherscanSourceCode(
  apiUrl: string,
  chainId: number,
  contractAddress: string,
  apiKey?: string
): Promise<SourceCodeResult> {
  const params = new URLSearchParams({
    chainid: chainId.toString(),
    module: "contract",
    action: "getsourcecode",
    address: contractAddress,
  });

  if (apiKey) {
    params.set("apikey", apiKey);
  }

  try {
    const response = await fetch(`${apiUrl}?${params}`);
    const data: EtherscanSourceCodeResponse = await response.json();

    if (data.status !== "1") {
      const errorMessage = parseEtherscanError(
        data.message || "Failed to fetch source code"
      );
      return {
        success: false,
        error: errorMessage,
      };
    }

    if (!data.result || data.result.length === 0) {
      return {
        success: false,
        error: "No source code data returned from Etherscan",
      };
    }

    const contractData = data.result[0];
    const isProxy = contractData.Proxy === "1";
    const isDiamond = contractData.IsDiamond === "1";
    const implementationAddress = contractData.Implementation;
    const contractName = contractData.ContractName;

    // Parse facet addresses if this is a Diamond contract
    let facetAddresses: string[] | undefined;
    if (isDiamond && contractData.Facets) {
      facetAddresses = contractData.Facets.split(",")
        .map((addr) => addr.trim())
        .filter((addr) => addr.length > 0);
    }

    return {
      success: true,
      isProxy,
      isDiamond,
      implementationAddress: implementationAddress || undefined,
      facetAddresses,
      contractName: contractName || undefined,
      proxyAbi: contractData.ABI || undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export type EtherscanTransaction = {
  hash: string;
  from: string;
  to: string;
  value: string;
  input: string;
  blockNumber: string;
  timeStamp: string;
  isError: string;
  functionName: string;
};

type EtherscanTxListResponse = {
  status: string;
  message: string;
  result: EtherscanTransaction[] | string;
};

const ETHERSCAN_TX_PAGE_SIZE = 10_000;
const MAX_PAGES = 5;
const ETHERSCAN_PAGE_DELAY_MS = 220;

// Per-chain overrides for the txlist `offset` (page size). Real Etherscan
// accepts up to 10,000 per page, but some forked explorers cap it lower —
// e.g. 0G's chainscan rejects offset > 100 with "Parameter <offset> exceeds
// 100". Keep this map small; if more chains end up here, promote it to
// `explorer_configs` with a migration.
const TX_PAGE_SIZE_OVERRIDES: Record<number, number> = {
  16_601: 100, // 0G Galileo (legacy chain id)
  16_602: 100, // 0G Galileo
  16_661: 100, // 0G Mainnet
};

function getTxPageSize(chainId: number): number {
  return TX_PAGE_SIZE_OVERRIDES[chainId] ?? ETHERSCAN_TX_PAGE_SIZE;
}

type TxPageResult =
  | { done: false; transactions: EtherscanTransaction[] }
  | { done: true; transactions: EtherscanTransaction[] }
  | { error: string };

function buildTxListParams(
  apiUrl: string,
  chainId: number,
  contractAddress: string,
  startBlock: number,
  endBlock: number,
  page: number,
  apiKey?: string
): string {
  const params = new URLSearchParams({
    chainid: chainId.toString(),
    module: "account",
    action: "txlist",
    address: contractAddress,
    startblock: startBlock.toString(),
    endblock: endBlock.toString(),
    page: page.toString(),
    offset: getTxPageSize(chainId).toString(),
    sort: "asc",
  });

  if (apiKey) {
    params.set("apikey", apiKey);
  }

  return `${apiUrl}?${params}`;
}

function isEmptyTxListResult(data: EtherscanTxListResponse): boolean {
  if (Array.isArray(data.result) && data.result.length === 0) {
    return true;
  }
  if (typeof data.result !== "string") {
    return false;
  }
  const lower = data.result.toLowerCase();
  return (
    lower.includes("no transactions found") ||
    lower.includes("no records found")
  );
}

function parseTxListResponse(
  data: EtherscanTxListResponse,
  pageSize: number,
): TxPageResult {
  if (data.status !== "1") {
    if (isEmptyTxListResult(data)) {
      return { done: true, transactions: [] };
    }
    const errorMessage = parseEtherscanError(
      typeof data.result === "string" ? data.result : data.message
    );
    return { error: errorMessage };
  }

  if (!Array.isArray(data.result)) {
    return { done: true, transactions: [] };
  }

  const hasMore = data.result.length >= pageSize;
  return { done: !hasMore, transactions: data.result };
}

/**
 * Fetch transaction list for a contract address from Etherscan API v2
 *
 * Uses the `account` module `txlist` action to get normal transactions.
 * Paginates automatically (max 10,000 per page, up to MAX_PAGES pages).
 *
 * @param apiUrl - Base API URL (e.g., "https://api.etherscan.io/v2/api")
 * @param chainId - Chain ID for the request
 * @param contractAddress - Contract address to list transactions for
 * @param startBlock - Start block number
 * @param endBlock - End block number
 * @param apiKey - Optional Etherscan API key (recommended for rate limits)
 */
export async function fetchEtherscanTransactions(
  apiUrl: string,
  chainId: number,
  contractAddress: string,
  startBlock: number,
  endBlock: number,
  apiKey?: string
): Promise<
  | { success: true; transactions: EtherscanTransaction[] }
  | { success: false; error: string }
> {
  const allTransactions: EtherscanTransaction[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, ETHERSCAN_PAGE_DELAY_MS)
      );
    }

    const url = buildTxListParams(
      apiUrl,
      chainId,
      contractAddress,
      startBlock,
      endBlock,
      page,
      apiKey
    );

    try {
      const response = await fetch(url);
      const data: EtherscanTxListResponse = await response.json();
      const result = parseTxListResponse(data, getTxPageSize(chainId));

      if ("error" in result) {
        return { success: false, error: result.error };
      }

      allTransactions.push(...result.transactions);

      if (result.done) {
        break;
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error fetching transactions",
      };
    }
  }

  return { success: true, transactions: allTransactions };
}

/**
 * Parse Etherscan error messages into user-friendly messages
 */
function parseEtherscanError(message: string): string {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("contract source code not verified")) {
    return "Contract source code is not verified on the block explorer";
  }

  if (lowerMessage.includes("invalid api key")) {
    return "Invalid Etherscan API key";
  }

  if (lowerMessage.includes("rate limit")) {
    return "Rate limit exceeded. Please try again later.";
  }

  if (lowerMessage.includes("invalid address")) {
    return "Invalid contract address";
  }

  return message || "Failed to fetch ABI from Etherscan";
}
