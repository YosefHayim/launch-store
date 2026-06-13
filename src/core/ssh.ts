/**
 * SSH transport for remote-Mac builds.
 *
 * Thin, safe wrappers over `ssh` / `scp` / `rsync` that every {@link ComputeHost} and the remote
 * build pipeline share, so the way Launch talks to a remote Mac lives in exactly one place. Like the
 * rest of Launch, the LOCAL invocation uses `shell: false` + an argument array (via `core/exec.ts`);
 * the single remote-command string is necessarily interpreted by the remote shell, so callers build
 * those from Launch-controlled paths and quote any interpolated values.
 *
 * Defaults chosen for an automated tool: `BatchMode=yes` (key-only, never prompt for a password) and
 * `StrictHostKeyChecking=accept-new` (trust a first-seen host, but refuse if a known key changed).
 */

import { run, capture, type ExecOptions } from "./exec.js";
import type { SshTarget } from "./types.js";

/** `user@host` for ssh/scp/rsync destinations. */
function userHost(target: SshTarget): string {
  return `${target.user}@${target.host}`;
}

/** Shared ssh `-o` options + key, plus the lowercase `-p <port>` ssh uses. */
function sshFlags(target: SshTarget): string[] {
  const flags = ["-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ConnectTimeout=30"];
  if (target.identityFile) flags.push("-i", target.identityFile);
  flags.push("-p", String(target.port));
  return flags;
}

/** scp shares the ssh options but spells the port `-P` (uppercase). */
function scpFlags(target: SshTarget): string[] {
  const flags = ["-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ConnectTimeout=30"];
  if (target.identityFile) flags.push("-i", target.identityFile);
  flags.push("-P", String(target.port));
  return flags;
}

/** Run a command on the remote host, streaming output. `remoteCommand` runs in the remote shell. */
export function sshRun(target: SshTarget, remoteCommand: string, options: ExecOptions = {}): Promise<void> {
  return run("ssh", [...sshFlags(target), userHost(target), remoteCommand], options);
}

/** Run a command on the remote host and return its trimmed stdout. */
export function sshCapture(target: SshTarget, remoteCommand: string, options: ExecOptions = {}): Promise<string> {
  return capture("ssh", [...sshFlags(target), userHost(target), remoteCommand], options);
}

/** Copy a local file UP to `remotePath` on the host. */
export function scpUp(target: SshTarget, localPath: string, remotePath: string): Promise<void> {
  return run("scp", [...scpFlags(target), localPath, `${userHost(target)}:${remotePath}`]);
}

/** Copy `remotePath` DOWN from the host to a local path. */
export function scpDown(target: SshTarget, remotePath: string, localPath: string): Promise<void> {
  return run("scp", [...scpFlags(target), `${userHost(target)}:${remotePath}`, localPath]);
}

/**
 * rsync a local directory UP to the remote over the same ssh transport, honoring an exclude list.
 *
 * `--delete` keeps the remote copy an exact mirror; the trailing slashes copy the directory's
 * CONTENTS into `remoteDir`. The `-e` value is one string rsync re-parses to launch ssh.
 */
export function rsyncUp(target: SshTarget, localDir: string, remoteDir: string, excludes: string[]): Promise<void> {
  const sshCommand = ["ssh", ...sshFlags(target)].join(" ");
  const args = ["-az", "--delete", "-e", sshCommand];
  for (const exclude of excludes) args.push("--exclude", exclude);
  args.push(`${localDir}/`, `${userHost(target)}:${remoteDir}/`);
  return run("rsync", args);
}

/** Whether the host answers over SSH right now (used while waiting for a fresh instance to boot). */
export async function sshReachable(target: SshTarget): Promise<boolean> {
  try {
    await sshCapture(target, "echo ok");
    return true;
  } catch {
    return false;
  }
}
