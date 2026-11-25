import { describe, expect, it } from 'vitest';
import { readImageDimensions } from './imageDimensions.js';

const pngBytes = (width: number, height: number): Buffer => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(16);
  header.writeUInt32BE(13, 0);
  header.write('IHDR', 4, 'ascii');
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  return Buffer.concat([signature, header]);
};

const jpegBytes = (width: number, height: number, includeAppSegment = true): Buffer => {
  const startOfImage = Buffer.from([0xff, 0xd8]);
  let appSegment = Buffer.alloc(0);
  if (includeAppSegment) appSegment = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const frame = Buffer.alloc(11);
  frame.writeUInt16BE(0xffc0, 0);
  frame.writeUInt16BE(0x0011, 2);
  frame.writeUInt8(0x08, 4);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  return Buffer.concat([startOfImage, appSegment, frame]);
};

describe('readImageDimensions', () => {
  it('reads PNG dimensions', () => {
    expect(readImageDimensions(pngBytes(1290, 2796))).toEqual({ width: 1290, height: 2796 });
  });

  it('reads JPEG dimensions after an application segment', () => {
    expect(readImageDimensions(jpegBytes(1080, 1920))).toEqual({ width: 1080, height: 1920 });
  });

  it('reads a JPEG whose first segment contains the frame', () => {
    expect(readImageDimensions(jpegBytes(2048, 2732, false))).toEqual({
      width: 2048,
      height: 2732,
    });
  });

  it('rejects unsupported bytes', () => {
    expect(readImageDimensions(Buffer.from('not an image'))).toBeNull();
  });

  it('rejects a truncated PNG', () => {
    expect(readImageDimensions(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
  });

  it('rejects a JPEG without a frame', () => {
    expect(
      readImageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00])),
    ).toBeNull();
  });

  it('rejects a JPEG truncated at a segment length', () => {
    expect(readImageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xc0]))).toBeNull();
  });
});
