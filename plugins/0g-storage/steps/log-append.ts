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
  action_name: "log-append",
  service: "0g-storage",
} as const;

export type LogAppendCoreInput = {
  streamId: string;
  payload: string;
  tag?: string;
};

export type LogAppendInput = StepInput &
  LogAppendCoreInput & {
    integrationId?: string;
  };

type LogAppendResult =
  | { success: true; entryId: string | null; txHash: string | null }
  | { success: false; error: string };

type LogAppendResponse = {
  data?: {
    entryId?: string;
    txHash?: string;
  };
  error?: string;
};

async function stepHandler(
  input: LogAppendCoreInput,
  credentials: ZeroGStorageCredentials
): Promise<LogAppendResult> {
  const indexerUrl = resolveZeroGStorageIndexerUrl(credentials);

  const privateKey =
    credentials.ZERO_G_STORAGE_PRIVATE_KEY ??
    process.env.ZERO_G_STORAGE_PRIVATE_KEY;

  if (!privateKey) {
    logUserError(
      ErrorCategory.CONFIGURATION,
      "[0G Storage] log-append missing private key",
      undefined,
      LOG_CONTEXT
    );
    return {
      success: false,
      error:
        "ZERO_G_STORAGE_PRIVATE_KEY is not configured. Add it in Project Integrations.",
    };
  }

  if (!(input.streamId && input.payload)) {
    logUserError(
      ErrorCategory.VALIDATION,
      "[0G Storage] log-append missing streamId or payload",
      { streamId: input.streamId, hasPayload: Boolean(input.payload) },
      LOG_CONTEXT
    );
    return { success: false, error: "streamId and payload are required" };
  }

  try {
    const response = await fetch(`${indexerUrl}/log/append`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${privateKey}`,
      },
      body: JSON.stringify({
        streamId: input.streamId,
        payload: input.payload,
        tag: input.tag,
      }),
    });

    if (!response.ok) {
      logUserError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[0G Storage] log-append HTTP error",
        { status: response.status },
        LOG_CONTEXT
      );
      return {
        success: false,
        error: `0G Storage log append failed: HTTP ${response.status}`,
      };
    }

    const body = (await response.json()) as LogAppendResponse;
    if (body.error) {
      logUserError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[0G Storage] log-append indexer error",
        body.error,
        LOG_CONTEXT
      );
      return { success: false, error: body.error };
    }

    return {
      success: true,
      entryId: body.data?.entryId ?? null,
      txHash: body.data?.txHash ?? null,
    };
  } catch (error) {
    logUserError(
      ErrorCategory.NETWORK_RPC,
      "[0G Storage] log-append failed",
      error,
      LOG_CONTEXT
    );
    return {
      success: false,
      error: `0G Storage log append failed: ${getErrorMessage(error)}`,
    };
  }
}

export async function logAppendStep(
  input: LogAppendInput
): Promise<LogAppendResult> {
  "use step";

  const credentials = input.integrationId
    ? ((await fetchCredentials(
        input.integrationId
      )) as ZeroGStorageCredentials)
    : {};

  return withPluginMetrics(
    {
      pluginName: "0g-storage",
      actionName: "log-append",
      executionId: input._context?.executionId,
    },
    () =>
      withStepLogging(input, () =>
        stepHandler(
          {
            streamId: input.streamId,
            payload: input.payload,
            tag: input.tag,
          },
          credentials
        )
      )
  );
}
logAppendStep.maxRetries = 0;

export const _integrationType = "0g-storage";
