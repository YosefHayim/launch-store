import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import type { SigningAssets } from "../../core/types.js";
import { assertDeviceArtifact, exportOptionsPlist, gymEnv, parseThinningReport, resolveNativeDir } from "./fastlane.js";

const MB = 1024 ** 2;

describe("resolveNativeDir — absolute native-project path so gym can't double the subpath in a monorepo", () => {
  it("returns an absolute path for a relative app dir (the monorepo `appRoots` case)", () => {
    const iosDir = resolveNativeDir("apps/pomedero", "ios");
    expect(isAbsolute(iosDir)).toBe(true);
    expect(iosDir.endsWith("/apps/pomedero/ios")).toBe(true);
    // The reported failure: gym re-resolved a relative workspace against its app-dir cwd.
    expect(iosDir).not.toContain("apps/pomedero/apps/pomedero");
  });

  it("leaves an already-absolute app dir untouched", () => {
    expect(resolveNativeDir("/Users/x/zaatar/apps/pomedero", "ios")).toBe("/Users/x/zaatar/apps/pomedero/ios");
  });

  it("maps each Apple platform to its native-project directory (tvOS shares ios/)", () => {
    expect(resolveNativeDir("/a", "tvos").endsWith("/a/ios")).toBe(true);
    expect(resolveNativeDir("/a", "macos").endsWith("/a/macos")).toBe(true);
    expect(resolveNativeDir("/a", "visionos").endsWith("/a/visionos")).toBe(true);
  });
});

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

  it("adds one provisioningProfiles entry per embedded extension so every bundle in the .ipa signs", () => {
    const plist = exportOptionsPlist({
      ...signing,
      extensionProfiles: {
        "com.example.hello.widget": "Launch_com.example.hello.widget_AppStore",
        "com.example.hello.share": "Launch_com.example.hello.share_AppStore",
      },
    });
    expect(plist).toContain("<key>com.example.hello</key><string>Launch_com.example.hello_AppStore</string>");
    expect(plist).toContain(
      "<key>com.example.hello.widget</key><string>Launch_com.example.hello.widget_AppStore</string>",
    );
    expect(plist).toContain(
      "<key>com.example.hello.share</key><string>Launch_com.example.hello.share_AppStore</string>",
    );
  });
});

describe("assertDeviceArtifact — reject a non-submittable build before upload", () => {
  it("accepts a real device .ipa with a positive size", () => {
    expect(() => {
      assertDeviceArtifact("/tmp/launch-build-x/Looopi.ipa", 12 * MB, "ios");
    }).not.toThrow();
  });

  it("rejects a simulator artifact (the reported xcrun simctl failure mode)", () => {
    const simPath = "/path/ios/build/Build/Products/Release-iphonesimulator/Looopi.app";
    expect(() => {
      assertDeviceArtifact(simPath, 8 * MB, "ios");
    }).toThrow(/simulator/i);
  });

  it("rejects a .app bundle that isn't a packaged .ipa", () => {
    expect(() => {
      assertDeviceArtifact("/tmp/Looopi.app", 8 * MB, "ios");
    }).toThrow(/\.ipa/);
  });

  it("rejects a 0-byte artifact from a silently-failed export", () => {
    expect(() => {
      assertDeviceArtifact("/tmp/Looopi.ipa", 0, "ios");
    }).toThrow(/empty/i);
  });

  it("catches a tvOS simulator artifact built for -appletvsimulator", () => {
    const simPath = "/path/ios/build/Build/Products/Release-appletvsimulator/Looopi.app";
    expect(() => {
      assertDeviceArtifact(simPath, 8 * MB, "tvos");
    }).toThrow(/simulator/i);
  });

  it("accepts a macOS .pkg (no simulator rule) but rejects a macOS .ipa", () => {
    expect(() => {
      assertDeviceArtifact("/tmp/Looopi.pkg", 20 * MB, "macos");
    }).not.toThrow();
    expect(() => {
      assertDeviceArtifact("/tmp/Looopi.ipa", 20 * MB, "macos");
    }).toThrow(/\.pkg/);
  });
});

describe("gymEnv — forwards Launch's resolved env to the bundle step; build/auth vars still win (#109)", () => {
  const ascKey = { keyId: "KID", issuerId: "ISS" };

  it("forwards ctx.env (the EXPO_PUBLIC_* layer that inlines into the bundle) alongside the ASC key", () => {
    const env = gymEnv({ EXPO_PUBLIC_CDN_URL: "https://real.cdn", EXPO_PUBLIC_FLAG: "on" }, {}, ascKey);
    expect(env["EXPO_PUBLIC_CDN_URL"]).toBe("https://real.cdn");
    expect(env["EXPO_PUBLIC_FLAG"]).toBe("on");
    expect(env["APP_STORE_CONNECT_API_KEY_KEY_ID"]).toBe("KID");
    expect(env["APP_STORE_CONNECT_API_KEY_ISSUER_ID"]).toBe("ISS");
  });

  it("lets ccache and the resolved ASC key override a colliding user var (build/auth wins)", () => {
    const env = gymEnv(
      { CC: "user-cc", APP_STORE_CONNECT_API_KEY_KEY_ID: "user-override" },
      { CC: "ccache-cc" },
      ascKey,
    );
    expect(env["CC"]).toBe("ccache-cc"); // ccache wrapper wins over a user `--env CC`
    expect(env["APP_STORE_CONNECT_API_KEY_KEY_ID"]).toBe("KID"); // resolved creds win over a spoofed override
  });
});
