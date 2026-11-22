import { inflateRawSync } from 'node:zlib';

const zipLocalFileHeader = 0x04034b50;
const centralHeader = 0x02014b50;
const endHeader = 0x06054b50;
const stored = 0;
const deflated = 8;
const END_RECORD_LENGTH = 22;
const commentLimit = 65535;

export function readZipEntries(zipBytes: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const endOffset = findEndRecord(zipBytes, view);
  const entryCount = view.getUint16(endOffset + 10, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  const entries: Record<string, Uint8Array> = {};
  let cursor = directoryOffset;

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    const header = view.getUint32(cursor, true);
    const isCentralHeader = header == centralHeader;

    if (isCentralHeader == false) {
      throw new Error('The zip central directory is unreadable');
    }

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameStart = cursor + 46;
    const name = new TextDecoder().decode(zipBytes.subarray(nameStart, nameStart + nameLength));
    const isDirectory = name.endsWith('/');

    if (isDirectory == false) {
      entries[name] = readEntry(zipBytes, view, {
        method,
        compressedSize,
        localOffset,
      });
    }

    cursor = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndRecord(zipBytes: Uint8Array, view: DataView): number {
  const fits = zipBytes.length >= END_RECORD_LENGTH;

  if (fits == false) {
    throw new Error('The zip ended early');
  }

  let start = zipBytes.length - END_RECORD_LENGTH;
  const earliest = Math.max(0, zipBytes.length - END_RECORD_LENGTH - commentLimit);

  while (start >= earliest) {
    const header = view.getUint32(start, true);
    const isEnd = header == endHeader;

    if (isEnd) {
      const commentLength = view.getUint16(start + 20, true);
      const recordEnd = start + END_RECORD_LENGTH + commentLength;
      const coversFile = recordEnd == zipBytes.length;

      if (coversFile) {
        return start;
      }
    }

    start -= 1;
  }

  throw new Error('The zip has no central directory');
}

function readEntry(
  zipBytes: Uint8Array,
  view: DataView,
  entry: { method: number; compressedSize: number; localOffset: number },
): Uint8Array {
  const localHeader = view.getUint32(entry.localOffset, true);
  const isLocalHeader = localHeader == zipLocalFileHeader;

  if (isLocalHeader == false) {
    throw new Error('The zip local header is unreadable');
  }

  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  const compressed = zipBytes.subarray(dataStart, dataEnd);

  if (entry.method == stored) {
    return compressed;
  }

  if (entry.method == deflated) {
    return inflateRawSync(compressed);
  }

  throw new Error(`The zip compression method ${entry.method} is not supported`);
}
