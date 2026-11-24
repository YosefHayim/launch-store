// Reads entitlement values from an Apple provisioning profile on macOS.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureCommandOutput } from '../services/platform/execute-command.ts';
import { checkIsMacOperatingSystem } from '../services/platform/host-operating-system.ts';
import type { EntitlementValue } from '../types/adopt.ts';

function isEntitlementValue(candidate: unknown): candidate is EntitlementValue {
  if (typeof candidate == 'string') {
    return true;
  }

  if (typeof candidate == 'number') {
    return true;
  }

  if (typeof candidate == 'boolean') {
    return true;
  }

  if (candidate == null) {
    return true;
  }

  if (Array.isArray(candidate)) {
    return candidate.every(isEntitlementValue);
  }

  if (typeof candidate != 'object') {
    return false;
  }

  return Object.values(candidate).every(isEntitlementValue);
}

function isEntitlementRecord(candidate: unknown): candidate is Record<string, EntitlementValue> {
  if (isEntitlementValue(candidate) == false) {
    return false;
  }

  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  return true;
}

function readProfileEntitlements(entitlementsJson: string): Record<string, EntitlementValue> {
  const parsedEntitlements: unknown = JSON.parse(entitlementsJson);
  const isEntitlementDocument = isEntitlementRecord(parsedEntitlements);

  if (isEntitlementDocument == false) {
    throw new Error('Provisioning profile entitlements are not a JSON object.');
  }

  return parsedEntitlements;
}

/** Decode entitlement values from a provisioning profile on macOS. */
export async function extractProfileEntitlements(
  profileContent: string,
): Promise<Record<string, EntitlementValue> | null> {
  const runningOnMac = checkIsMacOperatingSystem();

  if (runningOnMac == false) {
    return null;
  }

  let workspacePath: string | null = null;

  try {
    const systemTemporaryDirectory = tmpdir();
    const launchAdoptPath = join(systemTemporaryDirectory, 'launch-adopt-');

    workspacePath = await mkdtemp(launchAdoptPath);

    const profilePath = join(workspacePath, 'profile.mobileprovision');
    const bufferBytes = Buffer.from(profileContent, 'base64');

    await writeFile(profilePath, bufferBytes);

    const decodedPlist = await captureCommandOutput('security', ['cms', '-D', '-i', profilePath]);
    const plistPath = join(workspacePath, 'decoded.plist');

    await writeFile(plistPath, decodedPlist);

    const entitlementsPlistPath = join(workspacePath, 'entitlements.plist');

    await captureCommandOutput('plutil', [
      '-extract',
      'Entitlements',
      'xml1',
      '-o',
      entitlementsPlistPath,
      plistPath,
    ]);

    const entitlementsJson = await captureCommandOutput('plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      entitlementsPlistPath,
    ]);

    const profileEntitlements = readProfileEntitlements(entitlementsJson);

    if (workspacePath != null) {
      await rm(workspacePath, { recursive: true, force: true });
    }

    return profileEntitlements;
  } catch {
    if (workspacePath != null) {
      try {
        await rm(workspacePath, { recursive: true, force: true });
      } catch {
        return null;
      }
    }

    return null;
  }
}
