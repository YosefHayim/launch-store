import { describe, expect, it } from "vitest";
import { type FingerprintReport, formatFingerprintReport } from "./fingerprint.js";

const base: FingerprintReport = {
  app: "demo",
  platform: "ios",
  current: "abcdef0123456789abcdef",
  stored: { fingerprint: "abcdef0123456789abcdef", builtAt: "2026-06-13T10:00:00.000Z", cleanBuilt: true },
  decision: { clean: false, nativeChanged: false, reason: "cache warm — incremental" },
};

describe("formatFingerprintReport", () => {
  it("shows an incremental verdict with the matching last build", () => {
    const text = formatFingerprintReport(base);
    expect(text).toContain("demo (ios)");
    expect(text).toContain("Current fingerprint: abcdef012345"); // truncated to 12
    expect(text).toContain("2026-06-13T10:00:00.000Z, clean");
    expect(text).toContain("incremental (reuses warm caches) — cache warm — incremental");
  });

  it("reports no prior build on a fresh host", () => {
    const text = formatFingerprintReport({
      ...base,
      stored: null,
      decision: { clean: true, nativeChanged: true, reason: "first build on this host" },
    });
    expect(text).toContain("Last build:          none on this host yet");
    expect(text).toContain("clean (from scratch) — first build on this host");
  });

  it("explains a clean rebuild forced by a native-graph change", () => {
    const text = formatFingerprintReport({
      ...base,
      current: "ffffffffffffffffffff",
      decision: { clean: true, nativeChanged: true, reason: "native deps changed (Podfile.lock)" },
    });
    expect(text).toContain("clean (from scratch) — native deps changed (Podfile.lock)");
  });
});
