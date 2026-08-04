import { Effect } from 'effect';
import type { Platform } from '../types/app.js';
import type { SizeReportEntry } from '../types/artifacts.js';
import type { SigningAssets } from '../types/credentials.js';
import { makeProviderInputFailure } from '../types/providers.js';
import { appleArtifactExtension, platformLabel } from './platform.js';

/** Convert an App Thinning size and unit into bytes. */
const thinningBytes = (sizeAmount: number, unit: string): number => {
  const unitScales: Record<string, number> = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  let unitScale = unitScales[unit.toUpperCase()];
  if (unitScale === undefined) unitScale = 1;
  return Math.round(sizeAmount * unitScale);
};

/** Parse Xcode's App Thinning report into per-device download and install sizes. */
export const parseThinningReport = (reportText: string): SizeReportEntry[] => {
  const entries: SizeReportEntry[] = [];
  const variants = reportText.split(/Variant:/).slice(1);
  for (const variant of variants) {
    let deviceName = /(iPhone[\d,]+|iPad[\d,]+|Universal)/.exec(variant)?.[1];
    if (deviceName === undefined) deviceName = 'Universal';
    const sizeMatch =
      /App size:\s*([\d.]+)\s*(KB|MB|GB)\s*compressed,\s*([\d.]+)\s*(KB|MB|GB)\s*uncompressed/i.exec(
        variant,
      );
    if (sizeMatch === null) continue;
    const [, downloadValue, downloadUnit, installValue, installUnit] = sizeMatch;
    if (downloadValue === undefined) continue;
    if (downloadUnit === undefined) continue;
    if (installValue === undefined) continue;
    if (installUnit === undefined) continue;
    entries.push({
      device: deviceName,
      downloadBytes: thinningBytes(Number.parseFloat(downloadValue), downloadUnit),
      installBytes: thinningBytes(Number.parseFloat(installValue), installUnit),
    });
  }
  return entries;
};

/** Reject simulator, unpackaged, and empty Apple artifacts before storage or upload. */
export const assertDeviceArtifact = (
  artifactPath: string,
  artifactBytes: number,
  platform: Platform,
) =>
  Effect.gen(function* () {
    const expectedExtension = `.${yield* appleArtifactExtension(platform)}`;
    if (platform !== 'macos' && /-(?:iphone|appletv|xr)simulator/i.test(artifactPath)) {
      return yield* Effect.fail(
        makeProviderInputFailure({
          provider: 'apple-artifact',
          message:
            `Build produced a simulator artifact (${artifactPath}). The store needs a device archive - ` +
            `build for a generic ${platformLabel(platform)} device, not a simulator, then re-run \`launch build ${platform}\`.`,
        }),
      );
    }
    if (!artifactPath.toLowerCase().endsWith(expectedExtension)) {
      return yield* Effect.fail(
        makeProviderInputFailure({
          provider: 'apple-artifact',
          message:
            `Expected a signed ${expectedExtension} for ${platformLabel(platform)} but got ${artifactPath} - ` +
            `that artifact is a simulator/unpackaged build and can't be submitted.`,
        }),
      );
    }
    if (artifactBytes <= 0) {
      return yield* Effect.fail(
        makeProviderInputFailure({
          provider: 'apple-artifact',
          message: `Build artifact ${artifactPath} is empty (0 bytes) - the export failed silently.`,
        }),
      );
    }
  });

/** Render the manual-signing export plist used by local and remote Apple builds. */
export const exportOptionsPlist = (
  signing: SigningAssets,
  method: 'app-store' | 'ad-hoc' = 'app-store',
): string => {
  const profiles: Record<string, string> = {
    [signing.bundleId]: signing.profileName,
    ...signing.extensionProfiles,
  };
  const profileEntries = Object.entries(profiles).map(
    ([bundleId, profileName]) => `<key>${bundleId}</key><string>${profileName}</string>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    `<key>method</key><string>${method}</string>`,
    '<key>signingStyle</key><string>manual</string>',
    `<key>teamID</key><string>${signing.teamId}</string>`,
    `<key>signingCertificate</key><string>${signing.certName}</string>`,
    '<key>provisioningProfiles</key><dict>',
    ...profileEntries,
    '</dict>',
    '<key>thinning</key><string>&lt;thin-for-all-variants&gt;</string>',
    '</dict></plist>',
  ].join('\n');
};
