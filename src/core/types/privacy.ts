export type PrivacySeverity = 'blocker' | 'warning' | 'info';
/**
 * One reconciled finding, tagged with the app and platform it concerns. `code` is a stable,
 * machine-readable id (e.g. `ios.usage.empty`) so `--json` consumers can filter without parsing prose;
 * `message` is the human one-liner.
 */
export type PrivacyFinding = Readonly<{
  app: string;
  platform: 'ios' | 'android';
  severity: PrivacySeverity;
  code: string;
  message: string;
}>;
/**
 * The parsed privacy surface of one app - the pure input to {@link reconcilePrivacy}. Assembled by the
 * command from native files (`Info.plist`, `PrivacyInfo.xcprivacy`, `AndroidManifest.xml`) when a native
 * project exists, else from the resolved Expo config (`ios.infoPlist`, `ios.privacyManifests`,
 * `android.permissions`). Keeping it a plain data shape is what makes the reconcile testable without I/O.
 */
export type PrivacySurface = Readonly<{
  usageDescriptions: Record<string, string>;
  hasManifest: boolean;
  collectedDataTypes: readonly string[];
  tracking: boolean;
  trackingDomains: readonly string[];
  androidPermissions: readonly string[];
}>;
/**
 * The full result of a scan: every finding across the scanned apps plus the resolved process exit code
 * (0 clear - 2 blockers - 1 unreadable, per the shared readiness contract). This is the `--json` payload.
 */
export type PrivacyReport = Readonly<{
  findings: readonly PrivacyFinding[];
  scanned: readonly string[];
  exitCode: number;
}>;
