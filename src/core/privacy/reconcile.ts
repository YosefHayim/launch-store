/**
 * The reconcile: turn a parsed {@link PrivacySurface} into {@link PrivacyFinding}s, then roll those up
 * into a {@link PrivacyReport} with an exit code. This is the judgement layer — pure, so every rule is
 * unit-tested against a hand-built surface.
 *
 * What it checks (all statically, since the published declarations are UI-only — see `types.ts`):
 * empty purpose strings (auto-rejection), a permission you access but never declared collecting
 * (undeclared collection), a declared data type nothing backs (over-declaration), a missing privacy
 * manifest, tracking-flag self-contradictions, and — advisory only — the Play Data Safety categories an
 * Android permission implies (the form Launch can't read).
 */

import { READINESS_EXIT } from '../readiness/orchestrator.js';
import type { PrivacyFinding, PrivacyReport, PrivacySurface } from './types.js';

/**
 * iOS permission usage-description key → the privacy-manifest `NSPrivacyCollectedDataType` it implies.
 * Only the unambiguous mappings live here; keys without a clean data-type twin (calendars, motion, …)
 * are intentionally absent so they're never wrongly flagged as undeclared.
 */
const USAGE_TO_DATA_TYPE: Record<string, string> = {
  NSLocationWhenInUseUsageDescription: 'NSPrivacyCollectedDataTypePreciseLocation',
  NSLocationAlwaysAndWhenInUseUsageDescription: 'NSPrivacyCollectedDataTypePreciseLocation',
  NSLocationAlwaysUsageDescription: 'NSPrivacyCollectedDataTypePreciseLocation',
  NSContactsUsageDescription: 'NSPrivacyCollectedDataTypeContacts',
  NSCameraUsageDescription: 'NSPrivacyCollectedDataTypePhotosorVideos',
  NSPhotoLibraryUsageDescription: 'NSPrivacyCollectedDataTypePhotosorVideos',
  NSPhotoLibraryAddUsageDescription: 'NSPrivacyCollectedDataTypePhotosorVideos',
  NSMicrophoneUsageDescription: 'NSPrivacyCollectedDataTypeAudioData',
  NSHealthShareUsageDescription: 'NSPrivacyCollectedDataTypeHealth',
  NSHealthUpdateUsageDescription: 'NSPrivacyCollectedDataTypeHealth',
};

/** The data types the reconcile can reason about — only these are eligible for the over-declaration check. */
const RECONCILABLE_DATA_TYPES = new Set(Object.values(USAGE_TO_DATA_TYPE));

/** Android permission → the Play Data Safety category it implies, for the advisory reminders. */
const ANDROID_DATA_PERMISSIONS: Record<string, string> = {
  'android.permission.ACCESS_FINE_LOCATION': 'Location (precise)',
  'android.permission.ACCESS_COARSE_LOCATION': 'Location (approximate)',
  'android.permission.ACCESS_BACKGROUND_LOCATION': 'Location (background)',
  'android.permission.CAMERA': 'Photos and videos',
  'android.permission.RECORD_AUDIO': 'Audio',
  'android.permission.READ_CONTACTS': 'Contacts',
  'android.permission.WRITE_CONTACTS': 'Contacts',
  'android.permission.READ_CALENDAR': 'Calendar',
  'android.permission.READ_SMS': 'SMS',
  'android.permission.READ_PHONE_STATE': 'Phone',
  'android.permission.BODY_SENSORS': 'Health and fitness',
  'android.permission.READ_MEDIA_IMAGES': 'Photos and videos',
  'android.permission.READ_MEDIA_VIDEO': 'Photos and videos',
  'android.permission.READ_MEDIA_AUDIO': 'Music and audio',
};

/** Reconcile one app's surface into findings. Pure; the order is empty → manifest → collection → tracking → android. */
export function reconcilePrivacy(app: string, surface: PrivacySurface): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  const add = (
    platform: PrivacyFinding['platform'],
    severity: PrivacyFinding['severity'],
    code: string,
    message: string,
  ): void => {
    findings.push({ app, platform, severity, code, message });
  };

  const usageKeys = Object.keys(surface.usageDescriptions);

  // 1. Empty purpose strings — App Review auto-rejects a blank usage description.
  for (const [key, purpose] of Object.entries(surface.usageDescriptions)) {
    if (purpose.length === 0) {
      add(
        'ios',
        'blocker',
        'ios.usage.empty',
        `${key} has an empty purpose string — App Review rejects blank usage descriptions.`,
      );
    }
  }

  // 2. No privacy manifest at all, yet the app accesses sensitive resources.
  if (!surface.hasManifest && usageKeys.length > 0) {
    add(
      'ios',
      'warning',
      'ios.manifest.missing',
      `No iOS privacy manifest found, but ${usageKeys.length} permission(s) are declared — ship a PrivacyInfo.xcprivacy (or set ios.privacyManifests).`,
    );
  }

  // 3. Undeclared collection — accesses a resource but the manifest omits its data type.
  if (surface.hasManifest) {
    const declared = new Set(surface.collectedDataTypes);
    for (const [key, dataType] of Object.entries(USAGE_TO_DATA_TYPE)) {
      if (surface.usageDescriptions[key] !== undefined && !declared.has(dataType)) {
        add(
          'ios',
          'blocker',
          'ios.collection.undeclared',
          `${key} accesses data not declared as collected (${dataType}) in the privacy manifest.`,
        );
      }
    }
  }

  // 4. Over-declaration — the manifest claims a data type no permission/usage string backs.
  const backed = new Set(
    usageKeys.map((key) => USAGE_TO_DATA_TYPE[key]).filter((t): t is string => Boolean(t)),
  );
  for (const dataType of surface.collectedDataTypes) {
    if (RECONCILABLE_DATA_TYPES.has(dataType) && !backed.has(dataType)) {
      add(
        'ios',
        'warning',
        'ios.collection.overdeclared',
        `The privacy manifest declares collecting ${dataType}, but no permission backs it — confirm it's actually collected.`,
      );
    }
  }

  // 5. Tracking-flag consistency.
  if (
    surface.usageDescriptions['NSUserTrackingUsageDescription'] !== undefined &&
    surface.hasManifest &&
    !surface.tracking
  ) {
    add(
      'ios',
      'blocker',
      'ios.tracking.mismatch',
      'NSUserTrackingUsageDescription is present but the privacy manifest sets NSPrivacyTracking to false.',
    );
  }
  if (surface.tracking && surface.trackingDomains.length === 0) {
    add(
      'ios',
      'warning',
      'ios.tracking.nodomains',
      'NSPrivacyTracking is true but no NSPrivacyTrackingDomains are listed.',
    );
  }

  // 6. Android — advisory Data Safety reminders (the form is UI-only; Launch can't verify it).
  for (const permission of surface.androidPermissions) {
    const category = ANDROID_DATA_PERMISSIONS[permission];
    if (category) {
      add(
        'android',
        'info',
        'android.datasafety.reminder',
        `${permission} maps to Play Data Safety category "${category}" — confirm it's declared in the Data Safety form.`,
      );
    }
  }

  return findings;
}

/**
 * Roll findings across the scanned apps into a report. Exit code follows the shared readiness contract:
 * `error` (1) when nothing was scannable, `blocker` (2) when any blocker is present, else `ok` (0).
 * Warnings and advisories never fail the scan, so it's a safe pre-submit CI gate.
 */
export function buildPrivacyReport(findings: PrivacyFinding[], scanned: string[]): PrivacyReport {
  const exitCode =
    scanned.length === 0
      ? READINESS_EXIT.error
      : findings.some((finding) => finding.severity === 'blocker')
        ? READINESS_EXIT.blocker
        : READINESS_EXIT.ok;
  return { findings, scanned, exitCode };
}

/** The glyph shown for each severity in the rendered report. */
const SEVERITY_GLYPH: Record<PrivacyFinding['severity'], string> = {
  blocker: '✗',
  warning: '▲',
  info: 'ⓘ',
};

/** Render a report as human-readable lines: per-app findings, then a blocker/warning tally. */
export function renderPrivacyReport(report: PrivacyReport): string {
  if (report.scanned.length === 0) {
    return 'No apps to scan — none with a native project or Expo config were found.';
  }
  if (report.findings.length === 0) {
    return `Privacy surface clean across ${report.scanned.length} app(s) — no permission/declaration mismatches found.`;
  }

  const lines: string[] = [];
  for (const app of report.scanned) {
    const appFindings = report.findings.filter((finding) => finding.app === app);
    lines.push(app);
    if (appFindings.length === 0) {
      lines.push('  ✓ no issues');
      continue;
    }
    for (const finding of appFindings) {
      lines.push(`  ${SEVERITY_GLYPH[finding.severity]} [${finding.platform}] ${finding.message}`);
    }
  }

  const blockers = report.findings.filter((finding) => finding.severity === 'blocker').length;
  const warnings = report.findings.filter((finding) => finding.severity === 'warning').length;
  lines.push('', `${blockers} blocker(s), ${warnings} warning(s).`);
  return lines.join('\n');
}
