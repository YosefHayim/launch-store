import { Path } from '@effect/platform';
import { Effect, Option, Schema } from 'effect';
import { isApplePlatform } from '../services/platform.js';
import type { AppDescriptor, Platform } from '../types/app.js';
import { readResolvedConfig } from './config.js';
/**
 * How seriously to treat a finding.
 * - `error`: build-breaking - the native build will fail on it, so `launch build` hard-stops here.
 * - `warn`: not build-breaking but store-rejecting or surprising (missing icon, no scheme) - surfaced
 *   and left to the developer.
 */
export type FindingSeverity = 'error' | 'warn';
/**
 * One preflight finding about an app's config. Carries everything needed to print "the exact file +
 * key + fix": `file`/`key` locate it, `message` says what's wrong, and `fix` is the concrete remedy
 * in the `--explain` teaching voice.
 */
export type ConfigFinding = {
  severity: FindingSeverity;
  file: string;
  key: string;
  message: string;
  fix: string;
};
const UnknownRecordSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const decodeUnknownRecord = Schema.decodeUnknownOption(UnknownRecordSchema);
const decodedRecordOrNull = (candidateValue: unknown): Record<string, unknown> | null => {
  return Option.getOrNull(decodeUnknownRecord(candidateValue));
};
/**
 * A valid iOS bundle identifier: reverse-DNS, letters/digits/hyphens only per segment, at least two
 * segments. The build-breakers this rejects are the common ones - an underscore or a space, which
 * Xcode/Apple flat-out refuse - so an invalid match is a real `error`, not a style nit.
 */
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
/**
 * A valid Android application id (a Java package): at least two dot-separated segments, each starting
 * with a letter, then letters/digits/underscores. Hyphens and digit-led segments are rejected because
 * Gradle/AAPT reject them, so an invalid match is build-breaking.
 */
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
/** A plausible marketing version: 1-3 dot-separated numbers (`1`, `1.2`, `1.2.3`). */
const MARKETING_VERSION = /^\d+(\.\d+){0,2}$/;
/** True when a splash block is configured (a non-empty object) but carries no `backgroundColor`. */
const splashLacksBackground = (splash: Record<string, unknown> | null): boolean => {
  return (
    splash !== null &&
    Object.keys(splash).length > 0 &&
    typeof splash['backgroundColor'] !== 'string'
  );
};
/**
 * Check one app's resolved Expo config for known footguns, scoped to the platform being built. Pure -
 * the result depends only on `raw` and `platform`. Tolerates the `{ expo: {...} }` wrapper or a flat
 * shape, and a config missing any given field (a missing field is simply not flagged here, except
 * where its absence is itself the footgun - a missing app icon or URL scheme).
 */
export const checkAppConfig = (
  raw: Record<string, unknown>,
  file: string,
  platform: Platform,
): ConfigFinding[] => {
  let expo = decodedRecordOrNull(raw['expo']);
  if (expo === null) expo = raw;
  const ios = decodedRecordOrNull(expo['ios']);
  const android = decodedRecordOrNull(expo['android']);
  const findings: ConfigFinding[] = [];
  if (isApplePlatform(platform)) {
    const bundleId = ios?.['bundleIdentifier'];
    if (typeof bundleId === 'string' && !BUNDLE_ID.test(bundleId)) {
      findings.push({
        severity: 'error',
        file,
        key: 'ios.bundleIdentifier',
        message: `"${bundleId}" is not a valid bundle id`,
        fix: 'use reverse-DNS with letters, digits, hyphens, and dots only (e.g. com.acme.app); underscores and spaces are rejected by Xcode.',
      });
    }
  }
  if (platform === 'android') {
    const pkg = android?.['package'];
    if (typeof pkg === 'string' && !ANDROID_PACKAGE.test(pkg)) {
      findings.push({
        severity: 'error',
        file,
        key: 'android.package',
        message: `"${pkg}" is not a valid Android application id`,
        fix: 'use a Java package: two+ dot-separated segments, each starting with a letter (e.g. com.acme.app); hyphens and digit-led segments break Gradle.',
      });
    }
    // The canonical AAPT failure: a splash with no backgroundColor -> "resource color/splashscreen_background".
    const splash = decodedRecordOrNull(expo['splash']);
    const androidSplash = decodedRecordOrNull(android?.['splash']);
    let effectiveBackground = typeof androidSplash?.['backgroundColor'] === 'string';
    if (!effectiveBackground) effectiveBackground = typeof splash?.['backgroundColor'] === 'string';
    let splashMissingBackground = splashLacksBackground(splash);
    if (!splashMissingBackground) splashMissingBackground = splashLacksBackground(androidSplash);
    if (!effectiveBackground && splashMissingBackground) {
      let splashKey = 'splash';
      if (androidSplash) splashKey = 'android.splash';
      findings.push({
        severity: 'error',
        file,
        key: splashKey,
        message: 'a splash screen is configured without a backgroundColor',
        fix: 'add a backgroundColor (e.g. "#ffffff") - without it the Android build fails with "resource color/splashscreen_background not found".',
      });
    }
  }
  if (
    typeof expo['icon'] !== 'string' &&
    typeof ios?.['icon'] !== 'string' &&
    decodedRecordOrNull(android?.['adaptiveIcon']) === null
  ) {
    findings.push({
      severity: 'warn',
      file,
      key: 'icon',
      message: 'no app icon is set',
      fix: 'set `icon` (and `android.adaptiveIcon`) in the Expo config; the store rejects a release with no icon.',
    });
  }
  if (typeof expo['scheme'] !== 'string') {
    findings.push({
      severity: 'warn',
      file,
      key: 'scheme',
      message: 'no URL scheme is set',
      fix: 'add a `scheme` (e.g. your app slug) so deep links, the dev client, and OAuth redirects resolve.',
    });
  }
  const version = expo['version'];
  if (typeof version === 'string' && !MARKETING_VERSION.test(version)) {
    findings.push({
      severity: 'warn',
      file,
      key: 'version',
      message: `version "${version}" is not a plain MAJOR.MINOR.PATCH string`,
      fix: 'use a numeric version like 1.2.3; the stores expect a numeric marketing version.',
    });
  }
  return findings;
};
/**
 * Read an app's resolved Expo config off disk and run {@link checkAppConfig} for the platform. Returns
 * an empty list when the config can't be read (a missing/broken config isn't this check's job - the
 * build's own app-selection surfaces that). The single I/O entry point the build guard and the
 * `doctor` tier share.
 */
export const checkApp = (app: AppDescriptor, platform: Platform) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const raw = yield* readResolvedConfig(app.dir);
    if (!raw) return [];
    return checkAppConfig(raw, pathService.basename(app.configPath), platform);
  });
/** Render a finding as one line: `app.json - key - message Fix: ...`. The caller prepends the x/- marker. */
export const formatFinding = (finding: ConfigFinding): string => {
  return `${finding.file} - ${finding.key} - ${finding.message}. Fix: ${finding.fix}`;
};
