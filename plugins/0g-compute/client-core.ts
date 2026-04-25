import "server-only";

import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import type { Signer } from "ethers";
import { initializeWalletSigner } from "@/lib/para/wallet-helpers";
import { getRpcProvider } from "@/lib/rpc/provider-factory";
import {
  resolveZeroGComputeChainId,
  type ZeroGComputeCredentials,
} from "./credentials";

export type ZeroGComputeBroker = Awaited<
  ReturnType<typeof createZGComputeNetworkBroker>
>;

export type ZeroGComputeContext = {
  broker: ZeroGComputeBroker;
  signer: Signer;
  rpcUrl: string;
  chainId: number;
};

export type ZeroGComputeSetup =
  | { ok: true; context: ZeroGComputeContext }
  | { ok: false; error: string };

export async function buildBrokerContext(
  credentials: ZeroGComputeCredentials,
  organizationId: string,
  userId: string | undefined
): Promise<ZeroGComputeSetup> {
  const chainId = resolveZeroGComputeChainId(credentials);

  try {
    const rpcManager = await getRpcProvider({ chainId, userId });
    const rpcUrl = await rpcManager.resolveActiveRpcUrl();
    const signer = await initializeWalletSigner(
      organizationId,
      rpcUrl,
      chainId
    );
    // The broker SDK ships its own bundled ethers types whose brand-private
    // members differ from this repo's ethers; runtime contract is identical.
    const broker = await createZGComputeNetworkBroker(
      signer as unknown as Parameters<typeof createZGComputeNetworkBroker>[0]
    );
    return {
      ok: true,
      context: { broker, signer, rpcUrl, chainId },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Failed to initialize 0G compute broker: ${message}`,
    };
  }
}
