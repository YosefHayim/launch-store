import { describe, expect, it } from "vitest";
import { buildPrivacyReport, reconcilePrivacy, renderPrivacyReport } from "./reconcile.js";
import type { PrivacySurface } from "./types.js";

/** A clean baseline surface; tests override only the fields they exercise. */
function surface(overrides: Partial<PrivacySurface> = {}): PrivacySurface {
  return {
    usageDescriptions: {},
    hasManifest: true,
    collectedDataTypes: [],
    tracking: false,
    trackingDomains: [],
    androidPermissions: [],
    ...overrides,
  };
}

const codes = (findings: ReturnType<typeof reconcilePrivacy>): string[] => findings.map((finding) => finding.code);

describe("reconcilePrivacy", () => {
  it("flags an empty purpose string as a blocker", () => {
    const findings = reconcilePrivacy("app", surface({ usageDescriptions: { NSCameraUsageDescription: "" } }));
    const empty = findings.find((finding) => finding.code === "ios.usage.empty");
    expect(empty?.severity).toBe("blocker");
  });

  it("flags undeclared collection when a permission's data type isn't in the manifest", () => {
    const findings = reconcilePrivacy(
      "app",
      surface({ usageDescriptions: { NSCameraUsageDescription: "Scan" }, collectedDataTypes: [] }),
    );
    const undeclared = findings.find((finding) => finding.code === "ios.collection.undeclared");
    expect(undeclared?.severity).toBe("blocker");
    expect(undeclared?.message).toContain("NSPrivacyCollectedDataTypePhotosorVideos");
  });

  it("does not flag undeclared collection when the data type is declared", () => {
    const findings = reconcilePrivacy(
      "app",
      surface({
        usageDescriptions: { NSCameraUsageDescription: "Scan" },
        collectedDataTypes: ["NSPrivacyCollectedDataTypePhotosorVideos"],
      }),
    );
    expect(codes(findings)).not.toContain("ios.collection.undeclared");
  });

  it("warns on over-declaration of a reconcilable data type with no backing permission", () => {
    const findings = reconcilePrivacy("app", surface({ collectedDataTypes: ["NSPrivacyCollectedDataTypeContacts"] }));
    const over = findings.find((finding) => finding.code === "ios.collection.overdeclared");
    expect(over?.severity).toBe("warning");
  });

  it("ignores non-reconcilable declared data types (e.g. Name) in the over-declaration check", () => {
    const findings = reconcilePrivacy("app", surface({ collectedDataTypes: ["NSPrivacyCollectedDataTypeName"] }));
    expect(codes(findings)).not.toContain("ios.collection.overdeclared");
  });

  it("warns when usage descriptions exist but no manifest is present", () => {
    const findings = reconcilePrivacy(
      "app",
      surface({ hasManifest: false, usageDescriptions: { NSCameraUsageDescription: "Scan" } }),
    );
    expect(codes(findings)).toContain("ios.manifest.missing");
    // With no manifest, undeclared-collection is not asserted.
    expect(codes(findings)).not.toContain("ios.collection.undeclared");
  });

  it("flags a tracking-flag mismatch as a blocker", () => {
    const findings = reconcilePrivacy(
      "app",
      surface({ usageDescriptions: { NSUserTrackingUsageDescription: "Ads" }, tracking: false }),
    );
    expect(findings.find((finding) => finding.code === "ios.tracking.mismatch")?.severity).toBe("blocker");
  });

  it("emits advisory Data Safety reminders for android data permissions", () => {
    const findings = reconcilePrivacy("app", surface({ androidPermissions: ["android.permission.CAMERA"] }));
    const reminder = findings.find((finding) => finding.code === "android.datasafety.reminder");
    expect(reminder?.severity).toBe("info");
    expect(reminder?.platform).toBe("android");
  });

  it("produces no findings for a clean surface", () => {
    expect(reconcilePrivacy("app", surface())).toEqual([]);
  });
});

describe("buildPrivacyReport", () => {
  it("exits 2 when any blocker is present", () => {
    const findings = reconcilePrivacy("app", surface({ usageDescriptions: { NSCameraUsageDescription: "" } }));
    expect(buildPrivacyReport(findings, ["app"]).exitCode).toBe(2);
  });

  it("exits 0 when only warnings/info are present", () => {
    const findings = reconcilePrivacy("app", surface({ androidPermissions: ["android.permission.CAMERA"] }));
    expect(buildPrivacyReport(findings, ["app"]).exitCode).toBe(0);
  });

  it("exits 1 when nothing was scanned", () => {
    expect(buildPrivacyReport([], []).exitCode).toBe(1);
  });
});

describe("renderPrivacyReport", () => {
  it("reports a clean surface", () => {
    expect(renderPrivacyReport(buildPrivacyReport([], ["app"]))).toContain("clean");
  });

  it("lists findings per app with a tally", () => {
    // A tracking mismatch is exactly one blocker, with no incidental findings.
    const findings = reconcilePrivacy(
      "app",
      surface({ usageDescriptions: { NSUserTrackingUsageDescription: "Ads" }, tracking: false }),
    );
    const rendered = renderPrivacyReport(buildPrivacyReport(findings, ["app"]));
    expect(rendered).toContain("app");
    expect(rendered).toContain("1 blocker(s)");
  });
});
