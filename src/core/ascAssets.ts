/**
 * App Store Connect asset upload — the reservation-flow transport shared by every ASC binary asset
 * (app screenshots, app previews, subscription review screenshots).
 *
 * Apple uploads an asset in three steps: (1) RESERVE the asset, which returns a list of
 * `uploadOperations` — pre-signed, pre-authorized PUT URLs that together cover the file's bytes;
 * (2) PUT each byte range to its operation URL; (3) COMMIT with the file's MD5 so Apple can verify the
 * bytes it stitched back together. This module owns step 2 and the MD5 of step 3; the reserve/commit
 * JSON:API calls live on {@link AppStoreConnectClient}, which hands the operations here.
 *
 * Why a standalone module (not a client method): the operation URLs are already authorized, so these
 * PUTs must NOT carry the client's `Authorization` header (Apple's storage rejects a doubly-signed
 * upload) and their responses aren't JSON — they sidestep `AppStoreConnectClient.request` entirely.
 * Keeping the transport here also lets app screenshots (#49) and subscription review screenshots (#53)
 * share one tested uploader instead of each re-implementing chunked PUTs.
 */

import { createHash } from "node:crypto";
import { runPool } from "./asyncPool.js";

/** Concurrent chunk PUTs per asset. A handful keeps a large screenshot fast without flooding the host. */
const UPLOAD_CONCURRENCY = 4;

/**
 * One reserved upload step from Apple's `uploadOperations`: PUT `length` bytes starting at `offset` to
 * `url`, sending exactly the `requestHeaders` Apple specifies. A small asset reserves a single
 * operation; a large one is split across several covering disjoint byte ranges.
 */
export interface UploadOperation {
  /** HTTP method Apple wants (always `PUT` today); honored rather than assumed. */
  method: string;
  url: string;
  /** Byte length of this chunk. */
  length: number;
  /** Byte offset of this chunk within the file. */
  offset: number;
  /** Headers Apple requires on the PUT (e.g. `Content-Type`); sent verbatim. */
  requestHeaders: { name: string; value: string }[];
}

/** Apple's required source-file checksum: the lowercase-hex MD5 of the whole file. */
export function md5Hex(bytes: Buffer): string {
  return createHash("md5").update(bytes).digest("hex");
}

/** Narrow an unknown JSON value to a plain object, or null. Mirrors `storeConfig.ts` (no zod dependency). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Narrow Apple's raw `uploadOperations` attribute (it arrives untyped off the JSON:API response) into
 * typed {@link UploadOperation}s, dropping any malformed entry. Exported so the client can feed the
 * reservation response straight in.
 */
export function parseUploadOperations(raw: unknown): UploadOperation[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): UploadOperation[] => {
    const op = asRecord(entry);
    if (!op || typeof op["url"] !== "string" || typeof op["length"] !== "number" || typeof op["offset"] !== "number") {
      return [];
    }
    const rawHeaders = Array.isArray(op["requestHeaders"]) ? op["requestHeaders"] : [];
    return [
      {
        method: typeof op["method"] === "string" ? op["method"] : "PUT",
        url: op["url"],
        length: op["length"],
        offset: op["offset"],
        requestHeaders: rawHeaders.flatMap((rawHeader): { name: string; value: string }[] => {
          const header = asRecord(rawHeader);
          return header && typeof header["name"] === "string" && typeof header["value"] === "string"
            ? [{ name: header["name"], value: header["value"] }]
            : [];
        }),
      },
    ];
  });
}

/**
 * PUT every reserved chunk of `bytes` to its pre-signed operation URL, up to {@link UPLOAD_CONCURRENCY}
 * at a time. Throws on the first failed chunk — a partial upload is unusable, since the commit would
 * reject the checksum — surfacing Apple's status so the caller can mark the asset failed and continue
 * with the rest of the batch.
 */
export async function uploadReservedAsset(bytes: Buffer, operations: UploadOperation[]): Promise<void> {
  if (operations.length === 0) {
    throw new Error("App Store Connect returned no upload operations for this asset.");
  }
  const results = await runPool(operations, UPLOAD_CONCURRENCY, async (operation) => {
    const chunk = bytes.subarray(operation.offset, operation.offset + operation.length);
    const headers = Object.fromEntries(operation.requestHeaders.map(({ name, value }) => [name, value]));
    const response = await fetch(operation.url, { method: operation.method, headers, body: chunk });
    if (!response.ok) {
      throw new Error(`Chunk upload failed (HTTP ${response.status}) at byte offset ${operation.offset}.`);
    }
  });
  for (const result of results) {
    if (!result.ok) throw result.error;
  }
}
