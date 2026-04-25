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
  action_name: "kv-get",
  service: "0g-storage",
} as const;

export type KvGetCoreInput = {
  streamId: string;
  key: string;
};

export type KvGetInput = StepInput &
  KvGetCoreInput & {
    integrationId?: string;
  };

type KvGetResult =
  | { success: true; value: string | null; version: number | null }
  | { success: false; error: string };

type KvGetResponse = {
  data?: {
    value?: string;
    version?: number;
  };
  error?: string;
};

async function stepHandler(
  input: KvGetCoreInput,
  credentials: ZeroGStorageCredentials
): Promise<KvGetResult> {
  const indexerUrl = resolveZeroGStorageIndexerUrl(credentials);

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
    const url = `${indexerUrl}/kv/value?streamId=${encodeURIComponent(
      input.streamId
    )}&key=${encodeURIComponent(input.key)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      logUserError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[0G Storage] kv-get HTTP error",
        { status: response.status },
        LOG_CONTEXT
      );
      return {
        success: false,
        error: `0G Storage KV get failed: HTTP ${response.status}`,
      };
    }

    const body = (await response.json()) as KvGetResponse;
    if (body.error) {
      logUserError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[0G Storage] kv-get indexer error",
        body.error,
        LOG_CONTEXT
      );
      return { success: false, error: body.error };
    }

    return {
      success: true,
      value: body.data?.value ?? null,
      version: body.data?.version ?? null,
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
          { streamId: input.streamId, key: input.key },
          credentials
        )
      )
  );
}

export const _integrationType = "0g-storage";
