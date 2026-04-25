import "server-only";

export type StreamWriteEntry = {
  streamId: string;
  key: string;
  value: string;
};

type DecodeResult =
  | { ok: true; entries: StreamWriteEntry[] }
  | { ok: false; error: string };

function readUInt(buffer: Buffer, offset: number, byteLength: number): number {
  let value = 0;
  for (let i = 0; i < byteLength; i++) {
    value = value * 256 + buffer[offset + i];
  }
  return value;
}

function readUInt64(buffer: Buffer, offset: number): bigint {
  return buffer.readBigUInt64BE(offset);
}

function toHex(buffer: Buffer, offset: number, length: number): string {
  return `0x${buffer.subarray(offset, offset + length).toString("hex")}`;
}

const STREAM_ID_BYTES = 32;
const KEY_SIZE_BYTES = 3;
const VALUE_SIZE_BYTES = 8;

/**
 * Decodes the StreamData wire format produced by
 * StreamDataBuilder.encode() in @0gfoundation/0g-ts-sdk. Layout:
 *   8  bytes uint64  version
 *   4  bytes uint32  reads count
 *   for each read:
 *     32 bytes        streamId
 *     3  bytes uint24 keySize
 *     N  bytes        key
 *   4  bytes uint32  writes count
 *   for each write:
 *     32 bytes        streamId
 *     3  bytes uint24 keySize
 *     N  bytes        key
 *     8  bytes uint64 valueSize
 *     N  bytes        value
 *   (controls section omitted from this decoder)
 */
export function decodeStreamData(buffer: Buffer): DecodeResult {
  try {
    let offset = 0;
    if (buffer.length < 16) {
      return { ok: false, error: "blob too short to be StreamData" };
    }
    offset += 8; // version

    const readsCount = readUInt(buffer, offset, 4);
    offset += 4;
    for (let i = 0; i < readsCount; i++) {
      offset += STREAM_ID_BYTES;
      const keySize = readUInt(buffer, offset, KEY_SIZE_BYTES);
      offset += KEY_SIZE_BYTES + keySize;
    }

    const writesCount = readUInt(buffer, offset, 4);
    offset += 4;
    const entries: StreamWriteEntry[] = [];
    for (let i = 0; i < writesCount; i++) {
      const streamId = toHex(buffer, offset, STREAM_ID_BYTES);
      offset += STREAM_ID_BYTES;
      const keySize = readUInt(buffer, offset, KEY_SIZE_BYTES);
      offset += KEY_SIZE_BYTES;
      const key = buffer.subarray(offset, offset + keySize).toString("utf8");
      offset += keySize;
      const valueSize = Number(readUInt64(buffer, offset));
      offset += VALUE_SIZE_BYTES;
      const value = buffer
        .subarray(offset, offset + valueSize)
        .toString("utf8");
      offset += valueSize;
      entries.push({ streamId, key, value });
    }

    return { ok: true, entries };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to decode StreamData: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export function findEntry(
  entries: StreamWriteEntry[],
  streamId?: string,
  key?: string
): StreamWriteEntry | null {
  if (entries.length === 0) {
    return null;
  }
  if (!(streamId || key)) {
    return entries[0];
  }
  const targetStream = streamId?.toLowerCase();
  return (
    entries.find(
      (e) =>
        (targetStream ? e.streamId.toLowerCase() === targetStream : true) &&
        (key ? e.key === key : true)
    ) ?? null
  );
}
