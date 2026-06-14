import { describe, expect, it } from "vitest";
import type { BuildArtifact, KeystoreAssets } from "../../core/types.js";
import {
  androidResignSpec,
  iosCodesignArgs,
  plistBuddyEntitlementsArgs,
  resignOutputPath,
  securityCmsArgs,
  unzipArgs,
  zipArgs,
} from "./resign.js";

const ipa: BuildArtifact = {
  path: "/store/looopi-1.2.0-42-ios.ipa",
  platform: "ios",
  appName: "looopi",
  profile: "production",
  version: "1.2.0",
  buildNumber: 42,
  sizeReport: { artifactBytes: 1, entries: [] },
  clean: true,
  createdAt: "2026-06-14T00:00:00.000Z",
};

const keystore: KeystoreAssets = {
  path: "/ks/upload.jks",
  alias: "upload",
  storePassword: "supersecret",
  keyPassword: "keysecret",
};

describe("resignOutputPath", () => {
  it("names the output by natural keys with a -resigned suffix and the source extension", () => {
    expect(resignOutputPath(ipa, "/out")).toBe("/out/looopi-1.2.0-42-resigned.ipa");
  });
});

describe("iOS arg builders", () => {
  it("produce the expected unzip/zip/cms/PlistBuddy/codesign vectors", () => {
    expect(unzipArgs("/a.ipa", "/w")).toEqual(["-oq", "/a.ipa", "-d", "/w"]);
    expect(zipArgs("/out.ipa")).toEqual(["-qr", "/out.ipa", "Payload"]);
    expect(securityCmsArgs("/p.mobileprovision")).toEqual(["cms", "-D", "-i", "/p.mobileprovision"]);
    expect(plistBuddyEntitlementsArgs("/p.plist")).toEqual(["-x", "-c", "Print :Entitlements", "/p.plist"]);
    expect(iosCodesignArgs("/w/Payload/App.app", "Apple Distribution", "/w/ent.plist")).toEqual([
      "-f",
      "-s",
      "Apple Distribution",
      "--entitlements",
      "/w/ent.plist",
      "/w/Payload/App.app",
    ]);
  });
});

describe("androidResignSpec", () => {
  it("uses apksigner for an .apk, passing passwords via env (never argv)", () => {
    const spec = androidResignSpec("/out.apk", keystore);
    expect(spec.command).toBe("apksigner");
    expect(spec.args).toEqual([
      "sign",
      "--ks",
      "/ks/upload.jks",
      "--ks-pass",
      "env:LAUNCH_KS_STOREPASS",
      "--ks-key-alias",
      "upload",
      "--key-pass",
      "env:LAUNCH_KS_KEYPASS",
      "/out.apk",
    ]);
    expect(spec.args).not.toContain("supersecret");
    expect(spec.env["LAUNCH_KS_STOREPASS"]).toBe("supersecret");
  });

  it("uses jarsigner for an .aab, alias last, passwords via :env", () => {
    const spec = androidResignSpec("/out.aab", keystore);
    expect(spec.command).toBe("jarsigner");
    expect(spec.args).toContain("-storepass:env");
    expect(spec.args).toContain("LAUNCH_KS_STOREPASS");
    expect(spec.args[spec.args.length - 1]).toBe("upload");
    expect(spec.args).not.toContain("supersecret");
    expect(spec.env["LAUNCH_KS_KEYPASS"]).toBe("keysecret");
  });
});
