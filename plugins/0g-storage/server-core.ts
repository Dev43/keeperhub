import "server-only";

import {
  Batcher,
  FixedPriceFlow__factory,
  Indexer,
  MemData,
} from "@0gfoundation/0g-ts-sdk";
import type { Signer } from "ethers";
import { initializeWalletSigner } from "@/lib/para/wallet-helpers";
import { getRpcProvider } from "@/lib/rpc/provider-factory";
import {
  resolveZeroGChainId,
  resolveZeroGFlowAddress,
  resolveZeroGIndexerUrl,
  type ZeroGStorageCredentials,
} from "./credentials";

export type ZeroGWriteContext = {
  signer: Signer;
  indexer: Indexer;
  rpcUrl: string;
  flowAddress: string;
  chainId: number;
};

export type ZeroGWriteSetup =
  | { ok: true; context: ZeroGWriteContext }
  | { ok: false; error: string };

export async function buildWriteContext(
  credentials: ZeroGStorageCredentials,
  organizationId: string,
  userId: string | undefined
): Promise<ZeroGWriteSetup> {
  const indexerUrl = resolveZeroGIndexerUrl(credentials);
  const flowAddress = resolveZeroGFlowAddress(credentials);
  const chainId = resolveZeroGChainId(credentials);

  try {
    const rpcManager = await getRpcProvider({ chainId, userId });
    const rpcUrl = await rpcManager.resolveActiveRpcUrl();
    const signer = await initializeWalletSigner(
      organizationId,
      rpcUrl,
      chainId
    );
    const indexer = new Indexer(indexerUrl);
    return {
      ok: true,
      context: { signer, indexer, rpcUrl, flowAddress, chainId },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to initialize 0G client: ${message}` };
  }
}

const KV_REPLICAS = 1;

export type KvWriteResult =
  | { ok: true; txHash: string; rootHash: string }
  | { ok: false; error: string };

export async function writeKvEntry(
  context: ZeroGWriteContext,
  streamId: string,
  key: Uint8Array,
  value: Uint8Array
): Promise<KvWriteResult> {
  const [nodes, nodesError] = await context.indexer.selectNodes(KV_REPLICAS);
  if (nodesError) {
    return {
      ok: false,
      error: `0G indexer node selection failed: ${nodesError.message}`,
    };
  }

  // The SDK ships its own bundled ethers types whose brand-private members
  // don't satisfy the repo's esm ethers Signer; runtime contract is identical.
  const flow = FixedPriceFlow__factory.connect(
    context.flowAddress,
    context.signer as unknown as Parameters<
      typeof FixedPriceFlow__factory.connect
    >[1]
  );
  const batcher = new Batcher(1, nodes, flow, context.rpcUrl);
  batcher.streamDataBuilder.set(streamId, key, value);

  const [result, execError] = await batcher.exec();
  if (execError) {
    return { ok: false, error: `0G batcher exec failed: ${execError.message}` };
  }

  return { ok: true, txHash: result.txHash, rootHash: result.rootHash };
}

export type BlobUploadResult =
  | { ok: true; txHash: string; rootHash: string }
  | { ok: false; error: string };

export async function uploadBlob(
  context: ZeroGWriteContext,
  payload: Uint8Array
): Promise<BlobUploadResult> {
  const file = new MemData(payload);
  // SDK's bundled ethers Signer differs by brand-private members; runtime
  // contract is identical.
  const [result, error] = await context.indexer.upload(
    file,
    context.rpcUrl,
    context.signer as unknown as Parameters<typeof context.indexer.upload>[2]
  );
  if (error) {
    return { ok: false, error: `0G blob upload failed: ${error.message}` };
  }

  if ("txHashes" in result) {
    return {
      ok: true,
      txHash: result.txHashes[0] ?? "",
      rootHash: result.rootHashes[0] ?? "",
    };
  }

  return { ok: true, txHash: result.txHash, rootHash: result.rootHash };
}
