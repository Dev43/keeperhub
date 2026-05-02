import "server-only";

import { toUtf8Bytes } from "ethers";
import { fetchCredentials } from "@/lib/credential-fetcher";
import { ErrorCategory, logUserError } from "@/lib/logging";
import { withPluginMetrics } from "@/lib/metrics/instrumentation/plugin";
import { type StepInput, withStepLogging } from "@/lib/workflow/executor/step-handler";
import { getErrorMessage } from "@/lib/utils";
import { resolveOrganizationContext } from "@/lib/web3/resolve-org-context";
import { buildWriteContext, uploadBlob } from "../server-core";
import type { ZeroGStorageCredentials } from "../credentials";

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
  | { success: true; rootHash: string; txHash: string }
  | { success: false; error: string };

function buildEntryPayload(input: LogAppendCoreInput): Uint8Array {
  const envelope = {
    streamId: input.streamId,
    tag: input.tag ?? null,
    payload: input.payload,
    timestamp: Date.now(),
  };
  return toUtf8Bytes(JSON.stringify(envelope));
}

async function stepHandler(
  input: LogAppendInput,
  credentials: ZeroGStorageCredentials
): Promise<LogAppendResult> {
  if (!(input.streamId && input.payload)) {
    logUserError(
      ErrorCategory.VALIDATION,
      "[0G Storage] log-append missing streamId or payload",
      { streamId: input.streamId, hasPayload: Boolean(input.payload) },
      LOG_CONTEXT
    );
    return {
      success: false,
      error: "streamId and payload are required",
    };
  }

  if (!(input._context?.executionId || input._context?.organizationId)) {
    return {
      success: false,
      error: "Execution ID or organization ID is required",
    };
  }

  const orgCtx = await resolveOrganizationContext(
    input._context,
    "[0G Storage]",
    "log-append"
  );
  if (!orgCtx.success) {
    return orgCtx;
  }

  const setup = await buildWriteContext(
    credentials,
    orgCtx.organizationId,
    orgCtx.userId
  );
  if (!setup.ok) {
    logUserError(
      ErrorCategory.CONFIGURATION,
      "[0G Storage] log-append setup failed",
      setup.error,
      LOG_CONTEXT
    );
    return { success: false, error: setup.error };
  }

  try {
    const result = await uploadBlob(setup.context, buildEntryPayload(input));
    if (!result.ok) {
      logUserError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[0G Storage] log-append upload failed",
        result.error,
        LOG_CONTEXT
      );
      return { success: false, error: result.error };
    }

    return {
      success: true,
      rootHash: result.rootHash,
      txHash: result.txHash,
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
    () => withStepLogging(input, () => stepHandler(input, credentials))
  );
}
logAppendStep.maxRetries = 0;

export const _integrationType = "0g-storage";
