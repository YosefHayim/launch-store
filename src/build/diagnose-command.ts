import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { resolveLogsDirectory } from '../services/platform/paths.ts';
import { pathExists } from '../path-exists.ts';
import { diagnoseBuildLog, formatDiagnoses } from './build-diagnostics.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

type DiagnoseCommandInput = Readonly<{
  logfile?: string;
}>;

type DiagnoseCommandFailure = Readonly<{
  readonly _tag: 'DiagnoseCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

function makeDiagnoseCommandFailure(fields: {
  operation: string;
  message: string;
  cause?: unknown;
}): DiagnoseCommandFailure {
  const hasCause = fields.cause != null;

  if (hasCause) {
    return {
      _tag: 'DiagnoseCommandFailure',
      operation: fields.operation,
      message: fields.message,
      cause: fields.cause,
    };
  }

  return {
    _tag: 'DiagnoseCommandFailure',
    operation: fields.operation,
    message: fields.message,
  };
}

/** Decode `launch diagnose` input. Omitted optionals stay absent. */
export function decodeDiagnoseCommandInput(rawCommandInput: unknown): DiagnoseCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Diagnose command input must be an object.');
  }

  const hasLogfile = Object.hasOwn(rawCommandInputObject, 'logfile');

  if (hasLogfile == false) {
    return {};
  }

  const logfile = rawCommandInputObject['logfile'];
  const logfileIsMissing = logfile == null;

  if (logfileIsMissing) {
    return {};
  }

  const logfileIsString = typeof logfile == 'string';

  if (logfileIsString == false) {
    throw new Error('Diagnose logfile must be a string.');
  }

  return { logfile };
}

function isDiagnoseCommandFailure(cause: unknown): cause is DiagnoseCommandFailure {
  const isObject = typeof cause == 'object';

  if (isObject == false) {
    return false;
  }

  const isNull = cause == null;

  if (isNull) {
    return false;
  }

  const hasTag = '_tag' in cause;

  if (hasTag == false) {
    return false;
  }

  return cause._tag == 'DiagnoseCommandFailure';
}

type NewestLog = Readonly<{ path: string; modifiedAt: number }>;

/** Find the newest readable build log in Launch's local log directory. */
export async function findMostRecentBuildLog(): Promise<string | null> {
  const logsDirectory = resolveLogsDirectory();
  const directoryExists = await pathExists(logsDirectory);

  if (directoryExists == false) {
    return null;
  }

  let filenames: string[] = [];

  try {
    filenames = await readdir(logsDirectory);
  } catch {
    return null;
  }

  let newestLog: NewestLog | null = null;

  for (const filename of filenames) {
    const isLog = filename.endsWith('.log');

    if (isLog == false) {
      continue;
    }

    const logPath = path.join(logsDirectory, filename);
    let modifiedAt = 0;

    try {
      const fileStat = await stat(logPath);
      modifiedAt = fileStat.mtimeMs;
    } catch {
      continue;
    }

    const currentNewest = newestLog;
    const hasNewest = currentNewest != null;

    if (hasNewest == false) {
      newestLog = { path: logPath, modifiedAt };
      continue;
    }

    const isNewer = modifiedAt > currentNewest.modifiedAt;

    if (isNewer) {
      newestLog = { path: logPath, modifiedAt };
    }
  }

  const foundLog = newestLog;
  const logWasFound = foundLog != null;

  if (logWasFound == false) {
    return null;
  }

  return foundLog.path;
}

async function readDiagnoseLogPath(logfile: string | undefined): Promise<string | null> {
  const logfileIsMissing = logfile == null;

  if (logfileIsMissing) {
    const newestLogPath = await findMostRecentBuildLog();

    return newestLogPath;
  }

  return logfile;
}

/** Read one build log and render any recognized native failure diagnoses. */
export async function diagnoseCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodeDiagnoseCommandInput(rawCommandInput);
    const logPath = await readDiagnoseLogPath(commandInput.logfile);
    const logger = createLogger(false);
    const hasNoLog = logPath == null;

    if (hasNoLog) {
      logger.skip(
        'No build log found. Run a build first, or pass a log path: `launch diagnose <file>`.',
      );
      return;
    }

    const logFileExists = await pathExists(logPath);

    if (logFileExists == false) {
      throw makeDiagnoseCommandFailure({
        operation: 'read build log',
        message: `No log file at ${logPath}.`,
      });
    }

    const logText = await readFile(logPath, 'utf8');
    const diagnoses = diagnoseBuildLog(logText);
    const hasNoDiagnoses = diagnoses.length == 0;

    if (hasNoDiagnoses) {
      logger.skip(`No known issues recognized in ${logPath}.`);
      logger.line('Open the log to inspect the failure directly.');
      return;
    }

    logger.line(`Diagnosing ${logPath}\n`);
    logger.line(formatDiagnoses(diagnoses));
  } catch (cause) {
    const alreadyDiagnoseFailure = isDiagnoseCommandFailure(cause);

    if (alreadyDiagnoseFailure) {
      throw cause;
    }

    throw makeDiagnoseCommandFailure({
      operation: 'diagnose build log',
      message: errorMessage(cause),
      cause,
    });
  }
}
