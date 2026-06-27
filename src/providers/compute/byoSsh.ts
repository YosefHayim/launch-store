/**
 * The `byo-ssh` compute host — "build on a Mac I already have".
 *
 * The trivial {@link ComputeHost} the generic SSH core enables for free: it wraps a `user@host[:port]`
 * you supply (a colleague's Mac, a MacStadium box, a hand-launched EC2 instance) into a {@link HostHandle}
 * with nothing to allocate, bill, or release. Launch only borrows the connection — `teardown` is a no-op
 * and the accrued cost is always $0. This is what makes the remote pipeline testable without any AWS.
 */

import type {
  AllocateRequest,
  ComputeHost,
  HostHandle,
  HostStatus,
  SshTarget,
} from '../../core/types.js';

/** Default SSH login user for the common EC2 Mac case; overridden by `user@` in the target string. */
const DEFAULT_USER = 'ec2-user';

/**
 * Parse a `user@host[:port]` (or bare `host`) connection string into an {@link SshTarget}.
 * Exported so the CLI can validate `--remote <ssh>` before doing any work.
 */
export function parseSshTarget(spec: string): SshTarget {
  const trimmed = spec.trim();
  if (!trimmed) throw new Error('Empty SSH target. Use the form user@host or user@host:port.');
  const at = trimmed.indexOf('@');
  const user = at === -1 ? DEFAULT_USER : trimmed.slice(0, at);
  const hostPort = at === -1 ? trimmed : trimmed.slice(at + 1);
  const colon = hostPort.lastIndexOf(':');
  const host = colon === -1 ? hostPort : hostPort.slice(0, colon);
  const port = colon === -1 ? 22 : Number.parseInt(hostPort.slice(colon + 1), 10);
  if (!host)
    throw new Error(`Could not parse a host from "${spec}". Use user@host or user@host:port.`);
  if (Number.isNaN(port)) throw new Error(`Invalid port in "${spec}".`);
  return { host, user, port };
}

export const byoSshComputeHost: ComputeHost = {
  name: 'byo-ssh',

  async allocate(request: AllocateRequest): Promise<HostHandle> {
    if (!request.sshTarget)
      throw new Error('byo-ssh needs an SSH target — pass `--remote user@host`.');
    const ssh = parseSshTarget(request.sshTarget);
    request.onProgress?.(`Using your Mac at ${ssh.user}@${ssh.host}:${ssh.port}`);
    return { provider: 'byo-ssh', ssh, allocatedAt: new Date().toISOString() };
  },

  async status(handle: HostHandle): Promise<HostStatus> {
    const ageMs = Date.now() - new Date(handle.allocatedAt).getTime();
    // A borrowed Mac is never billed by Launch and is always "releasable" (we just stop using it).
    return { handle, ageMs, estimatedCostUsd: 0, releasableAt: handle.allocatedAt };
  },

  async teardown(): Promise<void> {
    /* nothing to release — Launch never owned the machine */
  },
};
