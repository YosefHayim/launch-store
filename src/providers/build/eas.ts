import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SizeReport } from '@/types/artifacts.js';
import type { ResolvedBuildContext } from '@/types/config.js';
import { makeProviderInputFailure, type HostedBuildProvider } from '@/types/providers.js';
import {
  captureCommandOutput,
  checkCommandExists,
  executeCommand,
} from '@/services/platform/exec.js';

type EasInvocation = {
  command: string;
  prefix: readonly string[];
};

type EasArtifacts = {
  applicationArchiveUrl?: string;
  buildUrl?: string;
};

type EasBuildEntry = {
  artifacts?: EasArtifacts;
  appBuildVersion?: string | number;
  buildNumber?: string | number;
};

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  return typeof candidate == 'object';
}

function readOptionalText(candidate: unknown): string | null {
  if (typeof candidate != 'string') {
    return null;
  }

  return candidate;
}

function readOptionalTextOrNumber(candidate: unknown): string | number | null {
  if (typeof candidate == 'number') {
    return candidate;
  }

  return readOptionalText(candidate);
}

function readEasArtifacts(candidate: unknown): EasArtifacts | null {
  if (isRecord(candidate) == false) {
    return null;
  }

  const artifacts: EasArtifacts = {};
  const hasArchiveUrl = 'applicationArchiveUrl' in candidate;

  if (hasArchiveUrl) {
    const archiveUrl = readOptionalText(candidate['applicationArchiveUrl']);

    if (archiveUrl == null) {
      return null;
    }

    artifacts.applicationArchiveUrl = archiveUrl;
  }

  const hasBuildUrl = 'buildUrl' in candidate;

  if (hasBuildUrl) {
    const buildUrl = readOptionalText(candidate['buildUrl']);

    if (buildUrl == null) {
      return null;
    }

    artifacts.buildUrl = buildUrl;
  }

  return artifacts;
}

function readReportedNumber(
  candidate: unknown,
  fieldName: 'appBuildVersion' | 'buildNumber',
): string | number | null {
  if (isRecord(candidate) == false) {
    return null;
  }

  const fieldIsPresent = fieldName in candidate;

  if (fieldIsPresent == false) {
    return null;
  }

  return readOptionalTextOrNumber(candidate[fieldName]);
}

function readEasBuildEntry(candidate: unknown): EasBuildEntry | null {
  if (isRecord(candidate) == false) {
    return null;
  }

  const buildRecord: EasBuildEntry = {};
  const hasArtifacts = 'artifacts' in candidate;

  if (hasArtifacts) {
    const artifacts = readEasArtifacts(candidate['artifacts']);

    if (artifacts == null) {
      return null;
    }

    buildRecord.artifacts = artifacts;
  }

  const hasAppBuildVersion = 'appBuildVersion' in candidate;

  if (hasAppBuildVersion) {
    const appBuildVersion = readReportedNumber(candidate, 'appBuildVersion');

    if (appBuildVersion == null) {
      return null;
    }

    buildRecord.appBuildVersion = appBuildVersion;
  }

  const hasBuildNumber = 'buildNumber' in candidate;

  if (hasBuildNumber) {
    const buildNumber = readReportedNumber(candidate, 'buildNumber');

    if (buildNumber == null) {
      return null;
    }

    buildRecord.buildNumber = buildNumber;
  }

  return buildRecord;
}

async function readEasCommand(): Promise<EasInvocation> {
  const hasGlobalEas = await checkCommandExists('eas');

  if (hasGlobalEas) {
    return { command: 'eas', prefix: [] };
  }

  return { command: 'npx', prefix: ['--yes', 'eas-cli'] };
}

async function detectEasCli(): Promise<string> {
  const easInvocation = await readEasCommand();
  const isGlobalInstall = easInvocation.command == 'eas';

  if (isGlobalInstall) {
    return 'eas (global install)';
  }

  return 'npx eas-cli (not globally installed)';
}

async function ensureExpoSession(): Promise<string> {
  const easInvocation = await readEasCommand();

  try {
    return await captureCommandOutput(easInvocation.command, [...easInvocation.prefix, 'whoami']);
  } catch (cause) {
    const whoamiFailed = cause != null;

    if (whoamiFailed == false) {
      throw cause;
    }
  }

  await executeCommand(easInvocation.command, [...easInvocation.prefix, 'login']);

  return captureCommandOutput(easInvocation.command, [...easInvocation.prefix, 'whoami']);
}

function firstBuildEntry(jsonText: string): EasBuildEntry | null {
  const start = jsonText.indexOf('[');
  const end = jsonText.lastIndexOf(']');
  const isMissingStart = start == -1;

  if (isMissingStart) {
    return null;
  }

  const isMissingEnd = end == -1;

  if (isMissingEnd) {
    return null;
  }

  const isReversed = end < start;

  if (isReversed) {
    return null;
  }

  try {
    const decodedBuilds: unknown = JSON.parse(jsonText.slice(start, end + 1));
    const isBuildList = Array.isArray(decodedBuilds);

    if (isBuildList == false) {
      return null;
    }

    const firstBuild = decodedBuilds[0];

    if (firstBuild == null) {
      return null;
    }

    return readEasBuildEntry(firstBuild);
  } catch (cause) {
    const isUnreadable = cause != null;

    if (isUnreadable) {
      return null;
    }

    throw cause;
  }
}

export function parseArtifactUrl(jsonText: string): string | null {
  const buildEntry = firstBuildEntry(jsonText);
  const applicationArchiveUrl = buildEntry?.artifacts?.applicationArchiveUrl;

  if (applicationArchiveUrl != null) {
    return applicationArchiveUrl;
  }

  const buildUrl = buildEntry?.artifacts?.buildUrl;

  if (buildUrl != null) {
    return buildUrl;
  }

  return null;
}

export function parseBuildNumber(jsonText: string): number {
  const buildEntry = firstBuildEntry(jsonText);
  let reportedBuildNumber = buildEntry?.appBuildVersion;

  if (reportedBuildNumber == null) {
    reportedBuildNumber = buildEntry?.buildNumber;
  }

  if (reportedBuildNumber == null) {
    return 0;
  }

  if (typeof reportedBuildNumber == 'number') {
    return reportedBuildNumber;
  }

  const parsedBuildNumber = Number.parseInt(reportedBuildNumber, 10);
  const isNotANumber = Number.isNaN(parsedBuildNumber);

  if (isNotANumber) {
    return 0;
  }

  return parsedBuildNumber;
}

async function downloadFile(artifactUrl: string, destinationPath: string): Promise<void> {
  let artifactReply: Response;

  try {
    artifactReply = await fetch(artifactUrl);
  } catch (cause) {
    throw makeProviderInputFailure({
      provider: 'eas',
      message: `Could not download the EAS artifact: ${String(cause)}`,
    });
  }

  const isDownloadOk = artifactReply.ok;

  if (isDownloadOk == false) {
    throw makeProviderInputFailure({
      provider: 'eas',
      message: `Could not download the EAS artifact: ${artifactReply.status}`,
    });
  }

  let artifactBytes: ArrayBuffer;

  try {
    artifactBytes = await artifactReply.arrayBuffer();
  } catch (cause) {
    throw makeProviderInputFailure({
      provider: 'eas',
      message: `Could not read the EAS artifact: ${String(cause)}`,
    });
  }

  await writeFile(destinationPath, new Uint8Array(artifactBytes));
}

async function easBuildToIpa(
  buildContext: ResolvedBuildContext,
  profileName: string,
): Promise<{ ipaPath: string; sizeReport: SizeReport; buildNumber: number }> {
  const easInvocation = await readEasCommand();
  const buildJson = await captureCommandOutput(
    easInvocation.command,
    [
      ...easInvocation.prefix,
      'build',
      '--platform',
      'ios',
      '--profile',
      profileName,
      '--non-interactive',
      '--json',
      '--wait',
    ],
    { workingDirectory: buildContext.app.dir, environmentOverrides: buildContext.env },
  );
  const artifactUrl = parseArtifactUrl(buildJson);

  if (artifactUrl == null) {
    throw makeProviderInputFailure({
      provider: 'eas',
      message:
        "No artifact URL in `eas build --json` output - Expo's CLI shape may have changed (see providers/build/eas.ts).",
    });
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'launch-eas-'));
  const ipaPath = join(temporaryDirectory, `${buildContext.app.name}.ipa`);
  await downloadFile(artifactUrl, ipaPath);
  const ipaStat = await stat(ipaPath);

  return {
    ipaPath,
    sizeReport: { artifactBytes: Number(ipaStat.size), entries: [] },
    buildNumber: parseBuildNumber(buildJson),
  };
}

export async function easSubmit(
  buildContext: ResolvedBuildContext,
  ipaPath: string,
  profileName: string,
): Promise<void> {
  const easInvocation = await readEasCommand();
  await executeCommand(
    easInvocation.command,
    [
      ...easInvocation.prefix,
      'submit',
      '--platform',
      'ios',
      '--path',
      ipaPath,
      '--profile',
      profileName,
      '--non-interactive',
    ],
    { workingDirectory: buildContext.app.dir },
  );
}

async function buildHostedArtifact(
  buildContext: ResolvedBuildContext,
  profileName: string,
): Promise<{ artifactPath: string; sizeReport: SizeReport; buildNumber: number }> {
  const builtIpa = await easBuildToIpa(buildContext, profileName);

  return {
    artifactPath: builtIpa.ipaPath,
    sizeReport: builtIpa.sizeReport,
    buildNumber: builtIpa.buildNumber,
  };
}

export const easHostedBuildProvider: HostedBuildProvider = {
  name: 'eas',
  describeCli: detectEasCli,
  authenticate: ensureExpoSession,
  build: buildHostedArtifact,
  submit: easSubmit,
};
