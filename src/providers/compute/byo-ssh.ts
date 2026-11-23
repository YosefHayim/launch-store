// Treats a developer-owned Mac, reached by secure shell, as a build machine Launch leaves running.

import { makeProviderInputFailure, type ComputeHost } from '@/types/providers.js';
import type { AllocateRequest, HostHandle, HostStatus, SshTarget } from '@/types/remote.js';

export function parseSshTarget(spec: string): SshTarget {
  const trimmed = spec.trim();

  const isBlank = trimmed.length == 0;

  if (isBlank) {
    throw makeProviderInputFailure({
      provider: 'byo-ssh',
      message: 'Empty SSH target. Use the form user@host or user@host:port.',
    });
  }

  const at = trimmed.indexOf('@');
  let user = 'ec2-user';

  const hasUser = at != -1;

  if (hasUser) {
    user = trimmed.slice(0, at);
  }

  let hostPort = trimmed;

  if (hasUser) {
    hostPort = trimmed.slice(at + 1);
  }

  const colon = hostPort.lastIndexOf(':');
  let host = hostPort;

  const hasPort = colon != -1;

  if (hasPort) {
    host = hostPort.slice(0, colon);
  }

  let port = 22;

  if (hasPort) {
    port = Number.parseInt(hostPort.slice(colon + 1), 10);
  }

  const isHostMissing = host.length == 0;

  if (isHostMissing) {
    throw makeProviderInputFailure({
      provider: 'byo-ssh',
      message: `Could not parse a host from "${spec}". Use user@host or user@host:port.`,
    });
  }

  const isPortInvalid = Number.isNaN(port);

  if (isPortInvalid) {
    throw makeProviderInputFailure({
      provider: 'byo-ssh',
      message: `Invalid port in "${spec}".`,
    });
  }

  return { host, user, port };
}

async function allocateByoHost(request: AllocateRequest): Promise<HostHandle> {
  const sshTarget = request.sshTarget;

  if (sshTarget == null) {
    throw makeProviderInputFailure({
      provider: 'byo-ssh',
      message: 'byo-ssh needs an SSH target - pass `--remote user@host`.',
    });
  }

  const ssh = parseSshTarget(sshTarget);
  const reportProgress = request.onProgress;

  if (reportProgress != null) {
    reportProgress(`Using your Mac at ${ssh.user}@${ssh.host}:${ssh.port}`);
  }

  return { provider: 'byo-ssh', ssh, allocatedAt: new Date().toISOString() };
}

function readByoStatus(handle: HostHandle): HostStatus {
  const ageMilliseconds = Date.now() - new Date(handle.allocatedAt).getTime();

  return {
    handle,
    ageMs: ageMilliseconds,
    estimatedCostUsd: 0,
    releasableAt: handle.allocatedAt,
  };
}

async function teardownByoHost(): Promise<void> {
  return;
}

export const byoSshComputeHost: ComputeHost = {
  name: 'byo-ssh',
  allocate: allocateByoHost,
  status(handle) {
    const byoStatus = readByoStatus(handle);
    return Promise.resolve(byoStatus);
  },
  teardown: teardownByoHost,
};
