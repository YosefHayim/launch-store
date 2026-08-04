import { Data, Effect, Schema } from 'effect';
import { ensureToolchain } from '../config/toolchain.js';
import { errorMessage } from '../services/errorMessage.js';
import type { EffectAppStoreConnectClient } from '../services/appleStoreClient.js';
import { createLogger, type Logger } from '../services/logger.js';
import { isApplePlatform, parsePlatform } from '../services/platform.js';
import type { LaunchPromptService } from '../services/prompt.js';
import { createAscClientResolver } from '../store/storeClients.js';
import {
  summarizeExportComplianceResult,
  type ExportComplianceResult,
} from '../store/exportCompliance.js';
import { completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { AppDescriptor } from '../types/app.js';
import type { DoctorCheck, DoctorPlatform, DoctorReport } from '../types/doctor.js';
import { buildDoctorContext, type DoctorRuntimeRequirements } from './context.js';
import { inspectDoctor } from './inspect.js';

export const DoctorCommandInputSchema = Schema.Struct({
  platform: Schema.optionalWith(Schema.String, { exact: true }),
  app: Schema.optionalWith(Schema.String, { exact: true }),
  fix: Schema.Boolean,
  yes: Schema.Boolean,
  json: Schema.Boolean,
});

export type DoctorCommandInput = Schema.Schema.Type<typeof DoctorCommandInputSchema>;

/** A doctor command step failed. */
export type DoctorCommandFailure = Readonly<{
  readonly _tag: 'DoctorCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeDoctorCommandFailure = Data.tagged<DoctorCommandFailure>('DoctorCommandFailure');

type DoctorCommandRequirements = DoctorRuntimeRequirements | LaunchPromptService | Logger;

/** Convert a dependency failure into the doctor command channel. */
const doctorFailure = (operation: string, cause: unknown): DoctorCommandFailure => {
  let message = `${operation} failed.`;
  if (typeof cause === 'string' && cause.length > 0) message = cause;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makeDoctorCommandFailure({ operation, message, cause });
};

/** Render one doctor check as one or more ASCII lines. */
export const renderDoctorCheckLines = (doctorCheck: DoctorCheck): string[] => {
  const statusLabels: Record<DoctorCheck['status'], string> = {
    ok: 'OK',
    fail: 'x',
    info: '-',
  };
  let hintText = '';
  if (doctorCheck.status !== 'ok' && doctorCheck.hint !== undefined) {
    hintText = `  - ${doctorCheck.hint}`;
  }
  const renderedLines = [`${statusLabels[doctorCheck.status]} ${doctorCheck.title}${hintText}`];
  if (doctorCheck.detail !== undefined) {
    for (const detailLine of doctorCheck.detail.split('\n')) {
      if (detailLine.startsWith(' ')) renderedLines.push(detailLine);
      if (!detailLine.startsWith(' ')) renderedLines.push(`  ${detailLine}`);
    }
  }
  return renderedLines;
};

/** Print a doctor report in check order. */
const renderDoctorReport = (doctorReport: DoctorReport): Effect.Effect<void, unknown, Logger> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    for (const doctorCheck of doctorReport.checks) {
      for (const renderedLine of renderDoctorCheckLines(doctorCheck)) {
        yield* logger.line(renderedLine);
      }
    }
  });

/** Resolve every Apple build platform to the shared iOS doctor path. */
const resolveDoctorPlatform = (
  platformText: string | undefined,
): Effect.Effect<DoctorPlatform, DoctorCommandFailure> =>
  Effect.gen(function* () {
    let requestedPlatform = 'ios';
    if (platformText !== undefined) requestedPlatform = platformText;
    const parsedPlatform = yield* parsePlatform(requestedPlatform).pipe(
      Effect.mapError((cause) => doctorFailure('parse doctor platform', cause)),
    );
    if (isApplePlatform(parsedPlatform)) return 'ios';
    return 'android';
  });

/** Reconcile one build's export-compliance answer through the Effect client. */
const reconcileDoctorExportCompliance = (
  appleStore: EffectAppStoreConnectClient,
  app: AppDescriptor,
  buildNumber: number,
): Effect.Effect<ExportComplianceResult, unknown> =>
  Effect.gen(function* () {
    if (app.bundleId === undefined) return { status: 'undeclared' };
    if (app.usesNonExemptEncryption === undefined) return { status: 'undeclared' };
    const uploadedBuild = yield* appleStore.findBuild(app.bundleId, buildNumber);
    if (uploadedBuild === null) return { status: 'build-not-found', buildNumber };
    if (uploadedBuild.usesNonExemptEncryption === app.usesNonExemptEncryption) {
      return {
        status: 'already-answered',
        usesNonExemptEncryption: app.usesNonExemptEncryption,
      };
    }
    if (!app.usesNonExemptEncryption) {
      yield* appleStore.setBuildUsesNonExemptEncryption(uploadedBuild.id, false);
      return { status: 'answered', usesNonExemptEncryption: false };
    }
    const encryptionDeclarations = yield* appleStore.listEncryptionDeclarations(app.bundleId);
    const approvedDeclaration = encryptionDeclarations.find(
      (encryptionDeclaration) => encryptionDeclaration.state === 'APPROVED',
    );
    if (approvedDeclaration !== undefined) {
      yield* appleStore.linkBuildToDeclaration(approvedDeclaration.id, uploadedBuild.id);
      return { status: 'reused-declaration', declarationId: approvedDeclaration.id };
    }
    yield* appleStore.setBuildUsesNonExemptEncryption(uploadedBuild.id, true);
    return { status: 'needs-declaration' };
  });

/** Best-effort export-compliance repair for selected iOS apps. */
const fixExportCompliance = (
  selectedApps: AppDescriptor[],
): Effect.Effect<void, unknown, DoctorCommandRequirements> =>
  Effect.gen(function* () {
    const resolveAppleStore = createAscClientResolver();
    const appleStore = yield* resolveAppleStore().pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (appleStore === null) return;
    const logger = yield* createLogger(false);
    for (const selectedApp of selectedApps) {
      const bundleId = selectedApp.bundleId;
      if (bundleId === undefined) continue;
      if (selectedApp.usesNonExemptEncryption === undefined) continue;
      const complianceLine = yield* Effect.gen(function* () {
        const buildNumber = yield* appleStore.getLatestBuildNumber(bundleId);
        if (buildNumber === 0) return undefined;
        const complianceOutcome = yield* reconcileDoctorExportCompliance(
          appleStore,
          selectedApp,
          buildNumber,
        );
        return `  -> ${selectedApp.name} build ${buildNumber}: ${summarizeExportComplianceResult(complianceOutcome)}`;
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.succeed(
            `  -> ${selectedApp.name}: could not reconcile export compliance - ${errorMessage(cause)}`,
          ),
        ),
      );
      if (complianceLine !== undefined) yield* logger.line(complianceLine);
    }
  });

/** Run doctor inspection and return whether all required checks passed. */
export const runDoctorProgram = (
  rawCommandInput: unknown,
): Effect.Effect<boolean, DoctorCommandFailure, DoctorCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(DoctorCommandInputSchema)(
      rawCommandInput,
    ).pipe(Effect.mapError((cause) => doctorFailure('decode doctor command input', cause)));
    const doctorPlatform = yield* resolveDoctorPlatform(commandInput.platform);
    const doctorContext = yield* buildDoctorContext(doctorPlatform, commandInput.app);
    if (commandInput.json) {
      const doctorReport = yield* inspectDoctor(doctorContext);
      const logger = yield* createLogger(false);
      yield* logger.line(JSON.stringify(doctorReport, null, 2));
      return doctorReport.ok;
    }
    if (doctorPlatform === 'ios' && commandInput.fix) {
      yield* ensureToolchain({ assumeYes: commandInput.yes });
    }
    const doctorReport = yield* inspectDoctor(doctorContext);
    yield* renderDoctorReport(doctorReport);
    if (doctorPlatform === 'ios' && commandInput.fix) {
      yield* fixExportCompliance(doctorContext.apps);
    }
    return doctorReport.ok;
  }).pipe(Effect.mapError((cause) => doctorFailure('run doctor', cause)));

/** Run doctor and request exit one when a required check fails. */
export const doctorCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, CommandExit | DoctorCommandFailure, DoctorCommandRequirements> =>
  Effect.gen(function* () {
    const doctorPassed = yield* runDoctorProgram(rawCommandInput);
    if (!doctorPassed) yield* completeCommand(1);
  });
