import { describe, expect, it } from "vitest";
import {
  parseAndroidPermissions,
  parsePrivacyManifest,
  parseUsageDescriptions,
  surfaceFromExpoConfig,
  surfaceFromNative,
} from "./parse.js";

const INFO_PLIST = `<?xml version="1.0"?>
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>MyApp</string>
  <key>NSCameraUsageDescription</key><string>We use the camera to scan receipts.</string>
  <key>NSLocationWhenInUseUsageDescription</key><string></string>
  <key>NSContactsUsageDescription</key><string/>
</dict></plist>`;

const XCPRIVACY = `<?xml version="1.0"?>
<plist version="1.0"><dict>
  <key>NSPrivacyTracking</key><true/>
  <key>NSPrivacyTrackingDomains</key>
  <array><string>ads.example.com</string></array>
  <key>NSPrivacyCollectedDataTypes</key>
  <array>
    <dict><key>NSPrivacyCollectedDataType</key><string>NSPrivacyCollectedDataTypePhotosorVideos</string></dict>
    <dict><key>NSPrivacyCollectedDataType</key><string>NSPrivacyCollectedDataTypeContacts</string></dict>
  </array>
</dict></plist>`;

const ANDROID_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.CAMERA"/>
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
  <uses-permission android:name="android.permission.CAMERA"/>
</manifest>`;

describe("parseUsageDescriptions", () => {
  it("extracts usage keys, including empty and self-closing values", () => {
    const usage = parseUsageDescriptions(INFO_PLIST);
    expect(usage["NSCameraUsageDescription"]).toBe("We use the camera to scan receipts.");
    expect(usage["NSLocationWhenInUseUsageDescription"]).toBe("");
    expect(usage["NSContactsUsageDescription"]).toBe("");
    expect(usage["CFBundleName"]).toBeUndefined();
  });
});

describe("parsePrivacyManifest", () => {
  it("reads collected data types, the tracking flag, and tracking domains", () => {
    const manifest = parsePrivacyManifest(XCPRIVACY);
    expect(manifest.collectedDataTypes).toEqual([
      "NSPrivacyCollectedDataTypePhotosorVideos",
      "NSPrivacyCollectedDataTypeContacts",
    ]);
    expect(manifest.tracking).toBe(true);
    expect(manifest.trackingDomains).toEqual(["ads.example.com"]);
  });

  it("defaults tracking to false when the key is absent", () => {
    expect(parsePrivacyManifest("<dict></dict>").tracking).toBe(false);
  });
});

describe("parseAndroidPermissions", () => {
  it("extracts and de-duplicates permission names", () => {
    expect(parseAndroidPermissions(ANDROID_MANIFEST)).toEqual([
      "android.permission.CAMERA",
      "android.permission.ACCESS_FINE_LOCATION",
    ]);
  });
});

describe("surfaceFromNative", () => {
  it("unions the parsed files into one surface", () => {
    const surface = surfaceFromNative({
      infoPlists: [INFO_PLIST],
      privacyManifests: [XCPRIVACY],
      androidManifests: [ANDROID_MANIFEST],
    });
    expect(surface.hasManifest).toBe(true);
    expect(surface.tracking).toBe(true);
    expect(Object.keys(surface.usageDescriptions)).toContain("NSCameraUsageDescription");
    expect(surface.androidPermissions).toContain("android.permission.CAMERA");
  });

  it("reports no manifest when no .xcprivacy was parsed", () => {
    const surface = surfaceFromNative({ infoPlists: [INFO_PLIST], privacyManifests: [], androidManifests: [] });
    expect(surface.hasManifest).toBe(false);
  });
});

describe("surfaceFromExpoConfig", () => {
  it("reads usage strings, the manifest, and android permissions from the resolved config", () => {
    const surface = surfaceFromExpoConfig({
      expo: {
        ios: {
          infoPlist: { NSCameraUsageDescription: "Scan receipts", CFBundleName: "MyApp" },
          privacyManifests: {
            NSPrivacyTracking: false,
            NSPrivacyCollectedDataTypes: [{ NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypePhotosorVideos" }],
          },
        },
        android: { permissions: ["android.permission.CAMERA", 42] },
      },
    });
    expect(surface.usageDescriptions).toEqual({ NSCameraUsageDescription: "Scan receipts" });
    expect(surface.hasManifest).toBe(true);
    expect(surface.collectedDataTypes).toEqual(["NSPrivacyCollectedDataTypePhotosorVideos"]);
    expect(surface.androidPermissions).toEqual(["android.permission.CAMERA"]);
  });

  it("tolerates a config with no ios/android sections", () => {
    const surface = surfaceFromExpoConfig({});
    expect(surface.hasManifest).toBe(false);
    expect(surface.usageDescriptions).toEqual({});
    expect(surface.androidPermissions).toEqual([]);
  });
});
