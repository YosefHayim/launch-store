import type { Platform } from '@/types/app.js';
import type { SizeReportEntry } from '@/types/artifacts.js';
import type { SigningAssets } from '@/types/credentials.js';
import { makeProviderInputFailure } from '@/types/providers.js';
import { appleArtifactExtension, platformLabel } from '../stores/platform.ts';

/** Convert an App Thinning size and unit into bytes. */
function thinningBytes(sizeAmount: number, unit: string): number {
  const unitScales: Record<string, number> = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  let unitScale = unitScales[unit.toUpperCase()];

  if (unitScale == null) unitScale = 1;

  return Math.round(sizeAmount * unitScale);
}

/** Parse Xcode's App Thinning report into per-device download and install sizes. */
export function parseThinningReport(reportText: string): SizeReportEntry[] {
  const entries: SizeReportEntry[] = [];
  const variants = reportText.split(/Variant:/).slice(1);

  for (const variant of variants) {
    let deviceName = /(iPhone[\d,]+|iPad[\d,]+|Universal)/.exec(variant)?.[1];

    if (deviceName == null) deviceName = 'Universal';

    const sizeMatch =
      /App size:\s*([\d.]+)\s*(KB|MB|GB)\s*compressed,\s*([\d.]+)\s*(KB|MB|GB)\s*uncompressed/i.exec(
        variant,
      );

    if (sizeMatch == null) continue;

    const [, downloadValue, downloadUnit, installValue, installUnit] = sizeMatch;

    if (downloadValue == null) continue;

    if (downloadUnit == null) continue;

    if (installValue == null) continue;

    if (installUnit == null) continue;

    entries.push({
      device: deviceName,
      downloadBytes: thinningBytes(Number.parseFloat(downloadValue), downloadUnit),
      installBytes: thinningBytes(Number.parseFloat(installValue), installUnit),
    });
  }

  return entries;
}

/** Reject simulator, unpackaged, and empty Apple artifacts before storage or upload. */
export function assertDeviceArtifact(
  artifactPath: string,
  artifactBytes: number,
  platform: Platform,
): void {
  const expectedExtension = `.${appleArtifactExtension(platform)}`;
  const isMacApp = platform == 'macos';
  const looksLikeSimulator = /-(?:iphone|appletv|xr)simulator/i.test(artifactPath);

  if (isMacApp == false && looksLikeSimulator) {
    throw makeProviderInputFailure({
      provider: 'apple-artifact',
      message:
        `Build produced a simulator artifact (${artifactPath}). The store needs a device archive - ` +
        `build for a generic ${platformLabel(platform)} device, not a simulator, then re-run \`launch-store build ${platform}\`.`,
    });
  }

  const hasExpectedExtension = artifactPath.toLowerCase().endsWith(expectedExtension);

  if (hasExpectedExtension == false) {
    throw makeProviderInputFailure({
      provider: 'apple-artifact',
      message:
        `Expected a signed ${expectedExtension} for ${platformLabel(platform)} but got ${artifactPath} - ` +
        `that artifact is a simulator/unpackaged build and can't be submitted.`,
    });
  }

  const isEmptyArtifact = artifactBytes <= 0;

  if (isEmptyArtifact) {
    throw makeProviderInputFailure({
      provider: 'apple-artifact',
      message: `Build artifact ${artifactPath} is empty (0 bytes) - the export failed silently.`,
    });
  }
}

/** Render the manual-signing export plist used by local and remote Apple builds. */
export function exportOptionsPlist(
  signing: SigningAssets,
  method: 'app-store' | 'ad-hoc' = 'app-store',
): string {
  const profiles: Record<string, string> = {
    [signing.bundleId]: signing.profileName,
    ...signing.extensionProfiles,
  };

  function writeProfilePair([bundleId, profileName]: [string, string]) {
    return `<key>${bundleId}</key><string>${profileName}</string>`;
  }

  const profileEntries = Object.entries(profiles).map(writeProfilePair);

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
}
