import { describe, expect, it } from "vitest";
import { redactLine, redactText } from "./redact.js";

describe("redactLine", () => {
  it("masks secret-looking assignments but leaves publishable ones", () => {
    expect(redactLine("API_TOKEN=abc123")).toBe("API_TOKEN=***");
    expect(redactLine("ANDROID_KEYSTORE_PASSWORD: hunter2")).toBe("ANDROID_KEYSTORE_PASSWORD: ***");
    expect(redactLine("signing.store.password=s3cr3t")).toBe("signing.store.password=***");
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
    const log = [
      "before the key",
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvQIBADANBgkq",
      "hkiG9w0BAQEFAASC",
      "-----END PRIVATE KEY-----",
      "after the key",
    ].join("\n");
    const out = redactText(log);
    expect(out).toContain("before the key");
    expect(out).toContain("after the key");
    expect(out).toContain("[redacted-key-material]");
    expect(out).not.toContain("MIIEvQIBADANBgkq");
  });
});
