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

vi.mock("@/lib/web3/resolve-org-context", () => ({
  resolveOrganizationContext: vi.fn(),
}));

const {
  acknowledgeProviderSigner,
  getServiceMetadata,
  getRequestHeaders,
  processResponse,
} = vi.hoisted(() => ({
  acknowledgeProviderSigner: vi.fn().mockResolvedValue(undefined),
  getServiceMetadata: vi.fn().mockResolvedValue({
    endpoint: "https://provider.example/v1/proxy",
    model: "qwen",
  }),
  getRequestHeaders: vi.fn().mockResolvedValue({ "x-zg-auth": "sig" }),
  processResponse: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../plugins/0g-compute/server-core", () => ({
  buildBrokerContext: vi.fn(),
}));

import { fetchCredentials } from "@/lib/credential-fetcher";
import { resolveOrganizationContext } from "@/lib/web3/resolve-org-context";
import {
  resolveZeroGComputeChainId,
  ZERO_G_COMPUTE_DEFAULT_CHAIN_ID,
} from "../../plugins/0g-compute/credentials";
import { buildBrokerContext } from "../../plugins/0g-compute/server-core";
import { inferenceStep } from "../../plugins/0g-compute/steps/inference";

type BrokerSetup = Awaited<ReturnType<typeof buildBrokerContext>>;
type BrokerContext = Extract<BrokerSetup, { ok: true }>["context"];

const fetchCredentialsMock = vi.mocked(fetchCredentials);
const resolveOrgContextMock = vi.mocked(resolveOrganizationContext);
const buildBrokerContextMock = vi.mocked(buildBrokerContext);
const originalFetch = global.fetch;

const STUB_BROKER = {
  inference: {
    acknowledgeProviderSigner,
    getServiceMetadata,
    getRequestHeaders,
    processResponse,
  },
};

const STUB_CONTEXT = {
  broker: STUB_BROKER,
  signer: {},
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  chainId: 16_601,
};

const CTX = {
  executionId: "exec_1",
  organizationId: "org_1",
  nodeId: "node_1",
  nodeName: "infer",
  nodeType: "0g-compute",
};

beforeEach(() => {
  fetchCredentialsMock.mockReset();
  resolveOrgContextMock.mockReset();
  buildBrokerContextMock.mockReset();
  acknowledgeProviderSigner.mockClear();
  getServiceMetadata.mockClear();
  getRequestHeaders.mockClear();
  processResponse.mockClear();
  resolveOrgContextMock.mockResolvedValue({
    success: true,
    organizationId: "org_1",
    userId: "user_1",
  });
  // biome-ignore lint/performance/noDelete: assigning undefined coerces to "undefined" string in process.env
  delete process.env.ZERO_G_COMPUTE_CHAIN_ID;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("resolveZeroGComputeChainId", () => {
  it("defaults to testnet chain id", () => {
    expect(resolveZeroGComputeChainId({})).toBe(
      ZERO_G_COMPUTE_DEFAULT_CHAIN_ID
    );
  });

  it("parses chain id from credentials", () => {
    expect(
      resolveZeroGComputeChainId({ ZERO_G_COMPUTE_CHAIN_ID: "16661" })
    ).toBe(16_661);
  });

  it("falls back to default when value is not a number", () => {
    expect(resolveZeroGComputeChainId({ ZERO_G_COMPUTE_CHAIN_ID: "abc" })).toBe(
      ZERO_G_COMPUTE_DEFAULT_CHAIN_ID
    );
  });
});

describe("inferenceStep", () => {
  it("requires providerAddress and prompt", async () => {
    fetchCredentialsMock.mockResolvedValue({});

    const result = await inferenceStep({
      providerAddress: "",
      prompt: "",
      integrationId: "int_1",
      _context: CTX,
    });

    expect(result).toEqual({
      success: false,
      error: "providerAddress and prompt are required",
    });
    expect(buildBrokerContextMock).not.toHaveBeenCalled();
  });

  it("requires execution or organization id in the workflow context", async () => {
    fetchCredentialsMock.mockResolvedValue({});

    const result = await inferenceStep({
      providerAddress: "0x0000000000000000000000000000000000000001",
      prompt: "hi",
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: false,
      error: "Execution ID or organization ID is required",
    });
  });

  it("propagates configuration errors when the broker cannot be initialized", async () => {
    fetchCredentialsMock.mockResolvedValue({});
    buildBrokerContextMock.mockResolvedValue({
      ok: false,
      error: "Failed to initialize 0G compute broker: no wallet for org",
    });

    const result = await inferenceStep({
      providerAddress: "0x0000000000000000000000000000000000000001",
      prompt: "hi",
      integrationId: "int_1",
      _context: CTX,
    });

    expect(result).toEqual({
      success: false,
      error: "Failed to initialize 0G compute broker: no wallet for org",
    });
  });

  it("returns inference result on success", async () => {
    fetchCredentialsMock.mockResolvedValue({});
    buildBrokerContextMock.mockResolvedValue({
      ok: true,
      context: STUB_CONTEXT as unknown as BrokerContext,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "chat_1",
        choices: [{ message: { content: "hello" } }],
      }),
    } as Response);

    const result = await inferenceStep({
      providerAddress: "0x0000000000000000000000000000000000000001",
      prompt: "hi",
      integrationId: "int_1",
      _context: CTX,
    });

    expect(result).toEqual({
      success: true,
      output: "hello",
      model: "qwen",
      provider: "0x0000000000000000000000000000000000000001",
      chatId: "chat_1",
      verified: true,
    });
    expect(acknowledgeProviderSigner).toHaveBeenCalledWith(
      "0x0000000000000000000000000000000000000001"
    );
    expect(getRequestHeaders).toHaveBeenCalled();
    expect(buildBrokerContextMock).toHaveBeenCalledWith({}, "org_1", "user_1");
  });

  it("surfaces HTTP errors from the provider", async () => {
    fetchCredentialsMock.mockResolvedValue({});
    buildBrokerContextMock.mockResolvedValue({
      ok: true,
      context: STUB_CONTEXT as unknown as BrokerContext,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
    } as Response);

    const result = await inferenceStep({
      providerAddress: "0x0000000000000000000000000000000000000001",
      prompt: "hi",
      integrationId: "int_1",
      _context: CTX,
    });

    expect(result).toEqual({
      success: false,
      error: "0G Compute inference failed: HTTP 502 -- bad gateway",
    });
  });
});
