import {
  resolveZeroGIndexerUrl,
  type ZeroGStorageCredentials,
} from "./credentials";

type TestResult = { success: true } | { success: false; error: string };

export async function testZeroGStorage(
  credentials: Record<string, string>
): Promise<TestResult> {
  const indexerUrl = resolveZeroGIndexerUrl(
    credentials as ZeroGStorageCredentials
  );

  try {
    const response = await fetch(`${indexerUrl}/`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    // Indexer responds even for unknown paths; any 2xx/3xx/4xx means it's
    // reachable. Only treat 5xx and network errors as failures.
    if (response.status >= 500) {
      return {
        success: false,
        error: `0G Storage indexer reachable but returned HTTP ${response.status}`,
      };
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Could not reach 0G Storage indexer at ${indexerUrl}: ${message}`,
    };
  }
}
