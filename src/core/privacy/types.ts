/**
 * Types for `launch privacy scan` — the local privacy-surface reconcile. These describe the *parsed
 * native/Expo surface* of one app and the *findings* a reconcile produces against it.
 *
 * Scope note (why local-only): App Store Connect exposes no API for the App Privacy "nutrition label"
 * and Launch has no Play Data Safety integration — both questionnaires are UI-only (see
 * `core/privacyNutritionLabel.ts`). So this command can't diff against the *published* declarations; it
 * reconciles what it *can* read statically: the permissions/usage strings the app requests, the iOS
 * privacy manifest it ships, and the Android permissions it declares. That catches the common, opaque
 * rejection causes (an empty purpose string, a permission you access but never declared collecting)
 * before submission, which is where the drift actually bites.
 */

/**
 * Severity of a privacy finding, ordered by how hard it bites:
 * - `blocker` — a near-certain rejection or a self-contradiction (empty purpose string, undeclared
 *   collection, tracking flag that disagrees with itself). Trips a non-zero exit.
 * - `warning` — a likely-but-not-fatal gap (over-declaration, a missing privacy manifest).
 * - `info` — an advisory the tool can't verify locally (the Play Data Safety reminders), shown but
 *   never failing the scan.
 */
export type PrivacySeverity = "blocker" | "warning" | "info";

/**
 * One reconciled finding, tagged with the app and platform it concerns. `code` is a stable,
 * machine-readable id (e.g. `ios.usage.empty`) so `--json` consumers can filter without parsing prose;
 * `message` is the human one-liner.
 */
export interface PrivacyFinding {
  /** App handle the finding belongs to. */
  app: string;
  /** Platform the finding concerns. */
  platform: "ios" | "android";
  /** How hard this bites — drives both the exit code and the rendered glyph. */
  severity: PrivacySeverity;
  /** Stable machine code, e.g. `ios.collection.undeclared`. */
  code: string;
  /** Human-readable one-line explanation, including the offending key/permission. */
  message: string;
}

/**
 * The parsed privacy surface of one app — the pure input to {@link reconcilePrivacy}. Assembled by the
 * command from native files (`Info.plist`, `PrivacyInfo.xcprivacy`, `AndroidManifest.xml`) when a native
 * project exists, else from the resolved Expo config (`ios.infoPlist`, `ios.privacyManifests`,
 * `android.permissions`). Keeping it a plain data shape is what makes the reconcile testable without I/O.
 */
export interface PrivacySurface {
  /** iOS `NS*UsageDescription` keys → their purpose strings. A present key with an empty value is a finding. */
  usageDescriptions: Record<string, string>;
  /** Whether the app ships an iOS privacy manifest at all (a native `.xcprivacy` or `ios.privacyManifests`). */
  hasManifest: boolean;
  /** `NSPrivacyCollectedDataType` ids declared in the privacy manifest. */
  collectedDataTypes: string[];
  /** The manifest's `NSPrivacyTracking` flag (false when absent). */
  tracking: boolean;
  /** The manifest's `NSPrivacyTrackingDomains`. */
  trackingDomains: string[];
  /** Android `uses-permission` names (e.g. `android.permission.CAMERA`). */
  androidPermissions: string[];
}

/**
 * The full result of a scan: every finding across the scanned apps plus the resolved process exit code
 * (0 clear · 2 blockers · 1 unreadable, per the shared readiness contract). This is the `--json` payload.
 */
export interface PrivacyReport {
  /** Every finding across all scanned apps, in scan order. */
  findings: PrivacyFinding[];
  /** Apps that were scanned, by handle — so an empty `findings` reads as "clear", not "nothing ran". */
  scanned: string[];
  /** Process exit code derived from the findings' severities. */
  exitCode: number;
}
