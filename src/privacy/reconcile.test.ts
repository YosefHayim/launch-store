import { describe, expect, it } from 'vitest';
import { buildPrivacyReport, reconcilePrivacy, renderPrivacyReport } from './reconcile.ts';
import type { PrivacySurface } from '../types/privacy.ts';

/** A clean baseline surface; tests override only the fields they exercise. */
function surface(overrides: Partial<PrivacySurface> = {}): PrivacySurface {
  return {
    usageDescriptions: {},
    hasManifest: true,
    collectedDataTypes: [],
    tracking: false,
    trackingDomains: [],
    androidPermissions: [],
    ...overrides,
  };
}

function readCode(finding: {
  readonly app: string;
  readonly platform: 'ios' | 'android';
  readonly severity: 'info' | 'blocker' | 'warning';
  readonly code: string;
  readonly message: string;
}) {
  return finding.code;
}

function codes(findings: ReturnType<typeof reconcilePrivacy>): string[] {
  return findings.map(readCode);
}

function describeReconcilePrivacy() {
  function flagsAnEmptyPurposeStringAsABlocker() {
    const findings = reconcilePrivacy(
      'app',
      surface({ usageDescriptions: { NSCameraUsageDescription: '' } }),
    );

    function isEmptyUsageFinding(finding: {
      readonly app: string;
      readonly platform: 'ios' | 'android';
      readonly severity: 'info' | 'blocker' | 'warning';
      readonly code: string;
      readonly message: string;
    }) {
      return finding.code == 'ios.usage.empty';
    }

    const empty = findings.find(isEmptyUsageFinding);

    expect(empty?.severity).toBe('blocker');
  }

  it('flags an empty purpose string as a blocker', flagsAnEmptyPurposeStringAsABlocker);

  function flagsUndeclaredCollectionWhenAPermissionSPieceTypeIsnTInTheManifest() {
    const findings = reconcilePrivacy(
      'app',
      surface({ usageDescriptions: { NSCameraUsageDescription: 'Scan' }, collectedDataTypes: [] }),
    );

    function isUndeclaredCollectionFinding(finding: {
      readonly app: string;
      readonly platform: 'ios' | 'android';
      readonly severity: 'info' | 'blocker' | 'warning';
      readonly code: string;
      readonly message: string;
    }) {
      return finding.code == 'ios.collection.undeclared';
    }

    const undeclared = findings.find(isUndeclaredCollectionFinding);

    expect(undeclared?.severity).toBe('blocker');
    expect(undeclared?.message).toContain('NSPrivacyCollectedDataTypePhotosorVideos');
  }

  it(
    "flags undeclared collection when a permission's data type isn't in the manifest",
    flagsUndeclaredCollectionWhenAPermissionSPieceTypeIsnTInTheManifest,
  );

  function doesNotFlagUndeclaredCollectionWhenThePieceTypeIsDeclared() {
    const findings = reconcilePrivacy(
      'app',
      surface({
        usageDescriptions: { NSCameraUsageDescription: 'Scan' },
        collectedDataTypes: ['NSPrivacyCollectedDataTypePhotosorVideos'],
      }),
    );

    expect(codes(findings)).not.toContain('ios.collection.undeclared');
  }

  it(
    'does not flag undeclared collection when the data type is declared',
    doesNotFlagUndeclaredCollectionWhenThePieceTypeIsDeclared,
  );

  function warnsOnOverDeclarationOfAReconcilablePieceTypeWithNoBackingPermission() {
    const findings = reconcilePrivacy(
      'app',
      surface({ collectedDataTypes: ['NSPrivacyCollectedDataTypeContacts'] }),
    );

    function isOverdeclaredCollectionFinding(finding: {
      readonly app: string;
      readonly platform: 'ios' | 'android';
      readonly severity: 'info' | 'blocker' | 'warning';
      readonly code: string;
      readonly message: string;
    }) {
      return finding.code == 'ios.collection.overdeclared';
    }

    const over = findings.find(isOverdeclaredCollectionFinding);

    expect(over?.severity).toBe('warning');
  }

  it(
    'warns on over-declaration of a reconcilable data type with no backing permission',
    warnsOnOverDeclarationOfAReconcilablePieceTypeWithNoBackingPermission,
  );

  function ignoresNonReconcilableDeclaredPieceTypesEGNameInTheOverDeclarationCheck() {
    const findings = reconcilePrivacy(
      'app',
      surface({ collectedDataTypes: ['NSPrivacyCollectedDataTypeName'] }),
    );

    expect(codes(findings)).not.toContain('ios.collection.overdeclared');
  }

  it(
    'ignores non-reconcilable declared data types (e.g. Name) in the over-declaration check',
    ignoresNonReconcilableDeclaredPieceTypesEGNameInTheOverDeclarationCheck,
  );

  function warnsWhenUsageDescriptionsExistButNoManifestIsPresent() {
    const findings = reconcilePrivacy(
      'app',
      surface({ hasManifest: false, usageDescriptions: { NSCameraUsageDescription: 'Scan' } }),
    );

    expect(codes(findings)).toContain('ios.manifest.missing');
    // With no manifest, undeclared-collection is not asserted.
    expect(codes(findings)).not.toContain('ios.collection.undeclared');
  }

  it(
    'warns when usage descriptions exist but no manifest is present',
    warnsWhenUsageDescriptionsExistButNoManifestIsPresent,
  );

  function flagsATrackingFlagMismatchAsABlocker() {
    const findings = reconcilePrivacy(
      'app',
      surface({ usageDescriptions: { NSUserTrackingUsageDescription: 'Ads' }, tracking: false }),
    );

    function isTrackingFlagConflict(finding: {
      readonly app: string;
      readonly platform: 'ios' | 'android';
      readonly severity: 'info' | 'blocker' | 'warning';
      readonly code: string;
      readonly message: string;
    }) {
      return finding.code == 'ios.tracking.mismatch';
    }

    expect(findings.find(isTrackingFlagConflict)?.severity).toBe('blocker');
  }

  it('flags a tracking-flag mismatch as a blocker', flagsATrackingFlagMismatchAsABlocker);

  function emitsAdvisoryPieceSafetyRemindersForAndroidPiecePermissions() {
    const findings = reconcilePrivacy(
      'app',
      surface({ androidPermissions: ['android.permission.CAMERA'] }),
    );

    function isAndroidSafetyReminder(finding: {
      readonly app: string;
      readonly platform: 'ios' | 'android';
      readonly severity: 'info' | 'blocker' | 'warning';
      readonly code: string;
      readonly message: string;
    }) {
      return finding.code == 'android.datasafety.reminder';
    }

    const reminder = findings.find(isAndroidSafetyReminder);

    expect(reminder?.severity).toBe('info');
    expect(reminder?.platform).toBe('android');
  }

  it(
    'emits advisory Data Safety reminders for android data permissions',
    emitsAdvisoryPieceSafetyRemindersForAndroidPiecePermissions,
  );

  function producesNoFindingsForACleanSurface() {
    expect(reconcilePrivacy('app', surface())).toEqual([]);
  }

  it('produces no findings for a clean surface', producesNoFindingsForACleanSurface);
}

describe('reconcilePrivacy', describeReconcilePrivacy);

function describeBuildPrivacyReport() {
  function exits2WhenAnyBlockerIsPresent() {
    const findings = reconcilePrivacy(
      'app',
      surface({ usageDescriptions: { NSCameraUsageDescription: '' } }),
    );
    const privacyReport = buildPrivacyReport(findings, ['app']);

    expect(privacyReport.exitCode).toBe(2);
  }

  it('exits 2 when any blocker is present', exits2WhenAnyBlockerIsPresent);

  function exits0WhenOnlyWarningsPieceArePresent() {
    const findings = reconcilePrivacy(
      'app',
      surface({ androidPermissions: ['android.permission.CAMERA'] }),
    );
    const privacyReport = buildPrivacyReport(findings, ['app']);

    expect(privacyReport.exitCode).toBe(0);
  }

  it('exits 0 when only warnings/info are present', exits0WhenOnlyWarningsPieceArePresent);

  function exits1WhenNothingWasScanned() {
    const privacyReport = buildPrivacyReport([], []);
    expect(privacyReport.exitCode).toBe(1);
  }

  it('exits 1 when nothing was scanned', exits1WhenNothingWasScanned);
}

describe('buildPrivacyReport', describeBuildPrivacyReport);

function describeRenderPrivacyReport() {
  function reportsACleanSurface() {
    const privacyReport = buildPrivacyReport([], ['app']);
    expect(renderPrivacyReport(privacyReport)).toContain('clean');
  }

  it('reports a clean surface', reportsACleanSurface);

  function listsFindingsPerAppWithATally() {
    // A tracking mismatch is exactly one blocker, with no incidental findings.
    const findings = reconcilePrivacy(
      'app',
      surface({ usageDescriptions: { NSUserTrackingUsageDescription: 'Ads' }, tracking: false }),
    );
    const privacyReport = buildPrivacyReport(findings, ['app']);
    const rendered = renderPrivacyReport(privacyReport);

    expect(rendered).toContain('app');
    expect(rendered).toContain('1 blocker(s)');
  }

  it('lists findings per app with a tally', listsFindingsPerAppWithATally);
}

describe('renderPrivacyReport', describeRenderPrivacyReport);
