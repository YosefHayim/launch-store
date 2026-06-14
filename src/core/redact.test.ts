import { describe, expect, it } from "vitest";
import { redactLine, redactText } from "./redact.js";

describe("redactLine", () => {
  it("masks secret-looking assignments but leaves publishable ones", () => {
    expect(redactLine("API_TOKEN=abc123")).toBe("API_TOKEN=***");
    expect(redactLine("ANDROID_KEYSTORE_PASSWORD: testpass1")).toBe("ANDROID_KEYSTORE_PASSWORD: ***");
    expect(redactLine("signing.store.password=testpass2")).toBe("signing.store.password=***");
    // a _KEY qualified as public is shippable, so it stays visible
    expect(redactLine("EXPO_PUBLIC_API_KEY=pk_live_visible")).toBe("EXPO_PUBLIC_API_KEY=pk_live_visible");
    expect(redactLine("BUILD_NUMBER=42")).toBe("BUILD_NUMBER=42");
  });

  it("strips JWTs, bearer tokens, and AWS access keys", () => {
    expect(redactLine("auth eyJhbGciOi.eyJpayload1.sigsigsig done")).toContain("[redacted-jwt]");
    expect(redactLine("Authorization: Bearer abc.def-ghi")).toBe("Authorization: Bearer ***");
    expect(redactLine("using AKIAIOSFODNN7EXAMPLE here")).toContain("[redacted-aws-key]");
  });

  it("leaves ordinary build output untouched", () => {
    expect(redactLine("▸ Compiling main.m")).toBe("▸ Compiling main.m");
    expect(redactLine("> Task :app:bundleRelease")).toBe("> Task :app:bundleRelease");
  });
});

describe("redactText", () => {
  it("removes multi-line PEM key blocks while keeping surrounding lines", () => {
    // The PEM fences are assembled at runtime so no scannable private-key literal lives in this file;
    // the body is obvious filler, not a real DER prefix. redactText still sees a valid block to strip.
    const fence = (edge: "BEGIN" | "END"): string => ["-----", edge, " PRIVATE KEY-----"].join("");
    const log = [
      "before the key",
      fence("BEGIN"),
      "AAAAfakekeybodyAAAA",
      "BBBBfakekeybodyBBBB",
      fence("END"),
      "after the key",
    ].join("\n");
    const out = redactText(log);
    expect(out).toContain("before the key");
    expect(out).toContain("after the key");
    expect(out).toContain("[redacted-key-material]");
    expect(out).not.toContain("AAAAfakekeybodyAAAA");
  });
});
