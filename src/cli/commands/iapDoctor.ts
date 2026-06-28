/**
 * `launch iap doctor` — a read-only in-app-purchase readiness check, the third command in the trust-layer
 * family. IAP is the most error-prone surface to ship: "the build is green" says nothing about whether a
 * purchase actually works in production, because a product can be undeclared, missing metadata, or unpriced
 * on App Store Connect while the app references it at runtime. This command grades each declared product and
 * subscription against its live counterpart up front.
 *
 * Like `store doctor` and `audit`, it owns no check logic: it resolves credentials via the shared
 * `core/storeClients.ts` resolvers, selects the `iap`-tagged probes from the readiness registry, runs them,
 * and renders. `--json` plus the shared exit codes (0 ready · 2 blockers · 1 unreadable, error wins) make it
 * a CI/pre-release gate. New IAP checks are new probe files, never edits here. See issue #174.
 */

import type { Command } from 'commander';
import { runReadinessCommand } from './readinessReport.js';

/** CLI options for `launch iap doctor`. */
interface IapDoctorOptions {
  /** Comma-separated app handles; default is every discovered app. */
  app?: string;
  /** Machine-readable output (the full {@link import("../../core/readiness/types.js").ReadinessOutcome}) for CI/agents. */
  json?: boolean;
}

/**
 * Run the iap-doctor flow over the `iap` probe slice — the family's shared run, voiced for in-app-purchase
 * readiness. Exported so a test (or a future caller) can drive it directly.
 */
export async function runIapDoctor(input: IapDoctorOptions): Promise<void> {
  await runReadinessCommand({
    category: 'iap',
    labels: {
      summary: 'IAP readiness',
      empty: 'No IAP checks ran — no apps declare in-app purchases or subscriptions.',
    },
    ...input,
  });
}

/**
 * Attach the `iap` command group and its `doctor` subcommand to the program. `iap` is a namespace for
 * in-app-purchase operations (today just `doctor`); keeping it a group leaves room to grow without crowding
 * the top-level surface.
 */
export function registerIapCommand(program: Command): void {
  const iap = program.command('iap').description('in-app-purchase readiness and operations');
  iap
    .command('doctor')
    .description(
      'check in-app-purchase readiness: products & subscriptions exist and are submittable (read-only)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(async (options: IapDoctorOptions) => {
      await runIapDoctor(options);
    });
}
