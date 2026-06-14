import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { md5Hex, parseUploadOperations, uploadReservedAsset } from "./ascAssets.js";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("md5Hex", () => {
  it("computes the lowercase-hex MD5 Apple expects at commit", () => {
    const bytes = Buffer.from("screenshot-bytes");
    expect(md5Hex(bytes)).toBe(createHash("md5").update(bytes).digest("hex"));
  });
});

describe("parseUploadOperations", () => {
  it("narrows Apple's operations, defaulting method to PUT and keeping name/value headers", () => {
    expect(
      parseUploadOperations([
        { url: "https://u/1", length: 4, offset: 0, requestHeaders: [{ name: "Content-Type", value: "image/png" }] },
        { method: "PUT", url: "https://u/2", length: 3, offset: 4 },
      ]),
    ).toEqual([
      {
        method: "PUT",
        url: "https://u/1",
        length: 4,
        offset: 0,
        requestHeaders: [{ name: "Content-Type", value: "image/png" }],
      },
      { method: "PUT", url: "https://u/2", length: 3, offset: 4, requestHeaders: [] },
    ]);
  });

  it("drops malformed entries and non-array input", () => {
    expect(parseUploadOperations(null)).toEqual([]);
    expect(parseUploadOperations([{ url: "x" }, { length: 1, offset: 0 }, 42])).toEqual([]);
  });

  it("drops header entries lacking a string name/value", () => {
    const [op] = parseUploadOperations([
      { url: "https://u", length: 1, offset: 0, requestHeaders: [{ name: "A", value: "1" }, { name: "B" }, "nope"] },
    ]);
    expect(op?.requestHeaders).toEqual([{ name: "A", value: "1" }]);
  });
});

describe("uploadReservedAsset", () => {
  it("PUTs each chunk's byte slice to its URL with the given headers", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await uploadReservedAsset(Buffer.from("ABCDEFG"), [
      {
        method: "PUT",
        url: "https://u/1",
        length: 4,
        offset: 0,
        requestHeaders: [{ name: "Content-Type", value: "image/png" }],
      },
      { method: "PUT", url: "https://u/2", length: 3, offset: 4, requestHeaders: [] },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Uploads run in parallel, so match by URL rather than call order.
    const first = fetchMock.mock.calls.find(([url]) => url === "https://u/1")!;
    expect(first[1].method).toBe("PUT");
    expect(first[1].headers).toEqual({ "Content-Type": "image/png" });
    expect(Buffer.from(first[1].body).toString()).toBe("ABCD");
    const second = fetchMock.mock.calls.find(([url]) => url === "https://u/2")!;
    expect(Buffer.from(second[1].body).toString()).toBe("EFG");
  });

  it("throws when a chunk PUT fails (a partial upload would fail the checksum)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    await expect(
      uploadReservedAsset(Buffer.from("AB"), [
        { method: "PUT", url: "https://u", length: 2, offset: 0, requestHeaders: [] },
      ]),
    ).rejects.toThrow(/403/);
  });

  it("throws when Apple returns no operations", async () => {
    await expect(uploadReservedAsset(Buffer.from("AB"), [])).rejects.toThrow(/no upload operations/i);
  });
});
