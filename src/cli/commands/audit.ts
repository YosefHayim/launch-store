/**
 * `launch audit` — a read-only pre-submit readiness sweep. Where `launch store doctor` grades account
 * *onboarding* and `launch doctor` checks the local *toolchain*, audit answers one question across both
 * stores: "if I submitted right now, would anything bounce it back?" It selects every `submit`-tagged probe
 * from the readiness registry — app record, Bundle ID registration, distribution-certificate validity,
 * export-compliance declaration, Play app access — runs them, and renders the verdict.
 *
 * It owns no check logic: probes are the unit, audit is a thin selector over the `submit` tag, so a new
 * submission blocker becomes one tagged probe and audit picks it up with no edit here. `--json` plus the
 * shared exit codes (0 clear · 2 blockers · 1 unreadable, error wins) make it a CI/pre-release gate. See #168.
 */

import type { Command } from 'commander';
import { runReadinessCommand } from './readinessReport.js';

/** CLI options for `launch audit`. */
interface AuditOptions {
  /** Comma-separated app handles; default is every discovered app. */
  app?: string;
  /** Machine-readable output (the full {@link import("../../core/types.js").ReadinessOutcome}) for CI/agents. */
  json?: boolean;
}

/**
 * Run the audit flow over the `submit` probe slice — the family's shared run, voiced for pre-submit. Exported
 * so a test (or a future caller) can drive it directly.
 */
export async function runAudit(input: AuditOptions): Promise<void> {
  await runReadinessCommand({
    category: 'submit',
    labels: {
      summary: 'Pre-submit audit',
      empty: 'No audit checks ran — no apps with a bundle id or package name were found.',
    },
    ...input,
  });
}

/** Attach the top-level `audit` command to the program. */
export function registerAuditCommand(program: Command): void {
  program
    .command('audit')
    .description(
      'pre-submit readiness sweep: would a submission be rejected right now? (read-only)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(async (options: AuditOptions) => {
      await runAudit(options);
    });
}
