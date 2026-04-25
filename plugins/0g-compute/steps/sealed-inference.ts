import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { ErrorCategory, logUserError } from "@/lib/logging";
import { withPluginMetrics } from "@/lib/metrics/instrumentation/plugin";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import { getErrorMessage } from "@/lib/utils";
import {
  resolveZeroGComputeGatewayUrl,
  type ZeroGComputeCredentials,
} from "../credentials";

const LOG_CONTEXT = {
  plugin_name: "0g-compute",
  action_name: "sealed-inference",
  service: "0g-compute",
} as const;

export type SealedInferenceCoreInput = {
  model: string;
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
      attestation: string | null;
      modelHash: string | null;
    }
  | { success: false; error: string };

type SealedInferenceResponse = {
  data?: {
    output?: string;
    attestation?: string;
    modelHash?: string;
  };
  error?: string;
};

async function stepHandler(
  input: SealedInferenceCoreInput,
  credentials: ZeroGComputeCredentials
): Promise<SealedInferenceResult> {
  const gatewayUrl = resolveZeroGComputeGatewayUrl(credentials);

  const apiKey =
    credentials.ZERO_G_COMPUTE_API_KEY ?? process.env.ZERO_G_COMPUTE_API_KEY;

  if (!apiKey) {
    logUserError(
      ErrorCategory.CONFIGURATION,
      "[0G Compute] sealed-inference missing API key",
      undefined,
      LOG_CONTEXT
    );
    return {
      success: false,
      error:
        "ZERO_G_COMPUTE_API_KEY is not configured. Add it in Project Integrations.",
    };
  }

  if (!(input.model && input.prompt)) {
    logUserError(
      ErrorCategory.VALIDATION,
      "[0G Compute] sealed-inference missing model or prompt",
      { hasModel: Boolean(input.model), hasPrompt: Boolean(input.prompt) },
      LOG_CONTEXT
    );
    return { success: false, error: "model and prompt are required" };
  }

  try {
    const response = await fetch(`${gatewayUrl}/v1/sealed/inference`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        systemPrompt: input.systemPrompt,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      }),
    });

    if (!response.ok) {
      logUserError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[0G Compute] sealed-inference HTTP error",
        { status: response.status },
        LOG_CONTEXT
      );
      return {
        success: false,
        error: `0G Compute sealed inference failed: HTTP ${response.status}`,
      };
    }

    const body = (await response.json()) as SealedInferenceResponse;
    if (body.error) {
      logUserError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[0G Compute] sealed-inference gateway error",
        body.error,
        LOG_CONTEXT
      );
      return { success: false, error: body.error };
    }

    return {
      success: true,
      output: body.data?.output ?? "",
      attestation: body.data?.attestation ?? null,
      modelHash: body.data?.modelHash ?? null,
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
      error: `0G Compute sealed inference failed: ${getErrorMessage(error)}`,
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
    () =>
      withStepLogging(input, () =>
        stepHandler(
          {
            model: input.model,
            prompt: input.prompt,
            systemPrompt: input.systemPrompt,
            maxTokens: input.maxTokens,
            temperature: input.temperature,
          },
          credentials
        )
      )
  );
}
sealedInferenceStep.maxRetries = 0;

export const _integrationType = "0g-compute";
