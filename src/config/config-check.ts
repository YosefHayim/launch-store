// Checks an app config for a valid bundle id, icon, splash, and version before a store build.

import { basename } from 'node:path';
import { isApplePlatform } from '../services/stores/platform.ts';
import type { AppDescriptor, Platform } from '../types/app.ts';
import { readAppConfig } from './config.ts';

type FindingSeverity = 'error' | 'warn';

type ConfigFinding = {
  severity: FindingSeverity;
  file: string;
  key: string;
  message: string;
  fix: string;
};

function decodedRecordOrNull(candidateValue: unknown): Record<string, unknown> | null {
  if (candidateValue == null) {
    return null;
  }

  if (typeof candidateValue != 'object') {
    return null;
  }

  if (Array.isArray(candidateValue)) {
    return null;
  }

  return candidateValue as Record<string, unknown>;
}

function splashLacksBackground(splash: Record<string, unknown> | null): boolean {
  if (splash == null) {
    return false;
  }

  const hasKeys = Object.keys(splash).length > 0;

  if (hasKeys == false) {
    return false;
  }

  return typeof splash['backgroundColor'] != 'string';
}

function invalidBundleId(ios: Record<string, unknown> | null): string | null {
  if (ios == null) {
    return null;
  }

  const bundleId = ios['bundleIdentifier'];

  if (typeof bundleId != 'string') {
    return null;
  }

  const isValid = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(bundleId);

  if (isValid) {
    return null;
  }

  return bundleId;
}

function invalidAndroidPackage(android: Record<string, unknown> | null): string | null {
  if (android == null) {
    return null;
  }

  const packageName = android['package'];

  if (typeof packageName != 'string') {
    return null;
  }

  const isValid = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName);

  if (isValid) {
    return null;
  }

  return packageName;
}

function splashBackgroundIsSet(splash: Record<string, unknown> | null): boolean {
  if (splash == null) {
    return false;
  }

  return typeof splash['backgroundColor'] == 'string';
}

function splashScreenIsBroken(
  splash: Record<string, unknown> | null,
  androidSplash: Record<string, unknown> | null,
): boolean {
  if (splashBackgroundIsSet(androidSplash)) {
    return false;
  }

  if (splashBackgroundIsSet(splash)) {
    return false;
  }

  if (splashLacksBackground(splash)) {
    return true;
  }

  return splashLacksBackground(androidSplash);
}

function lacksAppIcon(
  expo: Record<string, unknown>,
  ios: Record<string, unknown> | null,
  android: Record<string, unknown> | null,
): boolean {
  if (typeof expo['icon'] == 'string') {
    return false;
  }

  if (ios != null) {
    if (typeof ios['icon'] == 'string') {
      return false;
    }
  }

  const adaptiveIcon = readAdaptiveIcon(android);

  return adaptiveIcon == null;
}

function readAdaptiveIcon(android: Record<string, unknown> | null): Record<string, unknown> | null {
  if (android == null) {
    return null;
  }

  return decodedRecordOrNull(android['adaptiveIcon']);
}

function invalidMarketingVersion(expo: Record<string, unknown>): string | null {
  const version = expo['version'];

  if (typeof version != 'string') {
    return null;
  }

  const isPlainVersion = /^\d+(\.\d+){0,2}$/.test(version);

  if (isPlainVersion) {
    return null;
  }

  return version;
}

export function checkAppConfig(
  raw: Record<string, unknown>,
  file: string,
  platform: Platform,
): ConfigFinding[] {
  let expo = decodedRecordOrNull(raw['expo']);

  if (expo == null) {
    expo = raw;
  }

  const ios = decodedRecordOrNull(expo['ios']);
  const android = decodedRecordOrNull(expo['android']);
  const findings: ConfigFinding[] = [];

  const applePlatform = isApplePlatform(platform);

  if (applePlatform) {
    const bundleId = invalidBundleId(ios);

    if (bundleId != null) {
      findings.push({
        severity: 'error',
        file,
        key: 'ios.bundleIdentifier',
        message: `"${bundleId}" is not a valid bundle id`,
        fix: 'use reverse-DNS with letters, digits, hyphens, and dots only (e.g. com.acme.app); underscores and spaces are rejected by Xcode.',
      });
    }
  }

  const isAndroid = platform == 'android';

  if (isAndroid) {
    const packageName = invalidAndroidPackage(android);

    if (packageName != null) {
      findings.push({
        severity: 'error',
        file,
        key: 'android.package',
        message: `"${packageName}" is not a valid Android application id`,
        fix: 'use a Java package: two+ dot-separated segments, each starting with a letter (e.g. com.acme.app); hyphens and digit-led segments break Gradle.',
      });
    }

    const splash = decodedRecordOrNull(expo['splash']);
    const androidSplash = readAdaptiveSplash(android);

    const splashIsBroken = splashScreenIsBroken(splash, androidSplash);

    if (splashIsBroken) {
      let splashKey = 'splash';

      if (androidSplash != null) {
        splashKey = 'android.splash';
      }

      findings.push({
        severity: 'error',
        file,
        key: splashKey,
        message: 'a splash screen is configured without a backgroundColor',
        fix: 'add a backgroundColor (e.g. "#ffffff") - without it the Android build fails with "resource color/splashscreen_background not found".',
      });
    }
  }

  const iconIsMissing = lacksAppIcon(expo, ios, android);

  if (iconIsMissing) {
    findings.push({
      severity: 'warn',
      file,
      key: 'icon',
      message: 'no app icon is set',
      fix: 'set `icon` (and `android.adaptiveIcon`) in the Expo config; the store rejects a release with no icon.',
    });
  }

  const schemeIsMissing = typeof expo['scheme'] != 'string';

  if (schemeIsMissing) {
    findings.push({
      severity: 'warn',
      file,
      key: 'scheme',
      message: 'no URL scheme is set',
      fix: 'add a `scheme` (e.g. your app slug) so deep links, the dev client, and OAuth redirects resolve.',
    });
  }

  const version = invalidMarketingVersion(expo);

  if (version != null) {
    findings.push({
      severity: 'warn',
      file,
      key: 'version',
      message: `version "${version}" is not a plain MAJOR.MINOR.PATCH string`,
      fix: 'use a numeric version like 1.2.3; the stores expect a numeric marketing version.',
    });
  }

  return findings;
}

function readAdaptiveSplash(
  android: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (android == null) {
    return null;
  }

  return decodedRecordOrNull(android['splash']);
}

export async function checkApp(app: AppDescriptor, platform: Platform): Promise<ConfigFinding[]> {
  const raw = await readAppConfig(app.dir);

  if (raw == null) {
    return [];
  }

  const fileName = basename(app.configPath);

  return checkAppConfig(raw, fileName, platform);
}

export function formatFinding(finding: ConfigFinding): string {
  return `${finding.file} - ${finding.key} - ${finding.message}. Fix: ${finding.fix}`;
}
