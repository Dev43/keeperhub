import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { ErrorCategory, logUserError } from "@/lib/logging";
import { withPluginMetrics } from "@/lib/metrics/instrumentation/plugin";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { getErrorMessage } from "@/lib/utils";
import {
  resolveZeroGStorageIndexerUrl,
  type ZeroGStorageCredentials,
} from "../credentials";

const LOG_CONTEXT = {
  plugin_name: "0g-storage",
  action_name: "kv-put",
  service: "0g-storage",
} as const;

export type KvPutCoreInput = {
  streamId: string;
  key: string;
  value: string;
};

export type KvPutInput = StepInput &
  KvPutCoreInput & {
    integrationId?: string;
  };

type KvPutResult =
  | { success: true; txHash: string | null }
  | { success: false; error: string };

type KvPutResponse = {
  data?: {
    txHash?: string;
  };
  error?: string;
};

async function stepHandler(
  input: KvPutCoreInput,
  credentials: ZeroGStorageCredentials
): Promise<KvPutResult> {
  const indexerUrl = resolveZeroGStorageIndexerUrl(credentials);

  const privateKey =
    credentials.ZERO_G_STORAGE_PRIVATE_KEY ??
    process.env.ZERO_G_STORAGE_PRIVATE_KEY;

  if (!privateKey) {
    logUserError(
      ErrorCategory.CONFIGURATION,
      "[0G Storage] kv-put missing private key",
      undefined,
      LOG_CONTEXT
    );
    return {
      success: false,
      error:
        "ZERO_G_STORAGE_PRIVATE_KEY is not configured. Add it in Project Integrations.",
    };
  }

  if (!(input.streamId && input.key)) {
    logUserError(
      ErrorCategory.VALIDATION,
      "[0G Storage] kv-put missing streamId or key",
      { streamId: input.streamId, key: input.key },
      LOG_CONTEXT
    );
    return { success: false, error: "streamId and key are required" };
  }

  try {
    const response = await fetch(`${indexerUrl}/kv/set`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${privateKey}`,
      },
      body: JSON.stringify({
        streamId: input.streamId,
        key: input.key,
        value: input.value,
      }),
    });

    if (!response.ok) {
      logUserError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[0G Storage] kv-put HTTP error",
        { status: response.status },
        LOG_CONTEXT
      );
      return {
        success: false,
        error: `0G Storage KV put failed: HTTP ${response.status}`,
      };
    }

    const body = (await response.json()) as KvPutResponse;
    if (body.error) {
      logUserError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[0G Storage] kv-put indexer error",
        body.error,
        LOG_CONTEXT
      );
      return { success: false, error: body.error };
    }

    return { success: true, txHash: body.data?.txHash ?? null };
  } catch (error) {
    logUserError(
      ErrorCategory.NETWORK_RPC,
      "[0G Storage] kv-put failed",
      error,
      LOG_CONTEXT
    );
    return {
      success: false,
      error: `0G Storage KV put failed: ${getErrorMessage(error)}`,
    };
  }
}

export async function kvPutStep(input: KvPutInput): Promise<KvPutResult> {
  "use step";

  const credentials = input.integrationId
    ? ((await fetchCredentials(
        input.integrationId
      )) as ZeroGStorageCredentials)
    : {};

  return withPluginMetrics(
    {
      pluginName: "0g-storage",
      actionName: "kv-put",
      executionId: input._context?.executionId,
    },
    () =>
      withStepLogging(input, () =>
        stepHandler(
          { streamId: input.streamId, key: input.key, value: input.value },
          credentials
        )
      )
  );
}
kvPutStep.maxRetries = 0;

export const _integrationType = "0g-storage";
