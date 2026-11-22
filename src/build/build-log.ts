import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveLogsDirectory } from '../services/platform/paths.ts';
import { redactText } from '../services/platform/redact.ts';
import type { Platform } from '../types/app.ts';

/** Natural-key fields that identify one build log. */
type BuildLogKey = Readonly<{
  appName: string;
  version: string;
  buildNumber: number;
  platform: Platform;
}>;

/** Build a stable log identifier from a build's natural key. */
export function buildLogId(buildKey: BuildLogKey): string {
  return `${buildKey.appName}-${buildKey.version}-${buildKey.buildNumber}-${buildKey.platform}`;
}

/** Resolve the persisted log path for a build identifier. */
export function buildLogPath(buildIdentifier: string): string {
  const logsDirectory = resolveLogsDirectory();
  // Keep only characters that are safe in a log file name.
  const safeIdentifier = buildIdentifier.replace(/[^A-Za-z0-9._-]/g, '-');

  return path.join(logsDirectory, `${safeIdentifier}.log`);
}

/** Read and redact a persisted build log, returning null when it is unavailable. */
export async function readBuildLog(buildIdentifier: string): Promise<string | null> {
  const logPath = buildLogPath(buildIdentifier);

  try {
    var logText = await readFile(logPath, 'utf8');
  } catch {
    return null;
  }

  return redactText(logText);
}

let activeBuildLog: string | null = null;

/** Begin a fresh per-build log and mark it as the active progress log. */
export async function beginBuildLog(buildIdentifier: string): Promise<string> {
  const logPath = buildLogPath(buildIdentifier);
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, '');
  activeBuildLog = logPath;

  return logPath;
}

/** Stop routing progress output into a per-build log. */
export function endBuildLog(): void {
  activeBuildLog = null;
}

/** Return the current per-build log path, or null when no build owns one. */
export function currentBuildLog(): string | null {
  return activeBuildLog;
}
