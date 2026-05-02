import "server-only";

import { toUtf8Bytes } from "ethers";
import { fetchCredentials } from "@/lib/credential-fetcher";
import { ErrorCategory, logUserError } from "@/lib/logging";
import { withPluginMetrics } from "@/lib/metrics/instrumentation/plugin";
import { type StepInput, withStepLogging } from "@/lib/workflow/executor/step-handler";
import { getErrorMessage } from "@/lib/utils";
import { resolveOrganizationContext } from "@/lib/web3/resolve-org-context";
import { buildWriteContext, writeKvEntry } from "../server-core";
import type { ZeroGStorageCredentials } from "../credentials";

const LOG_CONTEXT = {
  plugin_name: "0g-storage",
  action_name: "kv-put",
  service: "0g-storage",
} as const;

export type KvPutCoreInput = {
  streamId: string;
  key: string;
  value: string;
  network?: string;
};

export type KvPutInput = StepInput &
  KvPutCoreInput & {
    integrationId?: string;
  };

type KvPutResult =
  | { success: true; txHash: string; rootHash: string }
  | { success: false; error: string };

async function stepHandler(
  input: KvPutInput,
  credentials: ZeroGStorageCredentials
): Promise<KvPutResult> {
  if (!(input.streamId && input.key)) {
    logUserError(
      ErrorCategory.VALIDATION,
      "[0G Storage] kv-put missing streamId or key",
      { streamId: input.streamId, key: input.key },
      LOG_CONTEXT
    );
    return { success: false, error: "streamId and key are required" };
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
    "kv-put"
  );
  if (!orgCtx.success) {
    return orgCtx;
  }

  const effectiveCredentials: ZeroGStorageCredentials = input.network
    ? { ...credentials, ZERO_G_CHAIN_ID: input.network }
    : credentials;

  const setup = await buildWriteContext(
    effectiveCredentials,
    orgCtx.organizationId,
    orgCtx.userId
  );
  if (!setup.ok) {
    logUserError(
      ErrorCategory.CONFIGURATION,
      "[0G Storage] kv-put setup failed",
      setup.error,
      LOG_CONTEXT
    );
    return { success: false, error: setup.error };
  }

  try {
    const result = await writeKvEntry(
      setup.context,
      input.streamId,
      toUtf8Bytes(input.key),
      toUtf8Bytes(input.value ?? "")
    );

    if (!result.ok) {
      logUserError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[0G Storage] kv-put exec failed",
        result.error,
        LOG_CONTEXT
      );
      return { success: false, error: result.error };
    }

    return {
      success: true,
      txHash: result.txHash,
      rootHash: result.rootHash,
    };
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
    () => withStepLogging(input, () => stepHandler(input, credentials))
  );
}
kvPutStep.maxRetries = 0;

export const _integrationType = "0g-storage";
