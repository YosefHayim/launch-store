import { Effect } from 'effect';
import {
  captureCommandOutput,
  type CommandExecutionOptions,
  executeCommand,
  provideNodeCommandServices,
} from './exec.js';
import type { SshTarget } from '../types/remote.js';
/** `user@host` for ssh/scp/rsync destinations. */
const userHost = (target: SshTarget): string => {
  return `${target.user}@${target.host}`;
};
/** Shared ssh `-o` options + key, plus the lowercase `-p <port>` ssh uses. */
const sshFlags = (target: SshTarget): string[] => {
  const flags = [
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=30',
  ];
  if (target.identityFile) flags.push('-i', target.identityFile);
  flags.push('-p', String(target.port));
  return flags;
};
/** scp shares the ssh options but spells the port `-P` (uppercase). */
const scpFlags = (target: SshTarget): string[] => {
  const flags = [
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=30',
  ];
  if (target.identityFile) flags.push('-i', target.identityFile);
  flags.push('-P', String(target.port));
  return flags;
};
/** Run a command on the remote host, streaming output. `remoteCommand` runs in the remote shell. */
export const sshRun = (
  target: SshTarget,
  remoteCommand: string,
  options: CommandExecutionOptions = {},
) => {
  return provideNodeCommandServices(
    executeCommand('ssh', [...sshFlags(target), userHost(target), remoteCommand], options),
  );
};
/** Run a command on the remote host and return its trimmed stdout. */
export const sshCapture = (
  target: SshTarget,
  remoteCommand: string,
  options: CommandExecutionOptions = {},
) => {
  return provideNodeCommandServices(
    captureCommandOutput('ssh', [...sshFlags(target), userHost(target), remoteCommand], options),
  );
};
/** Copy a local file UP to `remotePath` on the host. */
export const scpUp = (target: SshTarget, localPath: string, remotePath: string) => {
  return provideNodeCommandServices(
    executeCommand('scp', [...scpFlags(target), localPath, `${userHost(target)}:${remotePath}`]),
  );
};
/** Copy `remotePath` DOWN from the host to a local path. */
export const scpDown = (target: SshTarget, remotePath: string, localPath: string) => {
  return provideNodeCommandServices(
    executeCommand('scp', [...scpFlags(target), `${userHost(target)}:${remotePath}`, localPath]),
  );
};
/**
 * rsync a local directory UP to the remote over the same ssh transport, honoring an exclude list.
 *
 * `--delete` keeps the remote copy an exact mirror; the trailing slashes copy the directory's
 * CONTENTS into `remoteDir`. The `-e` value is one string rsync re-parses to launch ssh.
 */
export const rsyncUp = (
  target: SshTarget,
  localDir: string,
  remoteDir: string,
  excludes: string[],
) => {
  const sshCommand = ['ssh', ...sshFlags(target)].join(' ');
  const args = ['-az', '--delete', '-e', sshCommand];
  for (const exclude of excludes) args.push('--exclude', exclude);
  args.push(`${localDir}/`, `${userHost(target)}:${remoteDir}/`);
  return provideNodeCommandServices(executeCommand('rsync', args));
};
/** Whether the host answers over SSH right now (used while waiting for a fresh instance to boot). */
export const sshReachable = (target: SshTarget): Effect.Effect<boolean> =>
  sshCapture(target, 'echo ok').pipe(
    Effect.as(true),
    Effect.catchAll(() => Effect.succeed(false)),
  );
