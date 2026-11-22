import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathExists } from '../path-exists.ts';
import type { HostHandle, SshTarget } from '../types/remote.ts';
import {
  resolveCloudStateFilePath,
  resolveLaunchHomeDirectory,
} from '../services/platform/paths.ts';

type CloudState = {
  host?: HostHandle;
  amiId?: string;
};

function emptyCloudState(): CloudState {
  return {};
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  return typeof candidate == 'object';
}

function optionalString(
  record: Record<string, unknown>,
  fieldName: string,
): string | null | undefined {
  const isAbsent = fieldName in record == false;

  if (isAbsent) {
    return undefined;
  }

  const field = record[fieldName];

  if (typeof field != 'string') {
    return null;
  }

  return field;
}

function readSshTarget(candidate: unknown): SshTarget | null {
  if (isRecord(candidate) == false) {
    return null;
  }

  const host = optionalString(candidate, 'host');
  const user = optionalString(candidate, 'user');
  const isHostMissing = typeof host != 'string';

  if (isHostMissing) {
    return null;
  }

  const isUserMissing = typeof user != 'string';

  if (isUserMissing) {
    return null;
  }

  const port = candidate['port'];
  const isPort = typeof port == 'number';

  if (isPort == false) {
    return null;
  }

  const identityFile = optionalString(candidate, 'identityFile');

  if (identityFile == null) {
    return null;
  }

  const sshTarget: SshTarget = { host, user, port };

  if (identityFile != null) {
    return { ...sshTarget, identityFile };
  }

  return sshTarget;
}

function readHostHandle(candidate: unknown): HostHandle | null {
  if (isRecord(candidate) == false) {
    return null;
  }

  const provider = optionalString(candidate, 'provider');
  const allocatedAt = optionalString(candidate, 'allocatedAt');
  const isProviderMissing = typeof provider != 'string';

  if (isProviderMissing) {
    return null;
  }

  const isAllocatedAtMissing = typeof allocatedAt != 'string';

  if (isAllocatedAtMissing) {
    return null;
  }

  const ssh = readSshTarget(candidate['ssh']);

  if (ssh == null) {
    return null;
  }

  const instanceId = optionalString(candidate, 'instanceId');
  const hostId = optionalString(candidate, 'hostId');
  const region = optionalString(candidate, 'region');
  const instanceType = optionalString(candidate, 'instanceType');
  const optionalFields = [instanceId, hostId, region, instanceType];

  function isInvalidOptional(field: string | null | undefined): boolean {
    return field == null;
  }

  const hasInvalidOptional = optionalFields.some(isInvalidOptional);

  if (hasInvalidOptional) {
    return null;
  }

  let recordedHost: HostHandle = { provider, ssh, allocatedAt };

  if (instanceId != null) {
    recordedHost = { ...recordedHost, instanceId };
  }

  if (hostId != null) {
    recordedHost = { ...recordedHost, hostId };
  }

  if (region != null) {
    recordedHost = { ...recordedHost, region };
  }

  if (instanceType != null) {
    recordedHost = { ...recordedHost, instanceType };
  }

  return recordedHost;
}

function readCloudDocument(candidate: unknown): CloudState | null {
  if (isRecord(candidate) == false) {
    return null;
  }

  const amiId = optionalString(candidate, 'amiId');

  if (amiId == null) {
    return null;
  }

  const hasHost = 'host' in candidate;
  let host: HostHandle | undefined;

  if (hasHost) {
    const decodedHost = readHostHandle(candidate['host']);

    if (decodedHost == null) {
      return null;
    }

    host = decodedHost;
  }

  const cloudState: CloudState = {};

  if (host != null) {
    cloudState.host = host;
  }

  if (amiId != null) {
    cloudState.amiId = amiId;
  }

  return cloudState;
}

function decodeCloudState(stateText: string): CloudState {
  try {
    const parsed: unknown = JSON.parse(stateText);
    const cloudState = readCloudDocument(parsed);

    if (cloudState == null) {
      return emptyCloudState();
    }

    return cloudState;
  } catch (cause) {
    const isUnreadable = cause != null;

    if (isUnreadable) {
      return emptyCloudState();
    }

    throw cause;
  }
}

export async function readCloudState(): Promise<CloudState> {
  const cloudStateFilePath = resolveCloudStateFilePath();

  try {
    const stateExists = await pathExists(cloudStateFilePath);

    if (stateExists == false) {
      return emptyCloudState();
    }

    const stateText = await readFile(cloudStateFilePath, 'utf8');

    return decodeCloudState(stateText);
  } catch (cause) {
    const isUnreadable = cause != null;

    if (isUnreadable) {
      return emptyCloudState();
    }

    throw cause;
  }
}

async function writeCloudState(cloudState: CloudState): Promise<void> {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  const cloudStateFilePath = resolveCloudStateFilePath();
  await mkdir(launchHomeDirectory, { recursive: true });
  await writeFile(cloudStateFilePath, `${JSON.stringify(cloudState, null, 2)}\n`);
  await chmod(cloudStateFilePath, 0o600);
}

export async function getLiveHost(): Promise<HostHandle | null> {
  const cloudState = await readCloudState();

  if (cloudState.host == null) {
    return null;
  }

  return cloudState.host;
}

export async function setLiveHost(hostHandle: HostHandle): Promise<void> {
  const cloudState = await readCloudState();
  await writeCloudState({ ...cloudState, host: hostHandle });
}

export async function clearLiveHost(): Promise<void> {
  const cloudState = await readCloudState();

  if (cloudState.amiId == null) {
    await writeCloudState(emptyCloudState());
    return;
  }

  await writeCloudState({ amiId: cloudState.amiId });
}

export async function getAmiId(): Promise<string | null> {
  const cloudState = await readCloudState();

  if (cloudState.amiId == null) {
    return null;
  }

  return cloudState.amiId;
}

export async function setAmiId(amiId: string): Promise<void> {
  const cloudState = await readCloudState();
  await writeCloudState({ ...cloudState, amiId });
}
