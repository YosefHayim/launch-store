import { describe, expect, it } from "vitest";
import type { SigningAssets } from "../../core/types.js";
import { exportOptionsPlist, parseThinningReport } from "./fastlane.js";

const MB = 1024 ** 2;

const REPORT = `App Thinning Size Report for All Variants of MyApp.ipa

Variant: MyApp-iPhone15,2.ipa
Supported variant descriptors: iPhone15,2
App + On Demand Resources size: 45.2 MB compressed, 90.5 MB uncompressed
App size: 45.2 MB compressed, 90.5 MB uncompressed
On Demand Resources size: Zero KB

Variant: MyApp-Universal.ipa
Supported variant descriptors: Universal
App size: 50.0 MB compressed, 100.0 MB uncompressed
`;

describe("parseThinningReport — per-device download/install before any upload", () => {
  it("extracts one entry per variant with compressed/uncompressed sizes in bytes", () => {
    const entries = parseThinningReport(REPORT);
    expect(entries).toEqual([
      { device: "iPhone15,2", downloadBytes: Math.round(45.2 * MB), installBytes: Math.round(90.5 * MB) },
      { device: "Universal", downloadBytes: Math.round(50 * MB), installBytes: Math.round(100 * MB) },
    ]);
  });

  it("handles KB units and ignores variants with no parseable size line", () => {
    const text = `Variant: a.ipa
iPhone14,5
App size: 512 KB compressed, 1024 KB uncompressed

Variant: b.ipa
iPhone14,6
(no size here)
`;
    const entries = parseThinningReport(text);
    expect(entries).toEqual([{ device: "iPhone14,5", downloadBytes: 512 * 1024, installBytes: 1024 * 1024 }]);
  });

  it("degrades to an empty array rather than throwing on unrecognized text", () => {
    expect(parseThinningReport("totally unrelated output")).toEqual([]);
  });
});

describe("exportOptionsPlist — manual App Store signing inputs", () => {
  const signing: SigningAssets = {
    bundleId: "com.example.hello",
    teamId: "ABCDE12345",
    certName: "Apple Distribution",
    certSerial: "SERIAL123",
    profileName: "Launch_com.example.hello_AppStore",
    profileUuid: "uuid-1",
    profilePath: "/tmp/uuid-1.mobileprovision",
  };

  it("emits manual app-store signing keyed by the bundle id", () => {
    const plist = exportOptionsPlist(signing);
    expect(plist).toContain("<key>method</key><string>app-store</string>");
    expect(plist).toContain("<key>signingStyle</key><string>manual</string>");
    expect(plist).toContain("<key>teamID</key><string>ABCDE12345</string>");
    expect(plist).toContain("<key>signingCertificate</key><string>Apple Distribution</string>");
    expect(plist).toContain("<key>com.example.hello</key><string>Launch_com.example.hello_AppStore</string>");
    expect(plist).toContain("thin-for-all-variants");
  });
});
