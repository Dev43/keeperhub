import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { ErrorCategory, logUserError } from "@/lib/logging";
import { withPluginMetrics } from "@/lib/metrics/instrumentation/plugin";
import { type StepInput, withStepLogging } from "@/lib/workflow/executor/step-handler";
import { getErrorMessage } from "@/lib/utils";
import {
  resolveZeroGIndexerUrl,
  type ZeroGStorageCredentials,
} from "../credentials";
import {
  decodeStreamData,
  findEntry,
  type StreamWriteEntry,
} from "./kv-get-core";

const LOG_CONTEXT = {
  plugin_name: "0g-storage",
  action_name: "kv-get",
  service: "0g-storage",
} as const;

export type KvGetCoreInput = {
  rootHash: string;
  streamId?: string;
  key?: string;
  network?: string;
};

export type KvGetInput = StepInput &
  KvGetCoreInput & {
    integrationId?: string;
  };

type KvGetResult =
  | {
      success: true;
      value: string | null;
      streamId: string | null;
      key: string | null;
      entries: StreamWriteEntry[];
      size: number;
    }
  | { success: false; error: string };

const ROOT_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

async function stepHandler(
  input: KvGetCoreInput,
  credentials: ZeroGStorageCredentials
): Promise<KvGetResult> {
  if (!input.rootHash) {
    logUserError(
      ErrorCategory.VALIDATION,
      "[0G Storage] kv-get missing rootHash",
      input,
      LOG_CONTEXT
    );
    return { success: false, error: "rootHash is required" };
  }

  if (!ROOT_HASH_PATTERN.test(input.rootHash)) {
    return {
      success: false,
      error: "rootHash must be a 0x-prefixed 32-byte hex string",
    };
  }

  const indexerUrl = resolveZeroGIndexerUrl(credentials).replace(/\/$/, "");
  const url = `${indexerUrl}/file?root=${input.rootHash}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logUserError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[0G Storage] kv-get HTTP error",
        { status: response.status, body: text.slice(0, 500) },
        LOG_CONTEXT
      );
      return {
        success: false,
        error: `0G Storage download failed: HTTP ${response.status}${
          text ? ` -- ${text.slice(0, 200)}` : ""
        }`,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const decoded = decodeStreamData(buffer);
    if (!decoded.ok) {
      return { success: false, error: decoded.error };
    }

    const match = findEntry(decoded.entries, input.streamId, input.key);

    return {
      success: true,
      value: match?.value ?? null,
      streamId: match?.streamId ?? null,
      key: match?.key ?? null,
      entries: decoded.entries,
      size: buffer.length,
    };
  } catch (error) {
    logUserError(
      ErrorCategory.NETWORK_RPC,
      "[0G Storage] kv-get failed",
      error,
      LOG_CONTEXT
    );
    return {
      success: false,
      error: `0G Storage download failed: ${getErrorMessage(error)}`,
    };
  }
}

export async function kvGetStep(input: KvGetInput): Promise<KvGetResult> {
  "use step";

  const credentials = input.integrationId
    ? ((await fetchCredentials(
        input.integrationId
      )) as ZeroGStorageCredentials)
    : {};

  return withPluginMetrics(
    {
      pluginName: "0g-storage",
      actionName: "kv-get",
      executionId: input._context?.executionId,
    },
    () =>
      withStepLogging(input, () =>
        stepHandler(
          {
            rootHash: input.rootHash,
            streamId: input.streamId,
            key: input.key,
            network: input.network,
          },
          input.network
            ? { ...credentials, ZERO_G_CHAIN_ID: input.network }
            : credentials
        )
      )
  );
}

export const _integrationType = "0g-storage";
