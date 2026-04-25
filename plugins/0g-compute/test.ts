import {
  resolveZeroGComputeGatewayUrl,
  type ZeroGComputeCredentials,
} from "./credentials";

type TestResult = { success: true } | { success: false; error: string };

export async function testZeroGCompute(
  credentials: Record<string, string>
): Promise<TestResult> {
  const gatewayUrl = resolveZeroGComputeGatewayUrl(
    credentials as ZeroGComputeCredentials
  );
  const apiKey = credentials.ZERO_G_COMPUTE_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      error: "ZERO_G_COMPUTE_API_KEY is not configured",
    };
  }

  try {
    const response = await fetch(`${gatewayUrl}/v1/models`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return { success: true };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error: "Invalid API key. Please check your 0G Compute API key.",
      };
    }

    if (response.status === 404) {
      return { success: true };
    }

    return {
      success: false,
      error: `0G Compute gateway returned HTTP ${response.status}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Could not reach 0G Compute gateway at ${gatewayUrl}: ${message}`,
    };
  }
}
