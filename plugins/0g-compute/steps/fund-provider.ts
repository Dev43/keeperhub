import "server-only";

import { ethers } from "ethers";
import { fetchCredentials } from "@/lib/credential-fetcher";
import { ErrorCategory, logUserError } from "@/lib/logging";
import { withPluginMetrics } from "@/lib/metrics/instrumentation/plugin";
import { type StepInput, withStepLogging } from "@/lib/workflow/executor/step-handler";
import { getErrorMessage } from "@/lib/utils";
import { resolveOrganizationContext } from "@/lib/web3/resolve-org-context";
import { buildBrokerContext, type ZeroGComputeBroker } from "../server-core";
import type { ZeroGComputeCredentials } from "../credentials";

const LOG_CONTEXT = {
  plugin_name: "0g-compute",
  action_name: "fund-provider",
  service: "0g-compute",
} as const;

const DEFAULT_LEDGER_OG = 3;
const DEFAULT_TRANSFER_OG = 1;

export type FundProviderCoreInput = {
  providerAddress: string;
  network?: string;
  initialLedgerOG?: number | string;
  transferAmountOG?: number | string;
};

export type FundProviderInput = StepInput &
  FundProviderCoreInput & {
    integrationId?: string;
  };

type FundProviderResult =
  | {
      success: true;
      ledgerCreated: boolean;
      ledgerSkippedReason: string | null;
      transferredOG: string;
      transferSkipped: boolean;
      transferSkippedReason: string | null;
      existingBalanceNeurons: string | null;
      provider: string;
    }
  | { success: false; error: string };

function isAlreadyExistsError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("already exists") ||
    message.includes("ledger already") ||
    message.includes("account exists")
  );
}

async function ensureLedger(
  broker: ZeroGComputeBroker,
  initialOG: number
): Promise<{ created: boolean; skippedReason: string | null }> {
  try {
    await broker.ledger.addLedger(initialOG);
    return { created: true, skippedReason: null };
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return { created: false, skippedReason: "ledger already exists" };
    }
    throw error;
  }
}

async function stepHandler(
  input: FundProviderInput,
  credentials: ZeroGComputeCredentials
): Promise<FundProviderResult> {
  const providerAddress = input.providerAddress?.trim() ?? "";

  if (!providerAddress) {
    return { success: false, error: "providerAddress is required" };
  }

  if (!ethers.isAddress(providerAddress)) {
    return {
      success: false,
      error: `providerAddress is not a valid 0x-prefixed address: "${providerAddress}"`,
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
    "fund-provider"
  );
  if (!orgCtx.success) {
    return orgCtx;
  }

  const initialLedgerOG = Number(input.initialLedgerOG ?? DEFAULT_LEDGER_OG);
  const transferAmountOG = Number(
    input.transferAmountOG ?? DEFAULT_TRANSFER_OG
  );

  if (!Number.isFinite(initialLedgerOG) || !Number.isFinite(transferAmountOG)) {
    return {
      success: false,
      error: "initialLedgerOG and transferAmountOG must be valid numbers",
    };
  }

  if (transferAmountOG <= 0) {
    return {
      success: false,
      error: "transferAmountOG must be greater than 0",
    };
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
      "[0G Compute] fund-provider setup failed",
      setup.error,
      LOG_CONTEXT
    );
    return { success: false, error: setup.error };
  }

  const { broker } = setup.context;

  try {
    const transferAmountNeurons = ethers.parseEther(String(transferAmountOG));

    let existingBalanceNeurons: bigint | null = null;
    try {
      const account = await broker.inference.getAccount(providerAddress);
      existingBalanceNeurons = BigInt(account.balance ?? 0);
    } catch {
      existingBalanceNeurons = null;
    }

    if (
      existingBalanceNeurons !== null &&
      existingBalanceNeurons >= transferAmountNeurons
    ) {
      return {
        success: true,
        ledgerCreated: false,
        ledgerSkippedReason: "sub-account already exists",
        transferredOG: "0",
        transferSkipped: true,
        transferSkippedReason: `sub-account already funded with ${ethers.formatEther(existingBalanceNeurons)} OG`,
        existingBalanceNeurons: existingBalanceNeurons.toString(),
        provider: providerAddress,
      };
    }

    const ledger = await ensureLedger(broker, initialLedgerOG);
    await broker.ledger.transferFund(
      providerAddress,
      "inference",
      transferAmountNeurons
    );

    return {
      success: true,
      ledgerCreated: ledger.created,
      ledgerSkippedReason: ledger.skippedReason,
      transferredOG: String(transferAmountOG),
      transferSkipped: false,
      transferSkippedReason: null,
      existingBalanceNeurons: existingBalanceNeurons?.toString() ?? null,
      provider: providerAddress,
    };
  } catch (error) {
    logUserError(
      ErrorCategory.NETWORK_RPC,
      "[0G Compute] fund-provider failed",
      error,
      LOG_CONTEXT
    );
    return {
      success: false,
      error: `0G Compute fund-provider failed: ${getErrorMessage(error)}`,
    };
  }
}

export async function fundProviderStep(
  input: FundProviderInput
): Promise<FundProviderResult> {
  "use step";

  const credentials = input.integrationId
    ? ((await fetchCredentials(
        input.integrationId
      )) as ZeroGComputeCredentials)
    : {};

  return withPluginMetrics(
    {
      pluginName: "0g-compute",
      actionName: "fund-provider",
      executionId: input._context?.executionId,
    },
    () => withStepLogging(input, () => stepHandler(input, credentials))
  );
}
fundProviderStep.maxRetries = 0;

export const _integrationType = "0g-compute";
