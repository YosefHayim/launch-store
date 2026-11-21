import { FileSystem } from '@effect/platform';
import { Effect } from 'effect';

export type ImageDimensions = {
  readonly width: number;
  readonly height: number;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const readPngDimensions = (imageBytes: Buffer): ImageDimensions | null => {
  if (imageBytes.length < 24) return null;
  if (!imageBytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (imageBytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: imageBytes.readUInt32BE(16), height: imageBytes.readUInt32BE(20) };
};

const isStartOfFrame = (marker: number): boolean => {
  if (marker < 0xc0) return false;
  if (marker > 0xcf) return false;
  if (marker === 0xc4) return false;
  if (marker === 0xc8) return false;
  return marker !== 0xcc;
};

const readJpegDimensions = (imageBytes: Buffer): ImageDimensions | null => {
  if (imageBytes.length < 4) return null;
  if (imageBytes[0] !== 0xff) return null;
  if (imageBytes[1] !== 0xd8) return null;

  let byteOffset = 2;
  while (byteOffset + 1 < imageBytes.length) {
    if (imageBytes[byteOffset] !== 0xff) return null;

    const marker = imageBytes[byteOffset + 1];
    if (marker === undefined) return null;
    if (marker === 0xd8) {
      byteOffset += 2;
      continue;
    }
    if (marker === 0xd9) {
      byteOffset += 2;
      continue;
    }
    if (marker === 0x01) {
      byteOffset += 2;
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      byteOffset += 2;
      continue;
    }
    if (byteOffset + 4 > imageBytes.length) return null;

    const segmentLength = imageBytes.readUInt16BE(byteOffset + 2);
    if (isStartOfFrame(marker)) {
      if (byteOffset + 9 > imageBytes.length) return null;
      return {
        height: imageBytes.readUInt16BE(byteOffset + 5),
        width: imageBytes.readUInt16BE(byteOffset + 7),
      };
    }
    byteOffset += 2 + segmentLength;
  }
  return null;
};

export const readImageDimensions = (imageBytes: Uint8Array): ImageDimensions | null => {
  const imageBuffer = Buffer.from(imageBytes);
  const pngDimensions = readPngDimensions(imageBuffer);
  if (pngDimensions !== null) return pngDimensions;
  return readJpegDimensions(imageBuffer);
};

export const readScreenshotDimensions = (
  filePath: string,
): Effect.Effect<ImageDimensions | null, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const imageBytes = yield* fileSystem
      .readFile(filePath)
      .pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (imageBytes === null) return null;
    return readImageDimensions(imageBytes);
  });
