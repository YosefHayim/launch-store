/**
 * `launch fingerprint` — show the native build fingerprint and why the next build will be clean or
 * incremental (the EAS `fingerprint` / `fingerprint:compare` analogue).
 *
 * Launch decides clean-vs-incremental by hashing the inputs that move the native graph (the resolved
 * Pods, the Expo native config slice, the Xcode version) and comparing that hash to the one stored
 * after the last successful build — see `core/buildFingerprint.ts`. This command surfaces that hidden
 * decision: the current fingerprint, the last build's, and the verdict + reason, so a surprise clean
 * rebuild ("why is this slow again?") is explainable instead of mysterious. iOS only — Gradle tracks
 * its own task inputs, so Android needs no separate fingerprint. Read-only: it computes, never builds.
 */

import { join } from 'node:path';
import type { Command } from 'commander';
import type { Platform } from '../../core/types.js';
import { loadConfig } from '../../core/config.js';
import { selectApp } from '../../core/pipeline.js';
import {
  type BuildState,
  type CleanDecision,
  gatherIosFingerprint,
  readBuildState,
  resolveClean,
} from '../../core/buildFingerprint.js';

/**
 * The fingerprint picture for one app: the freshly-computed hash, the last build's stored state (or
 * null on a host that's never built it), and the clean-vs-incremental verdict the next build would take.
 */
export interface FingerprintReport {
  app: string;
  platform: Platform;
  /** The fingerprint of the current working tree's native inputs. */
  current: string;
  /** State persisted after the last successful build on this host, or null. */
  stored: BuildState | null;
  /** What the next build would do, and why. */
  decision: CleanDecision;
}

/** First 12 hex chars — enough to compare fingerprints by eye without dumping the full 64. */
function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

/** Render a {@link FingerprintReport} as a human-readable block. */
export function formatFingerprintReport(report: FingerprintReport): string {
  const lastBuild = report.stored
    ? `${shortHash(report.stored.fingerprint)}  (${report.stored.builtAt}, ${report.stored.cleanBuilt ? 'clean' : 'incremental'})`
    : 'none on this host yet';
  const verdict = report.decision.clean
    ? 'clean (from scratch)'
    : 'incremental (reuses warm caches)';
  return [
    `App:                 ${report.app} (${report.platform})`,
    `Current fingerprint: ${shortHash(report.current)}`,
    `Last build:          ${lastBuild}`,
    `Next build:          ${verdict} — ${report.decision.reason}`,
  ].join('\n');
}

/** Attach the `fingerprint` command to the program. */
export function registerFingerprintCommand(program: Command): void {
  program
    .command('fingerprint')
    .description('show the native fingerprint and why the next build is clean or incremental (iOS)')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--json', 'output machine-readable JSON', false)
    .action(async (options: { app?: string; json: boolean }) => {
      const { apps } = await loadConfig();
      const app = await selectApp(apps, options.app);
      if (!app.bundleId) {
        console.log(
          `${app.name} has no iOS bundle id — fingerprints are iOS-only (Gradle tracks Android build inputs itself).`,
        );
        return;
      }

      const current = await gatherIosFingerprint(join(app.dir, 'ios'), app.configPath);
      const stored = readBuildState(app.name, 'ios');
      const report: FingerprintReport = {
        app: app.name,
        platform: 'ios',
        current,
        stored,
        decision: resolveClean(false, stored, current),
      };
      console.log(options.json ? JSON.stringify(report, null, 2) : formatFingerprintReport(report));
    });
}
