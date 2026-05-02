import "server-only";

import { fetchCredentials } from "@/lib/credential-fetcher";
import { ErrorCategory, logUserError } from "@/lib/logging";
import { withPluginMetrics } from "@/lib/metrics/instrumentation/plugin";
import { type StepInput, withStepLogging } from "@/lib/workflow/executor/step-handler";
import { getErrorMessage } from "@/lib/utils";
import { resolveOrganizationContext } from "@/lib/web3/resolve-org-context";
import { buildBrokerContext } from "../server-core";
import type { ZeroGComputeCredentials } from "../credentials";

const LOG_CONTEXT = {
  plugin_name: "0g-compute",
  action_name: "list-providers",
  service: "0g-compute",
} as const;

export type ListProvidersCoreInput = {
  network?: string;
  modelFilter?: string;
};

export type ListProvidersInput = StepInput &
  ListProvidersCoreInput & {
    integrationId?: string;
  };

type ProviderEntry = {
  address: string;
  model: string;
  endpoint: string;
  serviceType: string;
  inputPrice: string;
  outputPrice: string;
  verifiability: string;
};

type ListProvidersResult =
  | {
      success: true;
      providers: ProviderEntry[];
      defaultProvider: string | null;
      count: number;
    }
  | { success: false; error: string };

type RawService = {
  provider?: string;
  url?: string;
  model?: string;
  serviceType?: string;
  inputPrice?: bigint | number | string;
  outputPrice?: bigint | number | string;
  verifiability?: string;
};

function normalizePrice(value: bigint | number | string | undefined): string {
  if (value === undefined || value === null) {
    return "0";
  }
  return typeof value === "bigint" ? value.toString() : String(value);
}

async function stepHandler(
  input: ListProvidersInput,
  credentials: ZeroGComputeCredentials
): Promise<ListProvidersResult> {
  if (!(input._context?.executionId || input._context?.organizationId)) {
    return {
      success: false,
      error: "Execution ID or organization ID is required",
    };
  }

  const orgCtx = await resolveOrganizationContext(
    input._context,
    "[0G Compute]",
    "list-providers"
  );
  if (!orgCtx.success) {
    return orgCtx;
  }

  const effectiveCredentials: ZeroGComputeCredentials = input.network
    ? { ...credentials, ZERO_G_COMPUTE_CHAIN_ID: input.network }
    : credentials;

  const setup = await buildBrokerContext(
    effectiveCredentials,
    orgCtx.organizationId,
    orgCtx.userId
  );
  if (!setup.ok) {
    logUserError(
      ErrorCategory.CONFIGURATION,
      "[0G Compute] list-providers setup failed",
      setup.error,
      LOG_CONTEXT
    );
    return { success: false, error: setup.error };
  }

  const { broker } = setup.context;

  try {
    const services = (await broker.inference.listService()) as RawService[];
    const filter = input.modelFilter?.trim().toLowerCase();

    const providers: ProviderEntry[] = [];
    for (const svc of services) {
      const address = svc.provider ?? "";
      const model = svc.model ?? "";
      if (!address) {
        continue;
      }
      if (filter && !model.toLowerCase().includes(filter)) {
        continue;
      }
      providers.push({
        address,
        model,
        endpoint: svc.url ?? "",
        serviceType: svc.serviceType ?? "",
        inputPrice: normalizePrice(svc.inputPrice),
        outputPrice: normalizePrice(svc.outputPrice),
        verifiability: svc.verifiability ?? "",
      });
    }

    return {
      success: true,
      providers,
      defaultProvider: providers[0]?.address ?? null,
      count: providers.length,
    };
  } catch (error) {
    logUserError(
      ErrorCategory.NETWORK_RPC,
      "[0G Compute] list-providers failed",
      error,
      LOG_CONTEXT
    );
    return {
      success: false,
      error: `0G Compute list-providers failed: ${getErrorMessage(error)}`,
    };
  }
}

export async function listProvidersStep(
  input: ListProvidersInput
): Promise<ListProvidersResult> {
  "use step";

  const credentials = input.integrationId
    ? ((await fetchCredentials(
        input.integrationId
      )) as ZeroGComputeCredentials)
    : {};

  return withPluginMetrics(
    {
      pluginName: "0g-compute",
      actionName: "list-providers",
      executionId: input._context?.executionId,
    },
    () => withStepLogging(input, () => stepHandler(input, credentials))
  );
}
listProvidersStep.maxRetries = 0;

export const _integrationType = "0g-compute";
