import {
  resolveZeroGStorageIndexerUrl,
  type ZeroGStorageCredentials,
} from "./credentials";

type TestResult = { success: true } | { success: false; error: string };

export async function testZeroGStorage(
  credentials: Record<string, string>
): Promise<TestResult> {
  const indexerUrl = resolveZeroGStorageIndexerUrl(
    credentials as ZeroGStorageCredentials
  );

  try {
    const response = await fetch(`${indexerUrl}/status`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (response.ok || response.status === 404) {
      return { success: true };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error:
          "0G Storage indexer rejected the request. Verify the indexer URL and credentials.",
      };
    }

    return {
      success: false,
      error: `0G Storage indexer reachable but returned HTTP ${response.status}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Could not reach 0G Storage indexer at ${indexerUrl}: ${message}`,
    };
  }
}
