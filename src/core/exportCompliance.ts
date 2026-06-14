/**
 * Export-compliance reconciliation — answering App Store Connect's "does your app use encryption?"
 * question once, from the app's own Expo config, instead of re-clicking it on every upload.
 *
 * Background: App Store Connect re-asks the export-compliance question for every uploaded build unless
 * the build already carries an answer. Expo apps answer it declaratively with
 * `ios.config.usesNonExemptEncryption` in `app.json`, which Launch reads into
 * {@link AppDescriptor.usesNonExemptEncryption} and which becomes `ITSAppUsesNonExemptEncryption` in the
 * built `Info.plist` — so a correctly-configured binary self-answers and is never prompted. That is the
 * primary, network-free path (surfaced by `launch doctor` via {@link describeExportComplianceConfig}).
 *
 * This module is the App Store Connect safety net for builds already uploaded *without* that key:
 * {@link reconcileExportCompliance} sets the answer on the build, or — for genuine non-exempt encryption —
 * reuses an existing **approved** App Encryption Declaration rather than forcing a fresh, document-backed
 * submission per build. It never auto-creates a declaration: Apple requires a cryptography description
 * and often a CCATS document that can't be synthesized, so an unmet case is reported, not faked.
 *
 * The logic is pure over the {@link ExportComplianceApi} seam (a structural subset of
 * {@link AppStoreConnectClient}), so it is unit-tested with a fake — no live Apple account required.
 */

import type { EncryptionDeclarationResource } from "../apple/ascClient.js";

/** Apple marks an App Encryption Declaration reusable only once it reaches this review state. */
const APPROVED_STATE = "APPROVED";

/**
 * The slice of {@link AppStoreConnectClient} that {@link reconcileExportCompliance} needs. Declared as a
 * seam (not the whole client) so the reconcile is testable with a fake and the core layer stays
 * decoupled from the live HTTP client — mirrors {@link AscCatalogApi} in `ascSync.ts`.
 */
export interface ExportComplianceApi {
  findBuild(
    bundleId: string,
    buildNumber: number,
  ): Promise<{ id: string; usesNonExemptEncryption: boolean | null } | null>;
  setBuildUsesNonExemptEncryption(buildId: string, value: boolean): Promise<void>;
  listEncryptionDeclarations(bundleId: string): Promise<EncryptionDeclarationResource[]>;
  linkBuildToDeclaration(declarationId: string, buildId: string): Promise<void>;
}

/** One app's export-compliance reconcile inputs. */
export interface ExportComplianceInput {
  /** iOS bundle identifier whose uploaded build is being answered. */
  bundleId: string;
  /** The uploaded build's number (e.g. from `getLatestBuildNumber`). */
  buildNumber: number;
  /** The app's `ios.config.usesNonExemptEncryption` answer; `undefined` when `app.json` leaves it unset. */
  usesNonExemptEncryption: boolean | undefined;
}

/**
 * Outcome of {@link reconcileExportCompliance}, as a discriminated union so the caller renders an exact
 * line and the tests assert on `status` without string matching:
 * - `undeclared` — `app.json` answers nothing; the upload will be prompted (nothing was changed).
 * - `build-not-found` — no build with that number on App Store Connect yet (still ingesting after upload).
 * - `already-answered` — the build already carries the desired answer (e.g. from the `Info.plist` key).
 * - `answered` — the no/exempt-encryption answer was written to the build's `usesNonExemptEncryption`.
 * - `reused-declaration` — an existing approved declaration was reused for a non-exempt-encryption build.
 * - `needs-declaration` — non-exempt encryption with no approved declaration to reuse; a one-time
 *   documented declaration is still owed in App Store Connect (the build was flagged accordingly).
 */
export type ExportComplianceResult =
  | { status: "undeclared" }
  | { status: "build-not-found"; buildNumber: number }
  | { status: "already-answered"; usesNonExemptEncryption: boolean }
  | { status: "answered"; usesNonExemptEncryption: boolean }
  | { status: "reused-declaration"; declarationId: string }
  | { status: "needs-declaration" };

/**
 * Ensure an uploaded build carries the export-compliance answer from the app's Expo config, reusing an
 * approved declaration when one applies. Idempotent: a build that already has the desired answer is left
 * untouched (`already-answered`). See the module doc for the layering with the `Info.plist` path.
 */
export async function reconcileExportCompliance(
  api: ExportComplianceApi,
  input: ExportComplianceInput,
): Promise<ExportComplianceResult> {
  const { bundleId, buildNumber, usesNonExemptEncryption } = input;
  if (usesNonExemptEncryption === undefined) return { status: "undeclared" };

  const build = await api.findBuild(bundleId, buildNumber);
  if (!build) return { status: "build-not-found", buildNumber };
  if (build.usesNonExemptEncryption === usesNonExemptEncryption) {
    return { status: "already-answered", usesNonExemptEncryption };
  }

  // No / only-exempt encryption: one attribute write clears the prompt — no declaration involved.
  if (!usesNonExemptEncryption) {
    await api.setBuildUsesNonExemptEncryption(build.id, false);
    return { status: "answered", usesNonExemptEncryption: false };
  }

  // Non-exempt encryption: reuse an approved declaration if one exists (never auto-create one).
  const approved = (await api.listEncryptionDeclarations(bundleId)).find((d) => d.state === APPROVED_STATE);
  if (approved) {
    await api.linkBuildToDeclaration(approved.id, build.id);
    return { status: "reused-declaration", declarationId: approved.id };
  }

  // Flag the build as using non-exempt encryption so its state is explicit; the user still owes a
  // one-time documented declaration before the build can be submitted for review.
  await api.setBuildUsesNonExemptEncryption(build.id, true);
  return { status: "needs-declaration" };
}

/** A doctor/preflight verdict derived from the app's Expo config alone — no network. */
export interface ExportComplianceConfigStatus {
  /** True when nothing needs attention (the clean, self-answering `false` case). */
  ok: boolean;
  /** One-line explanation for `launch doctor` (prefixed with ✓ when `ok`, • otherwise). */
  message: string;
}

/**
 * Describe export-compliance posture from `ios.config.usesNonExemptEncryption` alone, the network-free
 * check `launch doctor` shows per iOS app. Only the explicit `false` answer is "clean" (the binary
 * self-answers); `true` is declared-but-owes-a-declaration, and `undefined` means every upload re-prompts.
 */
export function describeExportComplianceConfig(
  usesNonExemptEncryption: boolean | undefined,
): ExportComplianceConfigStatus {
  switch (usesNonExemptEncryption) {
    case false:
      return {
        ok: true,
        message: "export compliance answered (`ios.config.usesNonExemptEncryption: false`) — no per-upload prompt",
      };
    case true:
      return {
        ok: false,
        message:
          "declares non-exempt encryption — a one-time App Encryption Declaration (with documentation) is required in App Store Connect",
      };
    default:
      return {
        ok: false,
        message:
          "export compliance not declared — set `ios.config.usesNonExemptEncryption` in app.json so the encryption question is answered once, not on every upload",
      };
  }
}

/** Render a {@link reconcileExportCompliance} outcome as one human line for `launch doctor --fix`. */
export function summarizeExportComplianceResult(result: ExportComplianceResult): string {
  switch (result.status) {
    case "undeclared":
      return "no `ios.config.usesNonExemptEncryption` in app.json — left as-is";
    case "build-not-found":
      return `no uploaded build ${result.buildNumber} on App Store Connect yet (still processing?) — try again shortly`;
    case "already-answered":
      return `already answered (usesNonExemptEncryption: ${result.usesNonExemptEncryption})`;
    case "answered":
      return `answered the encryption question on the build (usesNonExemptEncryption: ${result.usesNonExemptEncryption})`;
    case "reused-declaration":
      return `reused approved App Encryption Declaration ${result.declarationId}`;
    case "needs-declaration":
      return "no approved declaration to reuse — submit a one-time documented App Encryption Declaration in App Store Connect";
  }
}
