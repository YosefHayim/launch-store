import type { EncryptionDeclarationResource } from '@/types/apple-catalog.js';
/** The slice of {@link AppStoreConnectClient} that {@link reconcileExportCompliance} needs. */
export type ExportComplianceApi = {
  findBuild(
    bundleId: string,
    buildNumber: number,
  ): Promise<{
    id: string;
    usesNonExemptEncryption: boolean | null;
  } | null>;
  setBuildUsesNonExemptEncryption(buildId: string, encryptionUsage: boolean): Promise<void>;
  listEncryptionDeclarations(bundleId: string): Promise<EncryptionDeclarationResource[]>;
  linkBuildToDeclaration(declarationId: string, buildId: string): Promise<void>;
};
/** One app's export-compliance reconcile inputs. */
type ExportComplianceInput = {
  bundleId: string;
  buildNumber: number;
  usesNonExemptEncryption: boolean | undefined;
};
/** Outcome of {@link reconcileExportCompliance} */
export type ExportComplianceResult =
  | {
      status: 'undeclared';
    }
  | {
      status: 'build-not-found';
      buildNumber: number;
    }
  | {
      status: 'already-answered';
      usesNonExemptEncryption: boolean;
    }
  | {
      status: 'answered';
      usesNonExemptEncryption: boolean;
    }
  | {
      status: 'reused-declaration';
      declarationId: string;
    }
  | {
      status: 'needs-declaration';
    };

/** Export-compliance reconciliation failed. */
type ExportComplianceFailure = Readonly<{
  readonly _tag: 'ExportComplianceFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeExportComplianceFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): ExportComplianceFailure {
  return { _tag: 'ExportComplianceFailure', ...fields };
}

function readErrorText(cause: unknown, fallback: string): string {
  const isNotError = !(cause instanceof Error);

  if (isNotError) return fallback;

  const isEmpty = cause.message.length == 0;

  if (isEmpty) return fallback;

  return cause.message;
}

function exportComplianceFailure(operation: string, cause: unknown): ExportComplianceFailure {
  const message = readErrorText(cause, `${operation} failed.`);
  return makeExportComplianceFailure({ operation, message, cause });
}

function exportComplianceOutcome(
  complianceOutcome: ExportComplianceResult,
): ExportComplianceResult {
  return complianceOutcome;
}

function isApprovedDeclaration(encryptionDeclaration: EncryptionDeclarationResource): boolean {
  return encryptionDeclaration.state == 'APPROVED';
}

/** Ensure an uploaded build carries the export-compliance answer from the app's Expo config */
export async function reconcileExportCompliance(
  exportComplianceApi: ExportComplianceApi,
  reconciliationInput: ExportComplianceInput,
): Promise<ExportComplianceResult> {
  try {
    const { bundleId, buildNumber, usesNonExemptEncryption } = reconciliationInput;

    const isAnswerMissing = usesNonExemptEncryption == null;

    if (isAnswerMissing) {
      return exportComplianceOutcome({ status: 'undeclared' });
    }

    const storeBuild = await exportComplianceApi.findBuild(bundleId, buildNumber);

    const isBuildMissing = storeBuild == null;

    if (isBuildMissing) {
      return exportComplianceOutcome({ status: 'build-not-found', buildNumber });
    }

    const isAlreadyAnswered = storeBuild.usesNonExemptEncryption == usesNonExemptEncryption;

    if (isAlreadyAnswered) {
      return exportComplianceOutcome({ status: 'already-answered', usesNonExemptEncryption });
    }

    const isExemptEncryption = usesNonExemptEncryption == false;

    if (isExemptEncryption) {
      await exportComplianceApi.setBuildUsesNonExemptEncryption(storeBuild.id, false);
      return exportComplianceOutcome({ status: 'answered', usesNonExemptEncryption: false });
    }

    const encryptionDeclarations = await exportComplianceApi.listEncryptionDeclarations(bundleId);
    /** Apple marks an App Encryption Declaration reusable only once it reaches this review state. */
    const approvedDeclaration = encryptionDeclarations.find(isApprovedDeclaration);

    const hasApprovedDeclaration = approvedDeclaration != null;

    if (hasApprovedDeclaration) {
      await exportComplianceApi.linkBuildToDeclaration(approvedDeclaration.id, storeBuild.id);

      return exportComplianceOutcome({
        status: 'reused-declaration',
        declarationId: approvedDeclaration.id,
      });
    }

    await exportComplianceApi.setBuildUsesNonExemptEncryption(storeBuild.id, true);

    return exportComplianceOutcome({ status: 'needs-declaration' });
  } catch (cause) {
    throw exportComplianceFailure('reconcile App Store export compliance', cause);
  }
}
/** A doctor/preflight verdict derived from the app's Expo config alone - no network. */
type ExportComplianceConfigStatus = {
  ok: boolean;
  message: string;
};
/** Describe export-compliance posture from `ios.config.usesNonExemptEncryption` alone */
export function describeExportComplianceConfig(
  usesNonExemptEncryption: boolean | undefined,
): ExportComplianceConfigStatus {
  switch (usesNonExemptEncryption) {
    case false:
      return {
        ok: true,
        message:
          'export compliance answered (`ios.config.usesNonExemptEncryption: false`) - no per-upload prompt',
      };
    case true:
      return {
        ok: false,
        message:
          'declares non-exempt encryption - a one-time App Encryption Declaration (with documentation) is required in App Store Connect',
      };
    default:
      return {
        ok: false,
        message:
          'export compliance not declared - set `ios.config.usesNonExemptEncryption` in app.json so the encryption question is answered once, not on every upload',
      };
  }
}
/** Render a {@link reconcileExportCompliance} outcome as one human line for `launch-store doctor --fix`. */
export function summarizeExportComplianceResult(complianceOutcome: ExportComplianceResult): string {
  switch (complianceOutcome.status) {
    case 'undeclared':
      return 'no `ios.config.usesNonExemptEncryption` in app.json - left as-is';
    case 'build-not-found':
      return `no uploaded build ${complianceOutcome.buildNumber} on App Store Connect yet (still processing?) - try again shortly`;
    case 'already-answered':
      return `already answered (usesNonExemptEncryption: ${complianceOutcome.usesNonExemptEncryption})`;
    case 'answered':
      return `answered the encryption question on the build (usesNonExemptEncryption: ${complianceOutcome.usesNonExemptEncryption})`;
    case 'reused-declaration':
      return `reused approved App Encryption Declaration ${complianceOutcome.declarationId}`;
    case 'needs-declaration':
      return 'no approved declaration to reuse - submit a one-time documented App Encryption Declaration in App Store Connect';
  }
}
