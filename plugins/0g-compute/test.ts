import { getRpcProvider } from "@/lib/rpc/provider-factory";
import {
  resolveZeroGComputeChainId,
  type ZeroGComputeCredentials,
} from "./credentials";

type TestResult = { success: true } | { success: false; error: string };

export async function testZeroGCompute(
  credentials: Record<string, string>
): Promise<TestResult> {
  const chainId = resolveZeroGComputeChainId(
    credentials as ZeroGComputeCredentials
  );

  try {
    const rpcManager = await getRpcProvider({ chainId });
    const rpcUrl = await rpcManager.resolveActiveRpcUrl();

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_blockNumber",
        params: [],
        id: 1,
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `0G chain RPC at ${rpcUrl} returned HTTP ${response.status}`,
      };
    }

    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error) {
      return {
        success: false,
        error: `0G chain RPC error: ${body.error.message ?? "unknown"}`,
      };
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Could not reach 0G chain ${chainId}: ${message}`,
    };
  }
}
