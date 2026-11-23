// Holds privacy findings and the privacy surface Launch compares for one app.

type PrivacySeverity = 'blocker' | 'warning' | 'info';

/** One reconciled finding, tagged with the app and platform it concerns. */
export type PrivacyFinding = Readonly<{
  app: string;
  platform: 'ios' | 'android';
  severity: PrivacySeverity;
  code: string;
  message: string;
}>;

/** The parsed privacy surface of one app - the pure input to {@link reconcilePrivacy}. */
export type PrivacySurface = Readonly<{
  usageDescriptions: Record<string, string>;
  hasManifest: boolean;
  collectedDataTypes: readonly string[];
  tracking: boolean;
  trackingDomains: readonly string[];
  androidPermissions: readonly string[];
}>;
