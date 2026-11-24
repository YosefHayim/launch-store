// Prints the native iOS fingerprint and whether the next build can reuse the last archive.

import path from 'node:path';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { loadStoreAppContext } from '../store/shared/select-store-app.ts';
import type { Platform } from '../types/app.ts';
import {
  type BuildState,
  type CleanDecision,
  gatherIosFingerprint,
  readBuildState,
  resolveClean,
} from './build-fingerprint.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

type FingerprintCommandInput = Readonly<{
  app?: string;
  json: boolean;
}>;

/** Fingerprint calculation and the cache decision it produces. */
export type FingerprintReport = Readonly<{
  app: string;
  platform: Platform;
  current: string;
  stored: BuildState | null;
  decision: CleanDecision;
}>;

/** Decode `launch-store fingerprint` input. Omitted optionals stay absent. */
export function decodeFingerprintCommandInput(rawCommandInput: unknown): FingerprintCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Fingerprint command input must be an object.');
  }

  const jsonFlag = rawCommandInputObject['json'];
  const jsonIsBoolean = typeof jsonFlag == 'boolean';

  if (jsonIsBoolean == false) {
    throw new Error('Fingerprint json must be a boolean.');
  }

  const hasApp = Object.hasOwn(rawCommandInputObject, 'app');

  if (hasApp == false) {
    return { json: jsonFlag };
  }

  const appName = rawCommandInputObject['app'];

  const appIsMissing = appName == null;

  if (appIsMissing) {
    return { json: jsonFlag };
  }

  const appIsString = typeof appName == 'string';

  if (appIsString == false) {
    throw new Error('Fingerprint app must be a string.');
  }

  return { app: appName, json: jsonFlag };
}

/** Shorten a hash for terminal comparison. */
function shortHash(hash: string): string {
  const shortHashLength = 12;

  return hash.slice(0, shortHashLength);
}

/** Render a fingerprint report for a human terminal. */
export function formatFingerprintReport(fingerprintReport: FingerprintReport): string {
  let lastBuild = 'none on this host yet';

  const hasStoredBuild = fingerprintReport.stored != null;

  if (hasStoredBuild) {
    let buildKind = 'incremental';

    const wasClean = fingerprintReport.stored.cleanBuilt == true;

    if (wasClean) {
      buildKind = 'clean';
    }

    lastBuild = `${shortHash(fingerprintReport.stored.fingerprint)}  (${fingerprintReport.stored.builtAt}, ${buildKind})`;
  }

  let verdict = 'incremental (reuses warm caches)';

  const nextIsClean = fingerprintReport.decision.clean == true;

  if (nextIsClean) {
    verdict = 'clean (from scratch)';
  }

  return [
    `App:                 ${fingerprintReport.app} (${fingerprintReport.platform})`,
    `Current fingerprint: ${shortHash(fingerprintReport.current)}`,
    `Last build:          ${lastBuild}`,
    `Next build:          ${verdict} - ${fingerprintReport.decision.reason}`,
  ].join('\n');
}

/** Decode input and explain the selected app's next iOS cache decision. */
export async function fingerprintCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodeFingerprintCommandInput(rawCommandInput);
    const logger = createLogger(false);
    const selectedContext = await loadStoreAppContext(commandInput.app);
    const hasBundleId = selectedContext.app.bundleId != null;

    if (hasBundleId == false) {
      logger.line(
        `${selectedContext.app.name} has no iOS bundle id - fingerprints are iOS-only (Gradle tracks Android build inputs itself).`,
      );
      return;
    }

    const iosDirectory = path.join(selectedContext.app.dir, 'ios');
    const currentFingerprint = await gatherIosFingerprint(
      iosDirectory,
      selectedContext.app.configPath,
    );
    const storedBuild = await readBuildState(selectedContext.app.name, 'ios');
    const fingerprintReport: FingerprintReport = {
      app: selectedContext.app.name,
      platform: 'ios',
      current: currentFingerprint,
      stored: storedBuild,
      decision: resolveClean(false, storedBuild, currentFingerprint),
    };
    let reportText = formatFingerprintReport(fingerprintReport);

    const wantsJson = commandInput.json == true;

    if (wantsJson) {
      reportText = JSON.stringify(fingerprintReport, null, 2);
    }

    logger.line(reportText);
  } catch (cause) {
    const isAlreadyError = cause instanceof Error;

    if (isAlreadyError) {
      throw cause;
    }

    const failureMessage = errorMessage(cause);

    throw new Error(failureMessage, { cause });
  }
}
