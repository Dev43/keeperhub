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
  writeKvEntry: vi.fn(),
  uploadBlob: vi.fn(),
}));

import { fetchCredentials } from "@/lib/credential-fetcher";
import { resolveOrganizationContext } from "@/lib/web3/resolve-org-context";
import {
  resolveZeroGChainId,
  resolveZeroGFlowAddress,
  resolveZeroGIndexerUrl,
  ZERO_G_DEFAULT_CHAIN_ID,
  ZERO_G_DEFAULT_FLOW_ADDRESS,
  ZERO_G_DEFAULT_INDEXER_URL,
} from "../../plugins/0g-storage/credentials";
import {
  buildWriteContext,
  uploadBlob,
  writeKvEntry,
} from "../../plugins/0g-storage/server-core";
import { kvGetStep } from "../../plugins/0g-storage/steps/kv-get";
import { kvPutStep } from "../../plugins/0g-storage/steps/kv-put";
import { logAppendStep } from "../../plugins/0g-storage/steps/log-append";

const fetchCredentialsMock = vi.mocked(fetchCredentials);
const resolveOrgContextMock = vi.mocked(resolveOrganizationContext);
const buildWriteContextMock = vi.mocked(buildWriteContext);
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
  delete process.env.ZERO_G_FLOW_ADDRESS;
  // biome-ignore lint/performance/noDelete: see above
  delete process.env.ZERO_G_CHAIN_ID;
});

describe("credential resolvers", () => {
  it("returns testnet defaults when nothing is configured", () => {
    expect(resolveZeroGIndexerUrl({})).toBe(ZERO_G_DEFAULT_INDEXER_URL);
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
    process.env.ZERO_G_INDEXER_URL = "https://indexer.env.example";
    expect(resolveZeroGIndexerUrl({})).toBe("https://indexer.env.example");
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
  const VALID_ROOT =
    "0xe841020b75288d3a81f0c4e169158c25d6abe671b23e1f0b07ea0d72cde5dc18";
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    fetchSpy.mockReset();
  });

  it("rejects an empty rootHash", async () => {
    fetchCredentialsMock.mockResolvedValue({});

    const result = await kvGetStep({
      rootHash: "",
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: false,
      error: "rootHash is required",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a malformed rootHash", async () => {
    fetchCredentialsMock.mockResolvedValue({});

    const result = await kvGetStep({
      rootHash: "0xnothex",
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: false,
      error: "rootHash must be a 0x-prefixed 32-byte hex string",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("downloads the blob and decodes the StreamData wire format", async () => {
    fetchCredentialsMock.mockResolvedValue({});
    // Wire layout: 8B version | 4B reads=0 | 4B writes=1 |
    //   32B streamId | 3B keySize=18 | 18B key | 8B valueSize=5 | 5B value
    const buf = Buffer.alloc(8 + 4 + 4 + 32 + 3 + 18 + 8 + 5);
    let off = 0;
    buf.writeBigUInt64BE(BigInt(1), off);
    off += 8;
    buf.writeUInt32BE(0, off);
    off += 4;
    buf.writeUInt32BE(1, off);
    off += 4;
    Buffer.from(
      "000000000000000000000000000000000000000000000000000000007068756c",
      "hex"
    ).copy(buf, off);
    off += 32;
    buf.writeUIntBE(18, off, 3);
    off += 3;
    buf.write("smoke/hello", off, "utf8");
    off += 18;
    buf.writeBigUInt64BE(BigInt(5), off);
    off += 8;
    buf.write("world", off, "utf8");

    fetchSpy.mockResolvedValue({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        ),
      headers: new Headers({ "content-type": "application/octet-stream" }),
    } as unknown as Response);

    const result = await kvGetStep({
      rootHash: VALID_ROOT,
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: true,
      value: "world",
      streamId:
        "0x000000000000000000000000000000000000000000000000000000007068756c",
      key: "smoke/hello",
      entries: [
        {
          streamId:
            "0x000000000000000000000000000000000000000000000000000000007068756c",
          key: "smoke/hello",
          value: "world",
        },
      ],
      size: buf.length,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      `${ZERO_G_DEFAULT_INDEXER_URL}/file?root=${VALID_ROOT}`,
      { method: "GET", redirect: "follow" }
    );
  });

  it("propagates indexer HTTP errors with the response body", async () => {
    fetchCredentialsMock.mockResolvedValue({});
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("not found"),
      headers: new Headers(),
    } as unknown as Response);

    const result = await kvGetStep({
      rootHash: VALID_ROOT,
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: false,
      error: "0G Storage download failed: HTTP 404 -- not found",
    });
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
