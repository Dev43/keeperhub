/**
 * 0G Galileo testnet block-time, RPC-latency, and WSS-stability probe.
 *
 * Samples block production and RPC latency over a configurable window and
 * reports p50/p95 for each. Useful when sizing per-block detection budgets
 * for any workflow whose `Block` trigger fires on 0G Galileo.
 *
 * Usage:
 *   pnpm tsx scripts/0g/measure-block-time.ts [--blocks 200] [--wss-secs 1800]
 *
 * Env:
 *   CHAIN_ZERO_G_GALILEO_PRIMARY_RPC   override HTTPS RPC
 *   CHAIN_ZERO_G_GALILEO_PRIMARY_WSS   WSS endpoint for eth_subscribe("newHeads")
 */

import "dotenv/config";

const HTTPS_RPC =
  process.env.CHAIN_ZERO_G_GALILEO_PRIMARY_RPC ??
  "https://evmrpc-testnet.0g.ai";
const WSS_RPC = process.env.CHAIN_ZERO_G_GALILEO_PRIMARY_WSS;

type RpcResponse<T> = { result?: T; error?: { message: string } };

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(HTTPS_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as RpcResponse<T>;
  if (body.error) {
    throw new Error(`${method}: ${body.error.message}`);
  }
  if (body.result === undefined) {
    throw new Error(`${method}: empty result`);
  }
  return body.result;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function sampleBlockTimes(count: number): Promise<void> {
  const head = Number.parseInt(await rpc<string>("eth_blockNumber", []), 16);
  const start = Math.max(1, head - count);
  const blockTimes: number[] = [];
  const rpcLatencies: number[] = [];

  let prevTimestamp: number | null = null;
  for (let n = start; n <= head; n++) {
    const t0 = Date.now();
    const block = await rpc<{ timestamp: string }>("eth_getBlockByNumber", [
      `0x${n.toString(16)}`,
      false,
    ]);
    rpcLatencies.push(Date.now() - t0);
    const timestamp = Number.parseInt(block.timestamp, 16);
    if (prevTimestamp !== null) {
      blockTimes.push(timestamp - prevTimestamp);
    }
    prevTimestamp = timestamp;
  }

  blockTimes.sort((a, b) => a - b);
  rpcLatencies.sort((a, b) => a - b);

  process.stdout.write(
    `block_time_seconds: avg=${(blockTimes.reduce((a, b) => a + b, 0) / blockTimes.length).toFixed(2)} p50=${percentile(blockTimes, 50)} p95=${percentile(blockTimes, 95)} samples=${blockTimes.length}\n`
  );
  process.stdout.write(
    `rpc_latency_ms (eth_getBlockByNumber): p50=${percentile(rpcLatencies, 50)} p95=${percentile(rpcLatencies, 95)} samples=${rpcLatencies.length}\n`
  );
}

function probeWss(durationSecs: number): Promise<void> {
  return new Promise((resolve) => {
    if (!WSS_RPC) {
      process.stdout.write(
        "wss: CHAIN_ZERO_G_GALILEO_PRIMARY_WSS not set, skipping subscription probe\n"
      );
      resolve();
      return;
    }
    let drops = 0;
    let lastHeadAt = Date.now();
    const interHeadGaps: number[] = [];
    let ws: WebSocket | null = null;

    const open = (): void => {
      ws = new WebSocket(WSS_RPC);
      ws.addEventListener("open", () => {
        ws?.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_subscribe",
            params: ["newHeads"],
          })
        );
      });
      ws.addEventListener("message", (event: MessageEvent) => {
        const msg = JSON.parse(String(event.data)) as { method?: string };
        if (msg.method === "eth_subscription") {
          const now = Date.now();
          interHeadGaps.push(now - lastHeadAt);
          lastHeadAt = now;
        }
      });
      ws.addEventListener("close", () => {
        drops += 1;
        setTimeout(open, 1000);
      });
      ws.addEventListener("error", () => {
        drops += 1;
      });
    };

    open();

    setTimeout(() => {
      ws?.close();
      interHeadGaps.shift();
      interHeadGaps.sort((a, b) => a - b);
      process.stdout.write(
        `wss: heads=${interHeadGaps.length} drops=${drops} gap_p50_ms=${percentile(interHeadGaps, 50)} gap_p95_ms=${percentile(interHeadGaps, 95)}\n`
      );
      resolve();
    }, durationSecs * 1000);
  });
}

function parseArgs(): { blocks: number; wssSecs: number } {
  const args = process.argv.slice(2);
  let blocks = 200;
  let wssSecs = 1800;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--blocks" && args[i + 1]) {
      blocks = Number.parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--wss-secs" && args[i + 1]) {
      wssSecs = Number.parseInt(args[i + 1], 10);
      i++;
    }
  }
  return { blocks, wssSecs };
}

async function main(): Promise<void> {
  const { blocks, wssSecs } = parseArgs();
  process.stdout.write(`rpc: ${HTTPS_RPC}\n`);
  process.stdout.write(`wss: ${WSS_RPC ?? "(unset)"}\n`);
  await sampleBlockTimes(blocks);
  await probeWss(wssSecs);
}

main().catch((err) => {
  process.stderr.write(`measure-block-time failed: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
