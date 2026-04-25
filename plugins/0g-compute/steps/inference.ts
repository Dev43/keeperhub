import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { ErrorCategory, logUserError } from "@/lib/logging";
import { withPluginMetrics } from "@/lib/metrics/instrumentation/plugin";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { getErrorMessage } from "@/lib/utils";
import { resolveOrganizationContext } from "@/lib/web3/resolve-org-context";
import { buildBrokerContext, type ZeroGComputeBroker } from "../server-core";
import type { ZeroGComputeCredentials } from "../credentials";

const LOG_CONTEXT = {
  plugin_name: "0g-compute",
  action_name: "sealed-inference",
  service: "0g-compute",
} as const;

export type SealedInferenceCoreInput = {
  providerAddress: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
};

export type SealedInferenceInput = StepInput &
  SealedInferenceCoreInput & {
    integrationId?: string;
  };

type SealedInferenceResult =
  | {
      success: true;
      output: string;
      model: string;
      provider: string;
      chatId: string | null;
      verified: boolean | null;
    }
  | { success: false; error: string };

type ChatCompletionResponse = {
  id?: string;
  choices?: Array<{
    message?: { content?: string };
  }>;
};

async function safeAcknowledge(
  broker: ZeroGComputeBroker,
  providerAddress: string
): Promise<void> {
  try {
    await broker.inference.acknowledgeProviderSigner(providerAddress);
  } catch (error) {
    const message = getErrorMessage(error).toLowerCase();
    if (
      message.includes("already") ||
      message.includes("acknowledged") ||
      message.includes("exist")
    ) {
      return;
    }
    throw error;
  }
}

async function stepHandler(
  input: SealedInferenceInput,
  credentials: ZeroGComputeCredentials
): Promise<SealedInferenceResult> {
  if (!(input.providerAddress && input.prompt)) {
    logUserError(
      ErrorCategory.VALIDATION,
      "[0G Compute] sealed-inference missing providerAddress or prompt",
      {
        hasProvider: Boolean(input.providerAddress),
        hasPrompt: Boolean(input.prompt),
      },
      LOG_CONTEXT
    );
    return {
      success: false,
      error: "providerAddress and prompt are required",
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
    "[0G Compute]",
    "sealed-inference"
  );
  if (!orgCtx.success) {
    return orgCtx;
  }

  const setup = await buildBrokerContext(
    credentials,
    orgCtx.organizationId,
    orgCtx.userId
  );
  if (!setup.ok) {
    logUserError(
      ErrorCategory.CONFIGURATION,
      "[0G Compute] sealed-inference setup failed",
      setup.error,
      LOG_CONTEXT
    );
    return { success: false, error: setup.error };
  }

  const { broker } = setup.context;

  try {
    await safeAcknowledge(broker, input.providerAddress);

    const { endpoint, model } = await broker.inference.getServiceMetadata(
      input.providerAddress
    );

    const messages = [
      ...(input.systemPrompt
        ? [{ role: "system" as const, content: input.systemPrompt }]
        : []),
      { role: "user" as const, content: input.prompt },
    ];

    const requestBody: Record<string, unknown> = { model, messages };
    if (typeof input.maxTokens === "number") {
      requestBody.max_tokens = input.maxTokens;
    }
    if (typeof input.temperature === "number") {
      requestBody.temperature = input.temperature;
    }

    const serializedBody = JSON.stringify(requestBody);
    const headers = await broker.inference.getRequestHeaders(
      input.providerAddress,
      serializedBody
    );

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
      },
      body: serializedBody,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logUserError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[0G Compute] sealed-inference HTTP error",
        { status: response.status, body: text.slice(0, 500) },
        LOG_CONTEXT
      );
      return {
        success: false,
        error: `0G Compute inference failed: HTTP ${response.status}${
          text ? ` -- ${text.slice(0, 200)}` : ""
        }`,
      };
    }

    const body = (await response.json()) as ChatCompletionResponse;
    const output = body.choices?.[0]?.message?.content ?? "";
    const chatId = body.id ?? null;

    let verified: boolean | null = null;
    if (chatId) {
      try {
        const result = await broker.inference.processResponse(
          input.providerAddress,
          output,
          chatId
        );
        verified = typeof result === "boolean" ? result : Boolean(result);
      } catch (error) {
        logUserError(
          ErrorCategory.EXTERNAL_SERVICE,
          "[0G Compute] processResponse failed",
          error,
          LOG_CONTEXT
        );
      }
    }

    return {
      success: true,
      output,
      model,
      provider: input.providerAddress,
      chatId,
      verified,
    };
  } catch (error) {
    logUserError(
      ErrorCategory.NETWORK_RPC,
      "[0G Compute] sealed-inference failed",
      error,
      LOG_CONTEXT
    );
    return {
      success: false,
      error: `0G Compute inference failed: ${getErrorMessage(error)}`,
    };
  }
}

export async function sealedInferenceStep(
  input: SealedInferenceInput
): Promise<SealedInferenceResult> {
  "use step";

  const credentials = input.integrationId
    ? ((await fetchCredentials(
        input.integrationId
      )) as ZeroGComputeCredentials)
    : {};

  return withPluginMetrics(
    {
      pluginName: "0g-compute",
      actionName: "sealed-inference",
      executionId: input._context?.executionId,
    },
    () => withStepLogging(input, () => stepHandler(input, credentials))
  );
}
sealedInferenceStep.maxRetries = 0;

export const _integrationType = "0g-compute";
