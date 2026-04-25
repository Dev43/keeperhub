import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/steps/step-handler", () => ({
  withStepLogging: (_input: unknown, fn: () => unknown) => fn(),
}));

vi.mock("@/lib/metrics/instrumentation/plugin", () => ({
  withPluginMetrics: (_opts: unknown, fn: () => unknown) => fn(),
}));

vi.mock("@/lib/logging", () => ({
  ErrorCategory: {
    VALIDATION: "validation",
    CONFIGURATION: "configuration",
    EXTERNAL_SERVICE: "external_service",
    NETWORK_RPC: "network_rpc",
  },
  logUserError: vi.fn(),
}));

vi.mock("@/lib/credential-fetcher", () => ({
  fetchCredentials: vi.fn(),
}));

import { fetchCredentials } from "@/lib/credential-fetcher";
import {
  resolveZeroGComputeGatewayUrl,
  resolveZeroGComputeNetwork,
  ZERO_G_COMPUTE_GATEWAY_URLS,
} from "../../plugins/0g-compute/credentials";
import { sealedInferenceStep } from "../../plugins/0g-compute/steps/sealed-inference";

const fetchCredentialsMock = vi.mocked(fetchCredentials);
const originalFetch = global.fetch;

beforeEach(() => {
  fetchCredentialsMock.mockReset();
  delete process.env.ZERO_G_COMPUTE_GATEWAY_URL;
  delete process.env.ZERO_G_COMPUTE_NETWORK;
  delete process.env.ZERO_G_COMPUTE_API_KEY;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("resolveZeroGComputeNetwork", () => {
  it("defaults to testnet", () => {
    expect(resolveZeroGComputeNetwork(undefined)).toBe("testnet");
    expect(resolveZeroGComputeNetwork("garbage")).toBe("testnet");
  });

  it("recognizes mainnet", () => {
    expect(resolveZeroGComputeNetwork("mainnet")).toBe("mainnet");
  });
});

describe("resolveZeroGComputeGatewayUrl", () => {
  it("prefers explicit gateway URL", () => {
    expect(
      resolveZeroGComputeGatewayUrl({
        ZERO_G_COMPUTE_GATEWAY_URL: "https://custom.example",
        ZERO_G_COMPUTE_NETWORK: "testnet",
      })
    ).toBe("https://custom.example");
  });

  it("uses mainnet gateway when network=mainnet", () => {
    expect(
      resolveZeroGComputeGatewayUrl({ ZERO_G_COMPUTE_NETWORK: "mainnet" })
    ).toBe(ZERO_G_COMPUTE_GATEWAY_URLS.mainnet);
  });

  it("defaults to testnet gateway", () => {
    expect(resolveZeroGComputeGatewayUrl({})).toBe(
      ZERO_G_COMPUTE_GATEWAY_URLS.testnet
    );
  });
});

describe("sealedInferenceStep", () => {
  it("requires an API key", async () => {
    fetchCredentialsMock.mockResolvedValue({});

    const result = await sealedInferenceStep({
      model: "qwen2.5-0.5b",
      prompt: "hi",
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: false,
      error:
        "ZERO_G_COMPUTE_API_KEY is not configured. Add it in Project Integrations.",
    });
  });

  it("requires model and prompt", async () => {
    fetchCredentialsMock.mockResolvedValue({
      ZERO_G_COMPUTE_API_KEY: "k",
    });

    const result = await sealedInferenceStep({
      model: "",
      prompt: "",
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: false,
      error: "model and prompt are required",
    });
  });

  it("returns inference result on success", async () => {
    fetchCredentialsMock.mockResolvedValue({
      ZERO_G_COMPUTE_API_KEY: "k",
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          output: "hello",
          attestation: "att",
          modelHash: "mh",
        },
      }),
    } as Response);

    const result = await sealedInferenceStep({
      model: "qwen2.5-0.5b",
      prompt: "hi",
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: true,
      output: "hello",
      attestation: "att",
      modelHash: "mh",
    });
  });

  it("uses mainnet gateway when configured", async () => {
    fetchCredentialsMock.mockResolvedValue({
      ZERO_G_COMPUTE_API_KEY: "k",
      ZERO_G_COMPUTE_NETWORK: "mainnet",
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { output: "" } }),
    } as Response);
    global.fetch = fetchSpy;

    await sealedInferenceStep({
      model: "m",
      prompt: "p",
      integrationId: "int_1",
    });

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl.startsWith(ZERO_G_COMPUTE_GATEWAY_URLS.mainnet)).toBe(
      true
    );
  });
});
