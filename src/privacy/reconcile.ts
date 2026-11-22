import { READINESS_EXIT } from '../readiness/orchestrator.ts';
import type { PrivacyFinding, PrivacySurface } from '../types/privacy.ts';
/**
 * The full result of a scan: every finding across the scanned apps plus the resolved process exit code
 * (0 clear - 2 blockers - 1 unreadable, per the shared readiness contract). This is the `--json` payload.
 */
type PrivacyReport = Readonly<{
  findings: readonly PrivacyFinding[];
  scanned: readonly string[];
  exitCode: number;
}>;

/**
 * iOS permission usage-description key -> the privacy-manifest `NSPrivacyCollectedDataType` it implies.
 * Only the unambiguous mappings live here; keys without a clean data-type twin (calendars, motion, ...)
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
/** The data types the reconcile can reason about - only these are eligible for the over-declaration check. */
const ownValues = Object.values(USAGE_TO_DATA_TYPE);
const reconcilableDataTypes = new Set(ownValues);
/** Reconcile one app's surface into findings. Pure; the order is empty -> manifest -> collection -> tracking -> android. */
export const reconcilePrivacy = (app: string, surface: PrivacySurface): PrivacyFinding[] => {
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
  // 1. Empty purpose strings - App Review auto-rejects a blank usage description.
  for (const [key, purpose] of Object.entries(surface.usageDescriptions)) {
    if (purpose.length == 0) {
      add(
        'ios',
        'blocker',
        'ios.usage.empty',
        `${key} has an empty purpose string - App Review rejects blank usage descriptions.`,
      );
    }
  }
  // 2. No privacy manifest at all, yet the app accesses sensitive resources.
  if (!surface.hasManifest && usageKeys.length > 0) {
    add(
      'ios',
      'warning',
      'ios.manifest.missing',
      `No iOS privacy manifest found, but ${usageKeys.length} permission(s) are declared - ship a PrivacyInfo.xcprivacy (or set ios.privacyManifests).`,
    );
  }
  // 3. Undeclared collection - accesses a resource but the manifest omits its data type.
  if (surface.hasManifest) {
    const declared = new Set(surface.collectedDataTypes);
    for (const [key, dataType] of Object.entries(USAGE_TO_DATA_TYPE)) {
      if (surface.usageDescriptions[key] != null && !declared.has(dataType)) {
        add(
          'ios',
          'blocker',
          'ios.collection.undeclared',
          `${key} accesses data not declared as collected (${dataType}) in the privacy manifest.`,
        );
      }
    }
  }
  // 4. Over-declaration - the manifest claims a data type no permission/usage string backs.
  const backed = new Set(
    usageKeys.map((key) => USAGE_TO_DATA_TYPE[key]).filter((t): t is string => Boolean(t)),
  );
  for (const dataType of surface.collectedDataTypes) {
    if (reconcilableDataTypes.has(dataType) && !backed.has(dataType)) {
      add(
        'ios',
        'warning',
        'ios.collection.overdeclared',
        `The privacy manifest declares collecting ${dataType}, but no permission backs it - confirm it's actually collected.`,
      );
    }
  }
  // 5. Tracking-flag consistency.
  if (
    surface.usageDescriptions['NSUserTrackingUsageDescription'] != null &&
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
  if (surface.tracking && surface.trackingDomains.length == 0) {
    add(
      'ios',
      'warning',
      'ios.tracking.nodomains',
      'NSPrivacyTracking is true but no NSPrivacyTrackingDomains are listed.',
    );
  }
  // 6. Android - advisory Data Safety reminders (the form is UI-only; Launch can't verify it).
  for (const permission of surface.androidPermissions) {
    const category = {
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
    }[permission];
    if (category) {
      add(
        'android',
        'info',
        'android.datasafety.reminder',
        `${permission} maps to Play Data Safety category "${category}" - confirm it's declared in the Data Safety form.`,
      );
    }
  }
  return findings;
};
/**
 * Roll findings across the scanned apps into a report. Exit code follows the shared readiness contract:
 * `error` (1) when nothing was scannable, `blocker` (2) when any blocker is present, else `ok` (0).
 * Warnings and advisories never fail the scan, so it's a safe pre-submit CI gate.
 */
export const buildPrivacyReport = (
  findings: PrivacyFinding[],
  scanned: readonly string[],
): PrivacyReport => {
  let exitCode: PrivacyReport['exitCode'] = READINESS_EXIT.ok;
  if (findings.some((finding) => finding.severity == 'blocker')) exitCode = READINESS_EXIT.blocker;
  if (scanned.length == 0) exitCode = READINESS_EXIT.error;
  return { findings, scanned, exitCode };
};
/** Render a report as human-readable lines: per-app findings, then a blocker/warning tally. */
export const renderPrivacyReport = (report: PrivacyReport): string => {
  if (report.scanned.length == 0) {
    return 'No apps to scan - none with a native project or Expo config were found.';
  }
  if (report.findings.length == 0) {
    return `Privacy surface clean across ${report.scanned.length} app(s) - no permission/declaration mismatches found.`;
  }
  const lines: string[] = [];
  for (const app of report.scanned) {
    const appFindings = report.findings.filter((finding) => finding.app == app);
    lines.push(app);
    if (appFindings.length == 0) {
      lines.push('  OK no issues');
      continue;
    }
    for (const finding of appFindings) {
      lines.push(
        `  ${
          {
            blocker: 'x',
            warning: '▲',
            info: 'ⓘ',
          }[finding.severity]
        } [${finding.platform}] ${finding.message}`,
      );
    }
  }
  const blockers = report.findings.filter((finding) => finding.severity == 'blocker').length;
  const warnings = report.findings.filter((finding) => finding.severity == 'warning').length;
  lines.push('', `${blockers} blocker(s), ${warnings} warning(s).`);
  return lines.join('\n');
};
