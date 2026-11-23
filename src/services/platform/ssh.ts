// Runs a command and copies files on a remote build Mac over a secure shell.

import { captureCommandOutput, type CommandExecutionOptions, executeCommand } from './execute-command.ts';
import type { SshTarget } from '@/types/remote.js';

/** `user@host` for ssh/scp/rsync destinations. */
function userHost(target: SshTarget): string {
  return `${target.user}@${target.host}`;
}

/** Shared ssh `-o` options + key, plus the lowercase `-p <port>` ssh uses. */
function sshFlags(target: SshTarget): string[] {
  const flags = [
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=30',
  ];

  if (target.identityFile) flags.push('-i', target.identityFile);

  const asString = String(target.port);

  flags.push('-p', asString);

  return flags;
}

/** scp shares the ssh options but spells the port `-P` (uppercase). */
function scpFlags(target: SshTarget): string[] {
  const flags = [
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=30',
  ];

  if (target.identityFile) flags.push('-i', target.identityFile);

  const asString = String(target.port);

  flags.push('-P', asString);

  return flags;
}

/** Run a command on the remote host, streaming output. `remoteCommand` runs in the remote shell. */
export function sshRun(
  target: SshTarget,
  remoteCommand: string,
  options: CommandExecutionOptions = {},
): Promise<void> {
  return executeCommand('ssh', [...sshFlags(target), userHost(target), remoteCommand], options);
}

/** Run a command on the remote host and return its trimmed stdout. */
export function sshCapture(
  target: SshTarget,
  remoteCommand: string,
  options: CommandExecutionOptions = {},
): Promise<string> {
  return captureCommandOutput(
    'ssh',
    [...sshFlags(target), userHost(target), remoteCommand],
    options,
  );
}

/** Copy a local file UP to `remotePath` on the host. */
export function scpUp(target: SshTarget, localPath: string, remotePath: string): Promise<void> {
  return executeCommand('scp', [
    ...scpFlags(target),
    localPath,
    `${userHost(target)}:${remotePath}`,
  ]);
}

/** Copy `remotePath` DOWN from the host to a local path. */
export function scpDown(target: SshTarget, remotePath: string, localPath: string): Promise<void> {
  return executeCommand('scp', [
    ...scpFlags(target),
    `${userHost(target)}:${remotePath}`,
    localPath,
  ]);
}

/** rsync a local directory UP to the remote over the same ssh transport */
export function rsyncUp(
  target: SshTarget,
  localDir: string,
  remoteDir: string,
  excludes: readonly string[],
) {
  const sshCommand = ['ssh', ...sshFlags(target)].join(' ');
  const args = ['-az', '--delete', '-e', sshCommand];

  for (const exclude of excludes) args.push('--exclude', exclude);

  args.push(`${localDir}/`, `${userHost(target)}:${remoteDir}/`);

  return executeCommand('rsync', args);
}

export async function sshReachable(target: SshTarget): Promise<boolean> {
  try {
    await sshCapture(target, 'echo ok');
  } catch (error) {
    const isUnreachable = error != null;

    if (isUnreachable) {
      return false;
    }

    throw error;
  }

  return true;
}
