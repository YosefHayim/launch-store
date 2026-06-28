/**
 * `launch store doctor` — a read-only store-**account** readiness check, distinct from `launch doctor`
 * (which checks the local iOS/Android toolchain). Submissions silently fail on account-level
 * prerequisites that have nothing to do with the build: a missing App Store Connect app record, no
 * uploaded build on Play, an unauthorized service account. This command grades those up front.
 *
 * It owns no check logic of its own — it resolves credentials (via the shared `core/storeClients.ts`
 * resolvers), selects the `account`-tagged probes from the readiness registry, runs them, and renders the
 * result. `--json` plus the documented exit codes (0 ready · 2 blockers · 1 unreadable, error wins) make
 * it scriptable. New account checks are new probe files, never edits here. See issue #170.
 */

import type { Command } from 'commander';
import { runReadinessCommand } from './readinessReport.js';

/** CLI options for `launch store doctor`. */
interface StoreDoctorOptions {
  /** Comma-separated app handles; default is every discovered app. */
  app?: string;
  /** Machine-readable output (the full {@link import("../../core/readiness/types.js").ReadinessOutcome}) for CI/agents. */
  json?: boolean;
}

/**
 * Run the store-doctor flow over the `account` probe slice — the family's shared run, voiced for store-account
 * readiness. Exported so a test (or a future caller) can drive it directly.
 */
export async function runStoreDoctor(input: StoreDoctorOptions): Promise<void> {
  await runReadinessCommand({
    category: 'account',
    labels: {
      summary: 'Store readiness',
      empty: 'No store-readiness checks ran — no apps with a bundle id or package name were found.',
    },
    ...input,
  });
}

/**
 * Attach the `store` command group and its `doctor` subcommand to the program. `store` is a namespace for
 * store-account operations (today just `doctor`); keeping it a group leaves room without crowding the
 * top-level surface, and keeps `launch store doctor` unmistakably separate from `launch doctor`.
 */
export function registerStoreCommand(program: Command): void {
  const store = program.command('store').description('store-account readiness and operations');
  store
    .command('doctor')
    .description(
      'check store-account readiness: Apple app record, Play onboarding & access (read-only)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(async (options: StoreDoctorOptions) => {
      await runStoreDoctor(options);
    });
}
