import { Effect } from 'effect';
import { makeProviderInputFailure, type ComputeHost } from '@core/types/providers.js';
import type { AllocateRequest, HostHandle, HostStatus, SshTarget } from '@core/types/remote.js';
/** Default SSH login user for the common EC2 Mac case; overridden by `user@` in the target string. */
const DEFAULT_USER = 'ec2-user';
/**
 * Parse a `user@host[:port]` (or bare `host`) connection string into an {@link SshTarget}.
 * Exported so the CLI can validate `--remote <ssh>` before doing any work.
 */
export const parseSshTarget = (spec: string): Effect.Effect<SshTarget, unknown> =>
  Effect.gen(function* () {
    const trimmed = spec.trim();
    if (trimmed.length === 0) {
      return yield* Effect.fail(
        makeProviderInputFailure({
          provider: 'byo-ssh',
          message: 'Empty SSH target. Use the form user@host or user@host:port.',
        }),
      );
    }
    const at = trimmed.indexOf('@');
    let user = DEFAULT_USER;
    if (at !== -1) user = trimmed.slice(0, at);
    let hostPort = trimmed;
    if (at !== -1) hostPort = trimmed.slice(at + 1);
    const colon = hostPort.lastIndexOf(':');
    let host = hostPort;
    if (colon !== -1) host = hostPort.slice(0, colon);
    let port = 22;
    if (colon !== -1) port = Number.parseInt(hostPort.slice(colon + 1), 10);
    if (host.length === 0) {
      return yield* Effect.fail(
        makeProviderInputFailure({
          provider: 'byo-ssh',
          message: `Could not parse a host from "${spec}". Use user@host or user@host:port.`,
        }),
      );
    }
    if (Number.isNaN(port)) {
      return yield* Effect.fail(
        makeProviderInputFailure({
          provider: 'byo-ssh',
          message: `Invalid port in "${spec}".`,
        }),
      );
    }
    return { host, user, port };
  });
export const byoSshComputeHost: ComputeHost = {
  name: 'byo-ssh',
  allocate(request: AllocateRequest) {
    const sshTarget = request.sshTarget;
    if (sshTarget === undefined) {
      return Effect.fail(
        makeProviderInputFailure({
          provider: 'byo-ssh',
          message: 'byo-ssh needs an SSH target - pass `--remote user@host`.',
        }),
      );
    }
    return Effect.gen(function* () {
      const ssh = yield* parseSshTarget(sshTarget);
      const reportProgress = request.onProgress;
      if (reportProgress !== undefined) {
        yield* Effect.sync(() =>
          reportProgress(`Using your Mac at ${ssh.user}@${ssh.host}:${ssh.port}`),
        );
      }
      return { provider: 'byo-ssh', ssh, allocatedAt: new Date().toISOString() };
    });
  },
  status(handle: HostHandle) {
    const ageMs = Date.now() - new Date(handle.allocatedAt).getTime();
    // A borrowed Mac is never billed by Launch and is always "releasable" (we just stop using it).
    const hostStatus: HostStatus = {
      handle,
      ageMs,
      estimatedCostUsd: 0,
      releasableAt: handle.allocatedAt,
    };
    return Effect.succeed(hostStatus);
  },
  teardown() {
    return Effect.void;
  },
};
