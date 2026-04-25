import "server-only";

import { toUtf8Bytes, toUtf8String } from "ethers";
import { fetchCredentials } from "@/lib/credential-fetcher";
import { ErrorCategory, logUserError } from "@/lib/logging";
import { withPluginMetrics } from "@/lib/metrics/instrumentation/plugin";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { getErrorMessage } from "@/lib/utils";
import { buildReadContext } from "../server-core";
import type { ZeroGStorageCredentials } from "../credentials";

const LOG_CONTEXT = {
  plugin_name: "0g-storage",
  action_name: "kv-get",
  service: "0g-storage",
} as const;

export type KvGetCoreInput = {
  streamId: string;
  key: string;
  network?: string;
};

export type KvGetInput = StepInput &
  KvGetCoreInput & {
    integrationId?: string;
  };

type KvGetResult =
  | { success: true; value: string | null; version: number | null }
  | { success: false; error: string };

function decodeBase64(data: string): string {
  try {
    return toUtf8String(Buffer.from(data, "base64"));
  } catch {
    return data;
  }
}

async function stepHandler(
  input: KvGetCoreInput,
  credentials: ZeroGStorageCredentials
): Promise<KvGetResult> {
  if (!(input.streamId && input.key)) {
    logUserError(
      ErrorCategory.VALIDATION,
      "[0G Storage] kv-get missing streamId or key",
      input,
      LOG_CONTEXT
    );
    return { success: false, error: "streamId and key are required" };
  }

  try {
    const { kv } = buildReadContext(credentials);
    const result = await kv.getValue(input.streamId, toUtf8Bytes(input.key));

    if (!result) {
      return { success: true, value: null, version: null };
    }

    return {
      success: true,
      value: decodeBase64(result.data),
      version: result.version,
    };
  } catch (error) {
    logUserError(
      ErrorCategory.EXTERNAL_SERVICE,
      "[0G Storage] kv-get failed",
      error,
      LOG_CONTEXT
    );
    return {
      success: false,
      error: `0G Storage KV get failed: ${getErrorMessage(error)}`,
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
          { streamId: input.streamId, key: input.key, network: input.network },
          input.network
            ? { ...credentials, ZERO_G_CHAIN_ID: input.network }
            : credentials
        )
      )
  );
}

export const _integrationType = "0g-storage";
