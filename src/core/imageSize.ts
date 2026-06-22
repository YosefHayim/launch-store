/**
 * Read the intrinsic pixel dimensions of an image from its header bytes — PNG and JPEG only, the two
 * formats the App Store and Play accept for screenshots (see `core/screenshotAssets.ts`
 * `IMAGE_EXTENSIONS`). Dependency-free on purpose: Launch ships no image library (the only pixel code is
 * the TUI `Pixmap` in `core/wordmark.ts`), and the screenshot dimension hard-gate
 * (`core/screenshotSpecs.ts`) needs a width/height for a file without pulling in `sharp`/`jimp`.
 *
 * Both parsers read only the leading bytes — PNG's `IHDR` sits at a fixed offset; JPEG requires walking
 * the marker segments to the Start-Of-Frame — so an unreadable or non-image file returns `null` rather
 * than throwing, letting callers degrade to "couldn't measure this one" instead of failing a whole pass.
 */

import { readFileSync } from "node:fs";

/** Intrinsic pixel size of an image, as read from its header. */
export interface ImageSize {
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/** The 8-byte PNG signature every PNG file opens with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Parse a PNG's dimensions from its `IHDR` chunk, which the spec fixes as the first chunk: an 8-byte
 * signature, then a 4-byte length and the `IHDR` type, then the big-endian uint32 width and height — so
 * width lives at byte 16 and height at byte 20. Returns `null` when the signature or `IHDR` is absent.
 */
function readPngSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** JPEG Start-Of-Frame markers (`0xC0`–`0xCF`) carry the frame's height/width; these three never do. */
function isStartOfFrame(marker: number): boolean {
  if (marker < 0xc0 || marker > 0xcf) return false;
  return marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc; // DHT / JPG / DAC carry tables, not a frame
}

/**
 * Parse a JPEG's dimensions by walking its marker segments from the `SOI` (`0xFFD8`) to the first
 * Start-Of-Frame, where a segment is `[1-byte precision][2-byte height][2-byte width]` after the marker's
 * 2-byte length. Standalone markers (`RSTn`, `SOI`, `EOI`, `TEM`) carry no length and are stepped over;
 * everything else is skipped by its declared length. Returns `null` on a malformed or non-JPEG buffer.
 */
function readJpegSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null; // lost segment alignment — not a JPEG we can read
    const marker = bytes[offset + 1];
    if (marker === undefined) return null; // ran off the end mid-marker
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // standalone marker — no length payload
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (isStartOfFrame(marker)) {
      if (offset + 9 > bytes.length) return null;
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length; // skip this segment's marker and payload
  }
  return null;
}

/**
 * Read an image's pixel dimensions from a buffer of its leading bytes, dispatching on the file signature.
 * Returns `null` for anything that isn't a PNG or JPEG we can parse.
 */
export function readImageSize(bytes: Buffer): ImageSize | null {
  return readPngSize(bytes) ?? readJpegSize(bytes);
}

/**
 * Read an image file's pixel dimensions from disk, or `null` when the file is missing, unreadable, or not
 * a PNG/JPEG — so a screenshot pass can record "couldn't measure" without aborting on one bad file.
 */
export function imageSize(path: string): ImageSize | null {
  try {
    return readImageSize(readFileSync(path));
  } catch {
    return null;
  }
}
