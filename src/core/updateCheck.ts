/**
 * Silent self-upgrade: when a newer `launch-store` is on npm, upgrade the global install under a
 * spinner and re-run the user's command on the new version — no confirmation prompt.
 *
 * Because a silent global mutation is risky, it's heavily guarded (see {@link autoUpgradeBlockedReason}):
 * only an interactive, non-CI, installed (not `tsx`-from-source) run upgrades; the registry is polled at
 * most once/24h (cached in `~/.launch/update.json`); a re-exec loop is impossible (the child carries
 * `LAUNCH_UPGRADED=1`); and a non-writable global dir (`EACCES`) degrades to a printed notice instead of
 * failing. The decision logic is pure + injectable so every branch is unit-tested with no real network,
 * npm, or process replacement.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { spinner } from '@clack/prompts';
import { LAUNCH_HOME, ensureDir } from './paths.js';
import { capture } from './exec.js';

/** The published package name (the `launch` bin's npm package). */
const PACKAGE_NAME = 'launch-store';

/** Poll the registry at most this often. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Cap the registry request so a slow/offline network never delays the CLI. */
const FETCH_TIMEOUT_MS = 1500;

/** Throttle state persisted to `~/.launch/update.json`. */
export interface UpdateState {
  /** Epoch ms of the last registry check. */
  lastCheckedAt: number;
  /** Latest version seen at that check (kept for a future offline notice). */
  latestSeen?: string;
}

/** Outcome of attempting the global upgrade. */
export type UpgradeResult = 'upgraded' | 'eacces' | 'failed';

/** Narrow an unknown (parsed JSON) to a plain object, mirroring `core/config.ts`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** Parse a dotted version into a `[major, minor, patch]` tuple, ignoring any pre-release/build suffix. */
function versionParts(version: string): [number, number, number] {
  const nums = version.replace(/^v/, '').split(/[.+-]/);
  return [Number(nums[0]) || 0, Number(nums[1]) || 0, Number(nums[2]) || 0];
}

/** True when `latest` is a strictly higher version than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const [a0, a1, a2] = versionParts(latest);
  const [b0, b1, b2] = versionParts(current);
  if (a0 !== b0) return a0 > b0;
  if (a1 !== b1) return a1 > b1;
  return a2 > b2;
}

/** Whether enough time has passed (or there's no prior state) to poll the registry again. */
export function shouldCheck(
  now: number,
  state: UpdateState | null,
  intervalMs: number = CHECK_INTERVAL_MS,
): boolean {
  return !state || now - state.lastCheckedAt >= intervalMs;
}

/**
 * Why an auto-upgrade is suppressed, or null to proceed. Pure so every guard is unit-tested.
 * Order matters: the loop guard and explicit opt-out come before the environment heuristics.
 */
export function autoUpgradeBlockedReason(input: {
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
  scriptPath: string;
}): string | null {
  if (input.env['LAUNCH_UPGRADED'] === '1')
    return 'already re-executed after an upgrade (loop guard)';
  if (input.env['LAUNCH_NO_UPGRADE']) return 'LAUNCH_NO_UPGRADE is set';
  if (input.env['CI']) return 'running in CI';
  if (!input.isTTY) return 'not an interactive terminal (piped, agent, or background)';
  if (input.scriptPath.endsWith('.ts')) return 'running from source (dev)';
  return null;
}

/** Everything {@link maybeAutoUpgrade} touches, injected so the orchestration is testable. */
export interface UpdateCheckDeps {
  now(): number;
  currentVersion: string;
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
  scriptPath: string;
  readState(): UpdateState | null;
  writeState(state: UpdateState): void;
  fetchLatest(): Promise<string | null>;
  /** Perform the global upgrade; `current`/`latest` label the progress spinner. */
  upgrade(current: string, latest: string): Promise<UpgradeResult>;
  reexec(): void;
  notify(message: string): void;
}

/**
 * Decide and (silently) perform a self-upgrade. Returns without effect when guarded, throttled, or
 * already up to date; on a newer version it upgrades and re-execs, falling back to a printed notice
 * when the global install isn't writable.
 */
export async function maybeAutoUpgrade(deps: UpdateCheckDeps): Promise<void> {
  if (autoUpgradeBlockedReason({ env: deps.env, isTTY: deps.isTTY, scriptPath: deps.scriptPath }))
    return;
  if (!shouldCheck(deps.now(), deps.readState())) return;

  const latest = await deps.fetchLatest();
  deps.writeState({ lastCheckedAt: deps.now(), ...(latest ? { latestSeen: latest } : {}) });
  if (!latest || !isNewer(latest, deps.currentVersion)) return;

  const result = await deps.upgrade(deps.currentVersion, latest);
  switch (result) {
    case 'upgraded':
      deps.reexec();
      return;
    case 'eacces':
      deps.notify(
        `launch ${latest} is available but the global install isn't writable — sudo npm i -g ${PACKAGE_NAME}@latest`,
      );
      return;
    case 'failed':
      deps.notify(`launch ${latest} is available — npm i -g ${PACKAGE_NAME}@latest`);
      return;
  }
}

/* ------------------------------ production IO ------------------------------ */

/** Path of the throttle-state cache. */
function statePath(): string {
  return join(LAUNCH_HOME, 'update.json');
}

/** Read the throttle state, or null if absent/corrupt. */
function readState(): UpdateState | null {
  try {
    const raw = asRecord(JSON.parse(readFileSync(statePath(), 'utf8')));
    if (!raw || typeof raw['lastCheckedAt'] !== 'number') return null;
    const state: UpdateState = { lastCheckedAt: raw['lastCheckedAt'] };
    if (typeof raw['latestSeen'] === 'string') state.latestSeen = raw['latestSeen'];
    return state;
  } catch {
    return null;
  }
}

/** Persist the throttle state; a cache-write failure must never break the CLI. */
function writeState(state: UpdateState): void {
  try {
    ensureDir(LAUNCH_HOME);
    writeFileSync(statePath(), JSON.stringify(state));
  } catch {
    /* best-effort cache */
  }
}

/** Fetch the latest published version from the npm registry, or null on any error/timeout. */
async function fetchLatestVersion(pkg: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const version = asRecord(await response.json())?.['version'];
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the global upgrade under a spinner, classifying a permission failure so the caller can degrade
 * to a notice. Uses the same `@clack/prompts` spinner as the rest of the CLI, but is result-driven
 * rather than throw-driven so the EACCES-vs-generic distinction survives in the return value. Always
 * called on an interactive TTY (auto-upgrade is otherwise blocked), so a spinner is the right
 * affordance here.
 */
async function performUpgrade(current: string, latest: string): Promise<UpgradeResult> {
  const progress = spinner();
  progress.start(`Upgrading launch ${current} → ${latest}`);
  try {
    await capture('npm', ['install', '-g', `${PACKAGE_NAME}@latest`]);
    progress.stop(`launch upgraded to ${latest} — relaunching`);
    return 'upgraded';
  } catch (error) {
    progress.error(`launch ${latest} available — automatic upgrade failed`);
    const message = error instanceof Error ? error.message : String(error);
    return /EACCES|permission denied/i.test(message) ? 'eacces' : 'failed';
  }
}

/** Re-run the original command on the now-upgraded binary, tagging the child to prevent an upgrade loop. */
function reexecLaunch(): void {
  const result = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, LAUNCH_UPGRADED: '1' },
  });
  process.exit(result.status ?? 0);
}

/**
 * Entry point wired into the CLI: run the guarded, throttled self-upgrade. Swallows all errors —
 * update checking is never allowed to break a command.
 */
export async function runAutoUpgrade(currentVersion: string): Promise<void> {
  try {
    await maybeAutoUpgrade({
      now: () => Date.now(),
      currentVersion,
      env: process.env,
      isTTY: process.stdout.isTTY,
      scriptPath: process.argv[1] ?? '',
      readState,
      writeState,
      fetchLatest: () => fetchLatestVersion(PACKAGE_NAME),
      upgrade: performUpgrade,
      reexec: reexecLaunch,
      // Deliberate stderr write, not the logger seam: the update banner is a notice (not an error, so
      // not log.error's ✗) that must stay off stdout so `launch --version` and piped output are clean.
      notify: (message) => {
        console.error(message);
      },
    });
  } catch {
    /* update checking must never break the CLI */
  }
}
