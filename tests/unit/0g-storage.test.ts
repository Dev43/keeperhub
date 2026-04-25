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
  resolveZeroGStorageIndexerUrl,
  resolveZeroGStorageNetwork,
  ZERO_G_STORAGE_INDEXER_URLS,
} from "../../plugins/0g-storage/credentials";
import { kvGetStep } from "../../plugins/0g-storage/steps/kv-get";
import { kvPutStep } from "../../plugins/0g-storage/steps/kv-put";
import { logAppendStep } from "../../plugins/0g-storage/steps/log-append";

const fetchCredentialsMock = vi.mocked(fetchCredentials);
const originalFetch = global.fetch;

function mockFetch(response: {
  ok: boolean;
  status?: number;
  body?: unknown;
}): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.body ?? {},
  } as Response);
}

beforeEach(() => {
  fetchCredentialsMock.mockReset();
  delete process.env.ZERO_G_STORAGE_INDEXER_URL;
  delete process.env.ZERO_G_STORAGE_NETWORK;
  delete process.env.ZERO_G_STORAGE_PRIVATE_KEY;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("resolveZeroGStorageNetwork", () => {
  it("defaults to testnet", () => {
    expect(resolveZeroGStorageNetwork(undefined)).toBe("testnet");
    expect(resolveZeroGStorageNetwork("")).toBe("testnet");
    expect(resolveZeroGStorageNetwork("garbage")).toBe("testnet");
  });

  it("recognizes mainnet", () => {
    expect(resolveZeroGStorageNetwork("mainnet")).toBe("mainnet");
  });
});

describe("resolveZeroGStorageIndexerUrl", () => {
  it("prefers explicit indexer URL over network selector", () => {
    expect(
      resolveZeroGStorageIndexerUrl({
        ZERO_G_STORAGE_INDEXER_URL: "https://custom.example",
        ZERO_G_STORAGE_NETWORK: "mainnet",
      })
    ).toBe("https://custom.example");
  });

  it("falls back to mainnet default when network=mainnet", () => {
    expect(
      resolveZeroGStorageIndexerUrl({ ZERO_G_STORAGE_NETWORK: "mainnet" })
    ).toBe(ZERO_G_STORAGE_INDEXER_URLS.mainnet);
  });

  it("falls back to testnet default when network is unset", () => {
    expect(resolveZeroGStorageIndexerUrl({})).toBe(
      ZERO_G_STORAGE_INDEXER_URLS.testnet
    );
  });

  it("uses ZERO_G_STORAGE_INDEXER_URL env var when credentials lack it", () => {
    process.env.ZERO_G_STORAGE_INDEXER_URL = "https://env.example";
    expect(
      resolveZeroGStorageIndexerUrl({ ZERO_G_STORAGE_NETWORK: "mainnet" })
    ).toBe("https://env.example");
  });
});

describe("kvGetStep", () => {
  it("returns the value on success", async () => {
    fetchCredentialsMock.mockResolvedValue({
      ZERO_G_STORAGE_NETWORK: "testnet",
    });
    mockFetch({
      ok: true,
      body: { data: { value: "hello", version: 3 } },
    });

    const result = await kvGetStep({
      streamId: "0xstream",
      key: "k",
      integrationId: "int_1",
    });

    expect(result).toEqual({ success: true, value: "hello", version: 3 });
  });

  it("rejects empty streamId/key", async () => {
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
  });

  it("returns HTTP error when indexer fails", async () => {
    fetchCredentialsMock.mockResolvedValue({});
    mockFetch({ ok: false, status: 502 });

    const result = await kvGetStep({
      streamId: "0xstream",
      key: "k",
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: false,
      error: "0G Storage KV get failed: HTTP 502",
    });
  });

  it("uses mainnet indexer when configured", async () => {
    fetchCredentialsMock.mockResolvedValue({
      ZERO_G_STORAGE_NETWORK: "mainnet",
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { value: null, version: null } }),
    } as Response);
    global.fetch = fetchSpy;

    await kvGetStep({
      streamId: "0xstream",
      key: "k",
      integrationId: "int_1",
    });

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl.startsWith(ZERO_G_STORAGE_INDEXER_URLS.mainnet)).toBe(
      true
    );
  });
});

describe("kvPutStep", () => {
  it("requires a private key", async () => {
    fetchCredentialsMock.mockResolvedValue({});

    const result = await kvPutStep({
      streamId: "0xs",
      key: "k",
      value: "v",
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: false,
      error:
        "ZERO_G_STORAGE_PRIVATE_KEY is not configured. Add it in Project Integrations.",
    });
  });

  it("succeeds when indexer accepts the write", async () => {
    fetchCredentialsMock.mockResolvedValue({
      ZERO_G_STORAGE_PRIVATE_KEY: "0xpk",
    });
    mockFetch({ ok: true, body: { data: { txHash: "0xhash" } } });

    const result = await kvPutStep({
      streamId: "0xs",
      key: "k",
      value: "v",
      integrationId: "int_1",
    });

    expect(result).toEqual({ success: true, txHash: "0xhash" });
  });
});

describe("logAppendStep", () => {
  it("requires a private key", async () => {
    fetchCredentialsMock.mockResolvedValue({});

    const result = await logAppendStep({
      streamId: "0xs",
      payload: "hello",
      integrationId: "int_1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects empty payload", async () => {
    fetchCredentialsMock.mockResolvedValue({
      ZERO_G_STORAGE_PRIVATE_KEY: "0xpk",
    });

    const result = await logAppendStep({
      streamId: "0xs",
      payload: "",
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: false,
      error: "streamId and payload are required",
    });
  });

  it("returns entryId and txHash on success", async () => {
    fetchCredentialsMock.mockResolvedValue({
      ZERO_G_STORAGE_PRIVATE_KEY: "0xpk",
    });
    mockFetch({
      ok: true,
      body: { data: { entryId: "e1", txHash: "0xh" } },
    });

    const result = await logAppendStep({
      streamId: "0xs",
      payload: "p",
      integrationId: "int_1",
    });

    expect(result).toEqual({
      success: true,
      entryId: "e1",
      txHash: "0xh",
    });
  });
});
