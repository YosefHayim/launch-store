// Runs doctor, prints each check, and can repair the iOS toolchain and export compliance.

import { ensureToolchain } from '../config/toolchain.ts';
import { hasMessage, errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { isApplePlatform, parsePlatform } from '../services/stores/platform.ts';
import type { AppStoreConnect } from '../apple/app-store-connect.ts';
import { createAscClientResolver } from '../store/shared/store-clients.ts';
import {
  summarizeExportComplianceResult,
  type ExportComplianceResult,
} from '../store/apple/export-compliance.ts';
import type { EncryptionDeclarationResource } from '../types/apple-catalog.ts';
import { completeCommand } from '../terminal/command-exit.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { DoctorCheck, DoctorContext, DoctorPlatform, DoctorReport } from '../types/doctor.ts';
import { buildDoctorContext } from './context.ts';
import { inspectDoctor } from './inspect.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

export type DoctorCommandInput = {
  platform?: string;
  app?: string;
  fix: boolean;
  yes: boolean;
  json: boolean;
};

type DoctorCommandFailure = Readonly<{
  _tag: 'DoctorCommandFailure';
  operation: string;
  message: string;
  cause: unknown;
}>;

function readBooleanField(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];

  if (typeof field == 'boolean') {
    return field;
  }

  throw new Error(`${fieldName} must be a boolean`);
}

function readOptionalTextField(record: Record<string, unknown>, fieldName: string): string | null {
  const isPresent = Object.hasOwn(record, fieldName);

  if (isPresent == false) {
    return null;
  }

  const field = record[fieldName];

  if (typeof field == 'string') {
    return field;
  }

  throw new Error(`${fieldName} must be a string`);
}

function readDoctorCommandFields(record: Record<string, unknown>): DoctorCommandInput {
  const fix = readBooleanField(record, 'fix');
  const yes = readBooleanField(record, 'yes');
  const json = readBooleanField(record, 'json');
  const platform = readOptionalTextField(record, 'platform');
  const app = readOptionalTextField(record, 'app');
  let commandInput: DoctorCommandInput = { fix, yes, json };

  if (platform != null) {
    commandInput = { ...commandInput, platform };
  }

  if (app != null) {
    commandInput = { ...commandInput, app };
  }

  return commandInput;
}

/** Read the doctor command boundary, rejecting explicit undefined optionals. */
export function DoctorCommandInputSchema(rawCommandInput: unknown): DoctorCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject != null) {
    return readDoctorCommandFields(rawCommandInputObject);
  }

  throw new Error('doctor command input must be an object');
}

function readNonEmptyText(text: string): string | null {
  const isEmpty = text.length == 0;

  if (isEmpty) {
    return null;
  }

  return text;
}

function readCauseMessage(cause: unknown): string | null {
  if (hasMessage(cause)) {
    return cause.message;
  }

  if (typeof cause == 'string') {
    return readNonEmptyText(cause);
  }

  return null;
}

function doctorFailure(operation: string, cause: unknown): DoctorCommandFailure {
  let message = `${operation} failed.`;
  const causeMessage = readCauseMessage(cause);

  if (causeMessage != null) {
    message = causeMessage;
  }

  return { _tag: 'DoctorCommandFailure', operation, message, cause };
}

function readHintText(doctorCheck: DoctorCheck): string {
  const isOk = doctorCheck.status == 'ok';

  if (isOk) {
    return '';
  }

  if (doctorCheck.hint == null) {
    return '';
  }

  return `  - ${doctorCheck.hint}`;
}

function indentDetailLine(detailLine: string): string {
  const isIndented = detailLine.startsWith(' ');

  if (isIndented) {
    return detailLine;
  }

  return `  ${detailLine}`;
}

/** Render one doctor check as one or more ASCII lines. */
export function renderDoctorCheckLines(doctorCheck: DoctorCheck): string[] {
  const statusLabels: Record<DoctorCheck['status'], string> = {
    ok: 'OK',
    fail: 'x',
    info: '-',
  };
  const statusLabel = statusLabels[doctorCheck.status];
  const renderedLines = [`${statusLabel} ${doctorCheck.title}${readHintText(doctorCheck)}`];

  if (doctorCheck.detail == null) {
    return renderedLines;
  }

  const detailLines = doctorCheck.detail.split('\n');

  for (const detailLine of detailLines) {
    renderedLines.push(indentDetailLine(detailLine));
  }

  return renderedLines;
}

function showDoctorReport(doctorReport: DoctorReport): void {
  const logger = createLogger(false);

  for (const doctorCheck of doctorReport.checks) {
    for (const renderedLine of renderDoctorCheckLines(doctorCheck)) {
      logger.line(renderedLine);
    }
  }
}

function readDoctorPlatform(platformText: string | undefined): DoctorPlatform {
  let requestedPlatform = 'ios';

  if (platformText != null) {
    requestedPlatform = platformText;
  }

  const parsedPlatform = parsePlatform(requestedPlatform);

  const isApple = isApplePlatform(parsedPlatform);

  if (isApple) {
    return 'ios';
  }

  return 'android';
}

function isApprovedDeclaration(encryptionDeclaration: EncryptionDeclarationResource): boolean {
  return encryptionDeclaration.state == 'APPROVED';
}

async function reconcileDoctorExportCompliance(
  appleStore: AppStoreConnect,
  app: AppDescriptor,
  buildNumber: number,
): Promise<ExportComplianceResult> {
  if (app.bundleId == null) {
    return { status: 'undeclared' };
  }

  if (app.usesNonExemptEncryption == null) {
    return { status: 'undeclared' };
  }

  const uploadedBuild = await appleStore.findBuild(app.bundleId, buildNumber);

  if (uploadedBuild == null) {
    return { status: 'build-not-found', buildNumber };
  }

  const answerMatches = uploadedBuild.usesNonExemptEncryption == app.usesNonExemptEncryption;

  if (answerMatches) {
    return {
      status: 'already-answered',
      usesNonExemptEncryption: app.usesNonExemptEncryption,
    };
  }

  const isExempt = app.usesNonExemptEncryption == false;

  if (isExempt) {
    await appleStore.setBuildUsesNonExemptEncryption(uploadedBuild.id, false);

    return { status: 'answered', usesNonExemptEncryption: false };
  }

  const encryptionDeclarations = await appleStore.listEncryptionDeclarations(app.bundleId);
  const approvedDeclaration = encryptionDeclarations.find(isApprovedDeclaration);

  if (approvedDeclaration != null) {
    await appleStore.linkBuildToDeclaration(approvedDeclaration.id, uploadedBuild.id);

    return { status: 'reused-declaration', declarationId: approvedDeclaration.id };
  }

  await appleStore.setBuildUsesNonExemptEncryption(uploadedBuild.id, true);

  return { status: 'needs-declaration' };
}

async function readComplianceLine(
  appleStore: AppStoreConnect,
  selectedApp: AppDescriptor,
): Promise<string | null> {
  if (selectedApp.bundleId == null) {
    return null;
  }

  if (selectedApp.usesNonExemptEncryption == null) {
    return null;
  }

  try {
    const buildNumber = await appleStore.getLatestBuildNumber(selectedApp.bundleId);

    const isMissingBuild = buildNumber == 0;

    if (isMissingBuild) {
      return null;
    }

    const complianceOutcome = await reconcileDoctorExportCompliance(
      appleStore,
      selectedApp,
      buildNumber,
    );
    const summary = summarizeExportComplianceResult(complianceOutcome);

    return `  -> ${selectedApp.name} build ${buildNumber}: ${summary}`;
  } catch (error) {
    const failureText = errorMessage(error);

    return `  -> ${selectedApp.name}: could not reconcile export compliance - ${failureText}`;
  }
}

async function fixExportCompliance(selectedApps: readonly AppDescriptor[]): Promise<void> {
  const resolveAppleStore = createAscClientResolver();
  let appleStore: AppStoreConnect | null = null;

  try {
    appleStore = await resolveAppleStore();
  } catch {
    // Export-compliance fix is best-effort when the Apple client cannot be opened.
    return;
  }

  if (appleStore == null) {
    return;
  }

  const logger = createLogger(false);

  for (const selectedApp of selectedApps) {
    const complianceLine = await readComplianceLine(appleStore, selectedApp);

    if (complianceLine == null) {
      continue;
    }

    logger.line(complianceLine);
  }
}

function isIosFix(doctorPlatform: DoctorPlatform, shouldFix: boolean): boolean {
  const isIos = doctorPlatform == 'ios';

  if (isIos == false) {
    return false;
  }

  return shouldFix;
}

async function showDoctorJson(doctorContext: DoctorContext): Promise<boolean> {
  const doctorReport = await inspectDoctor(doctorContext);
  const logger = createLogger(false);
  const jsonIndent = 2;
  const serialized = JSON.stringify(doctorReport, null, jsonIndent);

  logger.line(serialized);

  return doctorReport.ok;
}

async function runDoctorProgram(rawCommandInput: unknown): Promise<boolean> {
  try {
    const commandInput = DoctorCommandInputSchema(rawCommandInput);
    const doctorPlatform = readDoctorPlatform(commandInput.platform);
    const doctorContext = await buildDoctorContext(doctorPlatform, commandInput.app);

    const isJson = commandInput.json;

    if (isJson) {
      return await showDoctorJson(doctorContext);
    }

    const shouldFixIos = isIosFix(doctorPlatform, commandInput.fix);

    if (shouldFixIos) {
      await ensureToolchain({ assumeYes: commandInput.yes });
    }

    const doctorReport = await inspectDoctor(doctorContext);

    showDoctorReport(doctorReport);

    if (shouldFixIos) {
      await fixExportCompliance(doctorContext.apps);
    }

    return doctorReport.ok;
  } catch (error) {
    throw doctorFailure('run doctor', error);
  }
}

/** Run doctor and request exit one when a required check fails. */
export async function doctorCommandProgram(rawCommandInput: unknown): Promise<void> {
  const doctorPassed = await runDoctorProgram(rawCommandInput);

  if (doctorPassed) {
    return;
  }

  completeCommand(1);
}
