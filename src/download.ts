import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

export function maxDownloadBytes(
  env: Record<string, string | undefined> = process.env,
): number {
  const mb = Number(env.ATTACHMENT_MCP_MAX_DOWNLOAD_MB);
  return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : DEFAULT_MAX_BYTES;
}

/**
 * Stream a response body to disk without buffering it in memory (ADR 0003).
 * `wx` keeps the no-overwrite guarantee at the syscall, closing the race
 * between Sandbox.prepareWrite's check and this write.
 */
export async function streamToFile(
  res: Response,
  target: string,
  options: { overwrite?: boolean; maxBytes?: number } = {},
): Promise<number> {
  const max = options.maxBytes ?? maxDownloadBytes();
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    throw new Error(
      `Attachment is ${declared} bytes, over the ${max}-byte download limit ` +
        "(raise ATTACHMENT_MCP_MAX_DOWNLOAD_MB to allow it)",
    );
  }
  if (!res.body) throw new Error("Response had no body");

  let written = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length;
      if (written > max) {
        callback(new Error(`Download exceeded the ${max}-byte limit`));
      } else {
        callback(null, chunk);
      }
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
      guard,
      createWriteStream(target, { flags: options.overwrite ? "w" : "wx" }),
    );
  } catch (err) {
    // A partial file would block retries via the no-overwrite check. Remove
    // it — unless the failure IS "already exists", where the file isn't ours.
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      await fs.rm(target, { force: true }).catch(() => {});
    }
    throw err;
  }
  return written;
}
