import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../plugins/0g-storage/server-core", () => ({
  buildWriteContext: vi.fn(),
  buildReadContext: vi.fn(),
  writeKvEntry: vi.fn(),
  uploadBlob: vi.fn(),
}));

import { fetchCredentials } from "@/lib/credential-fetcher";
import { resolveOrganizationContext } from "@/lib/web3/resolve-org-context";
import {
  buildReadContext,
  buildWriteContext,
  uploadBlob,
  writeKvEntry,
} from "../../plugins/0g-storage/server-core";
import {
  resolveZeroGChainId,
  resolveZeroGFlowAddress,
  resolveZeroGIndexerUrl,
  resolveZeroGKvNodeUrl,
  ZERO_G_DEFAULT_CHAIN_ID,
  ZERO_G_DEFAULT_FLOW_ADDRESS,
  ZERO_G_DEFAULT_INDEXER_URL,
  ZERO_G_DEFAULT_KV_NODE_URL,
} from "../../plugins/0g-storage/credentials";
import { kvGetStep } from "../../plugins/0g-storage/steps/kv-get";
import { kvPutStep } from "../../plugins/0g-storage/steps/kv-put";
import { logAppendStep } from "../../plugins/0g-storage/steps/log-append";

const fetchCredentialsMock = vi.mocked(fetchCredentials);
const resolveOrgContextMock = vi.mocked(resolveOrganizationContext);
const buildWriteContextMock = vi.mocked(buildWriteContext);
const buildReadContextMock = vi.mocked(buildReadContext);
const writeKvEntryMock = vi.mocked(writeKvEntry);
const uploadBlobMock = vi.mocked(uploadBlob);

const STUB_CONTEXT = {
  signer: {},
  indexer: {},
  rpcUrl: "rpc",
  flowAddress: "0xflow",
  chainId: 16_601,
};

const CTX = {
  executionId: "exec_1",
  organizationId: "org_1",
  nodeId: "node_1",
  nodeName: "kv-test",
  nodeType: "0g-storage",
};

beforeEach(() => {
  fetchCredentialsMock.mockReset();
  resolveOrgContextMock.mockReset();
  buildWriteContextMock.mockReset();
  buildReadContextMock.mockReset();
  writeKvEntryMock.mockReset();
  uploadBlobMock.mockReset();
  resolveOrgContextMock.mockResolvedValue({
    success: true,
    organizationId: "org_1",
    userId: "user_1",
  });
  // biome-ignore lint/performance/noDelete: assigning undefined coerces to "undefined" string in process.env
  delete process.env.ZERO_G_INDEXER_URL;
  // biome-ignore lint/performance/noDelete: see above
  delete process.env.ZERO_G_KV_NODE_URL;
  // biome-ignore lint/performance/noDelete: see above
  delete process.env.ZERO_G_FLOW_ADDRESS;
  // biome-ignore lint/performance/noDelete: see above
  delete process.env.ZERO_G_CHAIN_ID;
});

describe("credential resolvers", () => {
  it("returns testnet defaults when nothing is configured", () => {
    expect(resolveZeroGIndexerUrl({})).toBe(ZERO_G_DEFAULT_INDEXER_URL);
    expect(resolveZeroGKvNodeUrl({})).toBe(ZERO_G_DEFAULT_KV_NODE_URL);
    expect(resolveZeroGFlowAddress({})).toBe(ZERO_G_DEFAULT_FLOW_ADDRESS);
    expect(resolveZeroGChainId({})).toBe(ZERO_G_DEFAULT_CHAIN_ID);
  });

  it("prefers credentials over env vars", () => {
    process.env.ZERO_G_INDEXER_URL = "https://env.example";
    expect(
      resolveZeroGIndexerUrl({ ZERO_G_INDEXER_URL: "https://creds.example" })
    ).toBe("https://creds.example");
  });

  it("falls back to env vars when credentials are blank", () => {
    process.env.ZERO_G_KV_NODE_URL = "https://kv.env.example";
    expect(resolveZeroGKvNodeUrl({})).toBe("https://kv.env.example");
  });

  it("parses chain id from credentials", () => {
    expect(resolveZeroGChainId({ ZERO_G_CHAIN_ID: "16661" })).toBe(16_661);
  });

  it("falls back to default chain id when value is not a number", () => {
    expect(resolveZeroGChainId({ ZERO_G_CHAIN_ID: "abc" })).toBe(
      ZERO_G_DEFAULT_CHAIN_ID
    );
  });
});

describe("kvGetStep", () => {
  it("rejects empty streamId or key", async () => {
    fetchCredentialsMock.mockResolvedValue({});

    const result = await kvGetStep({
      streamId: "",
      key: "",
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: false,
      error: "streamId and key are required",
    });
    expect(buildReadContextMock).not.toHaveBeenCalled();
  });

  it("returns null when the KV node has no entry", async () => {
    fetchCredentialsMock.mockResolvedValue({});
    buildReadContextMock.mockReturnValue({
      kv: { getValue: vi.fn().mockResolvedValue(null) },
    } as unknown as ReturnType<typeof buildReadContext>);

    const result = await kvGetStep({
      streamId: "0xstream",
      key: "k",
      integrationId: "int_1",
    });

    expect(result).toEqual({ success: true, value: null, version: null });
  });

  it("decodes base64 values from the KV node", async () => {
    fetchCredentialsMock.mockResolvedValue({});
    const encoded = Buffer.from("hello", "utf-8").toString("base64");
    buildReadContextMock.mockReturnValue({
      kv: {
        getValue: vi
          .fn()
          .mockResolvedValue({ data: encoded, version: 7, size: 5 }),
      },
    } as unknown as ReturnType<typeof buildReadContext>);

    const result = await kvGetStep({
      streamId: "0xstream",
      key: "k",
      integrationId: "int_1",
    });

    expect(result).toEqual({ success: true, value: "hello", version: 7 });
  });
});

describe("kvPutStep", () => {
  it("rejects empty streamId or key before touching the SDK", async () => {
    fetchCredentialsMock.mockResolvedValue({});

    const result = await kvPutStep({
      streamId: "",
      key: "",
      value: "v",
      integrationId: "int_1",
      _context: CTX,
    });

    expect(result).toEqual({
      success: false,
      error: "streamId and key are required",
    });
    expect(buildWriteContextMock).not.toHaveBeenCalled();
  });

  it("requires execution or organization id in the workflow context", async () => {
    fetchCredentialsMock.mockResolvedValue({});

    const result = await kvPutStep({
      streamId: "0xs",
      key: "k",
      value: "v",
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: false,
      error: "Execution ID or organization ID is required",
    });
  });

  it("propagates configuration errors when the wallet cannot be initialized", async () => {
    fetchCredentialsMock.mockResolvedValue({});
    buildWriteContextMock.mockResolvedValue({
      ok: false,
      error: "Failed to initialize 0G client: no wallet for org",
    });

    const result = await kvPutStep({
      streamId: "0xs",
      key: "k",
      value: "v",
      integrationId: "int_1",
      _context: CTX,
    });

    expect(result).toEqual({
      success: false,
      error: "Failed to initialize 0G client: no wallet for org",
    });
  });

  it("returns txHash and rootHash when the batcher commits the write", async () => {
    fetchCredentialsMock.mockResolvedValue({});
    buildWriteContextMock.mockResolvedValue({
      ok: true,
      context: STUB_CONTEXT as unknown as Parameters<typeof writeKvEntry>[0],
    });
    writeKvEntryMock.mockResolvedValue({
      ok: true,
      txHash: "0xhash",
      rootHash: "0xroot",
    });

    const result = await kvPutStep({
      streamId: "0xs",
      key: "k",
      value: "v",
      integrationId: "int_1",
      _context: CTX,
    });

    expect(result).toEqual({
      success: true,
      txHash: "0xhash",
      rootHash: "0xroot",
    });
    expect(buildWriteContextMock).toHaveBeenCalledWith({}, "org_1", "user_1");
    const call = writeKvEntryMock.mock.calls[0];
    expect(call?.[1]).toBe("0xs");
    expect(call?.[2]).toBeInstanceOf(Uint8Array);
    expect(call?.[3]).toBeInstanceOf(Uint8Array);
  });

  it("surfaces batcher exec errors", async () => {
    fetchCredentialsMock.mockResolvedValue({});
    buildWriteContextMock.mockResolvedValue({
      ok: true,
      context: STUB_CONTEXT as unknown as Parameters<typeof writeKvEntry>[0],
    });
    writeKvEntryMock.mockResolvedValue({
      ok: false,
      error: "0G batcher exec failed: insufficient funds",
    });

    const result = await kvPutStep({
      streamId: "0xs",
      key: "k",
      value: "v",
      integrationId: "int_1",
      _context: CTX,
    });

    expect(result).toEqual({
      success: false,
      error: "0G batcher exec failed: insufficient funds",
    });
  });
});

describe("logAppendStep", () => {
  it("rejects empty payload", async () => {
    fetchCredentialsMock.mockResolvedValue({});

    const result = await logAppendStep({
      streamId: "0xs",
      payload: "",
      integrationId: "int_1",
      _context: CTX,
    });

    expect(result).toEqual({
      success: false,
      error: "streamId and payload are required",
    });
    expect(buildWriteContextMock).not.toHaveBeenCalled();
  });

  it("returns rootHash and txHash on success", async () => {
    fetchCredentialsMock.mockResolvedValue({});
    buildWriteContextMock.mockResolvedValue({
      ok: true,
      context: STUB_CONTEXT as unknown as Parameters<typeof writeKvEntry>[0],
    });
    uploadBlobMock.mockResolvedValue({
      ok: true,
      txHash: "0xtx",
      rootHash: "0xroot",
    });

    const result = await logAppendStep({
      streamId: "0xs",
      payload: "p",
      tag: "incident",
      integrationId: "int_1",
      _context: CTX,
    });

    expect(result).toEqual({
      success: true,
      rootHash: "0xroot",
      txHash: "0xtx",
    });
    expect(uploadBlobMock).toHaveBeenCalledTimes(1);
    expect(uploadBlobMock.mock.calls[0]?.[1]).toBeInstanceOf(Uint8Array);
  });

  it("surfaces upload errors", async () => {
    fetchCredentialsMock.mockResolvedValue({});
    buildWriteContextMock.mockResolvedValue({
      ok: true,
      context: STUB_CONTEXT as unknown as Parameters<typeof writeKvEntry>[0],
    });
    uploadBlobMock.mockResolvedValue({
      ok: false,
      error: "0G blob upload failed: timeout",
    });

    const result = await logAppendStep({
      streamId: "0xs",
      payload: "p",
      integrationId: "int_1",
      _context: CTX,
    });

    expect(result).toEqual({
      success: false,
      error: "0G blob upload failed: timeout",
    });
  });
});
