import { describe, expect, it } from "vitest";
import { readImageSize } from "./imageSize.js";

/** A minimal valid PNG: 8-byte signature + an IHDR chunk carrying the given big-endian width/height. */
function png(width: number, height: number): Buffer {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(16); // 4-byte length + "IHDR" + width + height
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([head, ihdr]);
}

/**
 * A minimal JPEG: SOI, an optional APP0 segment to exercise the skip path, then a SOF0 frame whose
 * segment carries `[precision][height][width]`. `withApp0` defaults to true so the common multi-segment
 * layout is the default under test.
 */
function jpeg(width: number, height: number, withApp0 = true): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = withApp0 ? Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]) : Buffer.alloc(0); // length 4 → 2 payload bytes
  const sof = Buffer.alloc(11); // FF C0, length(2), precision(1), height(2), width(2), 2 component bytes
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(0x0011, 2);
  sof.writeUInt8(0x08, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([soi, app0, sof]);
}

describe("readImageSize", () => {
  it("reads PNG dimensions from the IHDR chunk", () => {
    expect(readImageSize(png(1290, 2796))).toEqual({ width: 1290, height: 2796 });
  });

  it("reads JPEG dimensions, walking past an APP0 segment to the Start-Of-Frame", () => {
    expect(readImageSize(jpeg(1080, 1920))).toEqual({ width: 1080, height: 1920 });
  });

  it("reads a JPEG whose first segment is the Start-Of-Frame", () => {
    expect(readImageSize(jpeg(2048, 2732, false))).toEqual({ width: 2048, height: 2732 });
  });

  it("returns null for a buffer that is neither PNG nor JPEG", () => {
    expect(readImageSize(Buffer.from("not an image at all"))).toBeNull();
  });

  it("returns null for a truncated PNG signature", () => {
    expect(readImageSize(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
  });

  it("returns null for a JPEG that ends before any Start-Of-Frame", () => {
    expect(readImageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]))).toBeNull();
  });

  it("returns null (does not throw) for a JPEG truncated right at a marker's length field", () => {
    expect(readImageSize(Buffer.from([0xff, 0xd8, 0xff, 0xc0]))).toBeNull();
  });
});
