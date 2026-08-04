import { Data, Effect } from 'effect';
import type { EncryptionDeclarationResource } from '../types/appleCatalog.js';
/** Apple marks an App Encryption Declaration reusable only once it reaches this review state. */
const APPROVED_STATE = 'APPROVED';
/**
 * The slice of {@link AppStoreConnectClient} that {@link reconcileExportCompliance} needs. Declared as a
 * seam (not the whole client) so the reconcile is testable with a fake and the core layer stays
 * decoupled from the live HTTP client - mirrors {@link AscCatalogApi} in `ascSync.ts`.
 */
export type ExportComplianceApi = {
  findBuild(
    bundleId: string,
    buildNumber: number,
  ): Effect.Effect<
    {
      id: string;
      usesNonExemptEncryption: boolean | null;
    } | null,
    unknown
  >;
  setBuildUsesNonExemptEncryption(
    buildId: string,
    encryptionUsage: boolean,
  ): Effect.Effect<void, unknown>;
  listEncryptionDeclarations(
    bundleId: string,
  ): Effect.Effect<EncryptionDeclarationResource[], unknown>;
  linkBuildToDeclaration(declarationId: string, buildId: string): Effect.Effect<void, unknown>;
};
/** One app's export-compliance reconcile inputs. */
export type ExportComplianceInput = {
  bundleId: string;
  buildNumber: number;
  usesNonExemptEncryption: boolean | undefined;
};
/**
 * Outcome of {@link reconcileExportCompliance}, as a discriminated union so the caller renders an exact
 * line and the tests assert on `status` without string matching:
 * - `undeclared` - `app.json` answers nothing; the upload will be prompted (nothing was changed).
 * - `build-not-found` - no build with that number on App Store Connect yet (still ingesting after upload).
 * - `already-answered` - the build already carries the desired answer (e.g. from the `Info.plist` key).
 * - `answered` - the no/exempt-encryption answer was written to the build's `usesNonExemptEncryption`.
 * - `reused-declaration` - an existing approved declaration was reused for a non-exempt-encryption build.
 * - `needs-declaration` - non-exempt encryption with no approved declaration to reuse; a one-time
 *   documented declaration is still owed in App Store Connect (the build was flagged accordingly).
 */
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
export type ExportComplianceFailure = Readonly<{
  readonly _tag: 'ExportComplianceFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeExportComplianceFailure =
  Data.tagged<ExportComplianceFailure>('ExportComplianceFailure');

const exportComplianceFailure = (operation: string, cause: unknown): ExportComplianceFailure => {
  let message = `${operation} failed.`;
  if (cause instanceof Error && cause.message.length > 0) message = cause.message;
  return makeExportComplianceFailure({ operation, message, cause });
};

const exportComplianceOutcome = (
  complianceOutcome: ExportComplianceResult,
): ExportComplianceResult => complianceOutcome;
/**
 * Ensure an uploaded build carries the export-compliance answer from the app's Expo config, reusing an
 * approved declaration when one applies. Idempotent: a build that already has the desired answer is left
 * untouched (`already-answered`). See the module doc for the layering with the `Info.plist` path.
 */
export const reconcileExportCompliance = (
  exportComplianceApi: ExportComplianceApi,
  reconciliationInput: ExportComplianceInput,
): Effect.Effect<ExportComplianceResult, ExportComplianceFailure> =>
  Effect.gen(function* () {
    const { bundleId, buildNumber, usesNonExemptEncryption } = reconciliationInput;
    if (usesNonExemptEncryption === undefined) {
      return exportComplianceOutcome({ status: 'undeclared' });
    }
    const storeBuild = yield* exportComplianceApi.findBuild(bundleId, buildNumber);
    if (storeBuild === null) {
      return exportComplianceOutcome({ status: 'build-not-found', buildNumber });
    }
    if (storeBuild.usesNonExemptEncryption === usesNonExemptEncryption) {
      return exportComplianceOutcome({ status: 'already-answered', usesNonExemptEncryption });
    }
    if (!usesNonExemptEncryption) {
      yield* exportComplianceApi.setBuildUsesNonExemptEncryption(storeBuild.id, false);
      return exportComplianceOutcome({ status: 'answered', usesNonExemptEncryption: false });
    }
    const encryptionDeclarations = yield* exportComplianceApi.listEncryptionDeclarations(bundleId);
    const approvedDeclaration = encryptionDeclarations.find(
      (encryptionDeclaration) => encryptionDeclaration.state === APPROVED_STATE,
    );
    if (approvedDeclaration !== undefined) {
      yield* exportComplianceApi.linkBuildToDeclaration(approvedDeclaration.id, storeBuild.id);
      return exportComplianceOutcome({
        status: 'reused-declaration',
        declarationId: approvedDeclaration.id,
      });
    }
    yield* exportComplianceApi.setBuildUsesNonExemptEncryption(storeBuild.id, true);
    return exportComplianceOutcome({ status: 'needs-declaration' });
  }).pipe(
    Effect.mapError((cause) =>
      exportComplianceFailure('reconcile App Store export compliance', cause),
    ),
  );
/** A doctor/preflight verdict derived from the app's Expo config alone - no network. */
export type ExportComplianceConfigStatus = {
  ok: boolean;
  message: string;
};
/**
 * Describe export-compliance posture from `ios.config.usesNonExemptEncryption` alone, the network-free
 * check `launch doctor` shows per iOS app. Only the explicit `false` answer is "clean" (the binary
 * self-answers); `true` is declared-but-owes-a-declaration, and `undefined` means every upload re-prompts.
 */
export const describeExportComplianceConfig = (
  usesNonExemptEncryption: boolean | undefined,
): ExportComplianceConfigStatus => {
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
};
/** Render a {@link reconcileExportCompliance} outcome as one human line for `launch doctor --fix`. */
export const summarizeExportComplianceResult = (
  complianceOutcome: ExportComplianceResult,
): string => {
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
};
