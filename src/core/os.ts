/**
 * Host operating-system detection.
 *
 * One place to answer "what am I running on?" so the wizard and build commands route correctly:
 * iOS code signing is macOS-only, so a non-Mac host must build remotely (AWS EC2 Mac / a Mac over
 * SSH) or hand off to Expo EAS. Centralized here rather than scattering `process.platform` checks.
 */

import { Effect } from 'effect';
import { cpus, platform, totalmem } from 'node:os';
import type { HostOs } from './types.js';

/**
 * The host's compile-relevant resources: logical-core count and total RAM. The build-parallelism
 * cap ({@link import("./buildFlags.js").computeParallelJobLimit}) reads this single source rather
 * than reaching into `node:os`.
 */
export const readHostResources = Effect.sync(() => ({
  cores: cpus().length,
  memoryBytes: totalmem(),
}));

/**
 * Resolve the current {@link HostOs} from Node's platform string.
 * Anything non-darwin/win32 is treated as linux.
 */
export const detectHostOperatingSystem = Effect.sync((): HostOs => {
  switch (platform()) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    default:
      return 'linux';
  }
});

/** True when Launch can sign and build iOS locally (i.e. running on macOS). */
export const checkIsMacOperatingSystem = Effect.map(
  detectHostOperatingSystem,
  (operatingSystem) => operatingSystem === 'macos',
);

/** A short, human label for the host OS — used in wizard copy and `cloud doctor`. */
export const resolveHostOperatingSystemLabel = Effect.map(
  detectHostOperatingSystem,
  (operatingSystem): string => {
    switch (operatingSystem) {
      case 'macos':
        return 'macOS';
      case 'windows':
        return 'Windows';
      case 'linux':
        return 'Linux';
    }
  },
);

// ─── Imperative shims (callers migrate progressively) ──────────────────────

/** Imperative shim — use {@link readHostResources} in new code. */
export function hostResources(): { cores: number; memBytes: number } {
  return { cores: cpus().length, memBytes: totalmem() };
}

/** Imperative shim — use {@link detectHostOperatingSystem} in new code. */
export function hostOs(): HostOs {
  switch (platform()) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    default:
      return 'linux';
  }
}

/** Imperative shim — use {@link checkIsMacOperatingSystem} in new code. */
export function isMac(): boolean {
  return hostOs() === 'macos';
}

/** Imperative shim — use {@link resolveHostOperatingSystemLabel} in new code. */
export function hostOsLabel(): string {
  switch (hostOs()) {
    case 'macos':
      return 'macOS';
    case 'windows':
      return 'Windows';
    case 'linux':
      return 'Linux';
  }
}
