/**
 * `launch doctor` — preflight check (and, with `--fix`, an installer).
 *
 * Platform-aware. For iOS it verifies the build toolchain (Xcode, Ruby, fastlane, CocoaPods, openssl)
 * and, when an API key is present, the things that otherwise fail deep inside a build: an
 * unsigned/expired Apple agreement, and apps with no App Store Connect record (the one step the API
 * can't create). For Android (`--platform android`) it runs the same philosophy in three tiers: HARD
 * toolchain checks (JDK/keytool, Android SDK, the gradle wrapper, fastlane, bundletool), a PREFLIGHT
 * that the service account can reach each app (deep-linking "Create app" + Play App Signing when not),
 * and WARNINGS for the irreducible Play gates (the new-account testing requirement, sensitive perms).
 *
 * The read-only inspection lives in {@link inspectDoctor} (`core/doctor/inspect.ts`) so the wizard and
 * the `doctor` MCP tool share it; this file only wires the impure {@link DoctorContext} and renders the
 * result. `--fix` (iOS only) stays here: it hands the toolchain check to {@link ensureToolchain}, which
 * asks one consent and installs the missing tools via Homebrew (`--yes` skips the prompt), and reconciles
 * export compliance over the network — both mutate state, so they're not part of the pure read.
 */

import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { ensureToolchain } from '../../core/toolchain.js';
import { AppStoreConnectClient } from '../../apple/ascClient.js';
import { loadActiveAscKey } from '../../core/accounts.js';
import {
  reconcileExportCompliance,
  summarizeExportComplianceResult,
} from '../../core/exportCompliance.js';
import { inspectDoctor } from '../../core/doctor/inspect.js';
import { buildDoctorContext } from '../../core/doctor/context.js';
import { isApplePlatform, parsePlatform } from '../../core/platform.js';
import { selectApps } from '../../core/syncJobs.js';
import type { DoctorCheck, DoctorPlatform, DoctorReport } from '../../core/types.js';

/** Map a check status to its leading glyph. */
const STATUS_GLYPH: Record<DoctorCheck['status'], string> = { ok: '✓', fail: '✗', info: '•' };

/** Print one check: glyph + title, then any indented detail, then the actionable hint. */
function renderCheck(check: DoctorCheck): void {
  const hint = check.status === 'ok' || !check.hint ? '' : `  — ${check.hint}`;
  console.log(`${STATUS_GLYPH[check.status]} ${check.title}${hint}`);
  if (check.detail) {
    for (const line of check.detail.split('\n'))
      console.log(line.startsWith(' ') ? line : `  ${line}`);
  }
}

/** Render a full report to the console in check order. */
function renderDoctorReport(report: DoctorReport): void {
  for (const check of report.checks) renderCheck(check);
}

/**
 * The `--fix` extras, layered AFTER the pure inspection because they mutate state: reconcile each iOS
 * app's export compliance against its latest uploaded build via the App Store Connect API (answering the
 * encryption question, or reusing an approved declaration). Best-effort and advisory — never fails the
 * doctor. The toolchain install is handled separately in {@link runDoctor} via {@link ensureToolchain}.
 */
async function fixExportCompliance(appSelector?: string): Promise<void> {
  const ascKey = await loadActiveAscKey();
  if (!ascKey) return;
  const client = new AppStoreConnectClient(ascKey);
  const { apps } = await loadConfig();
  for (const app of selectApps(apps, appSelector)) {
    if (!app.bundleId || app.usesNonExemptEncryption === undefined) continue;
    try {
      const buildNumber = await client.getLatestBuildNumber(app.bundleId);
      if (buildNumber === 0) continue;
      const result = await reconcileExportCompliance(client, {
        bundleId: app.bundleId,
        buildNumber,
        usesNonExemptEncryption: app.usesNonExemptEncryption,
      });
      console.log(
        `  ↳ ${app.name} build ${buildNumber}: ${summarizeExportComplianceResult(result)}`,
      );
    } catch (error) {
      console.log(
        `  ↳ ${app.name}: could not reconcile export compliance — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Run the doctor preflight for a platform and return whether everything required passed. The body of
 * `launch doctor`, extracted so the no-args wizard's guided setup can run the same checks inline (and so
 * callers can branch on the result instead of only reading a process exit code).
 *
 * With `--fix` (iOS only) it first runs the interactive toolchain install, then the read-only inspection,
 * then the export-compliance network reconcile — the install can flip a `fail` to a pass before the
 * report is graded.
 */
export async function runDoctor(options: {
  platform: DoctorPlatform;
  app?: string;
  fix?: boolean;
  yes?: boolean;
}): Promise<boolean> {
  if (options.platform === 'ios' && options.fix) {
    await ensureToolchain({ assumeYes: options.yes === true });
  }
  const report = await inspectDoctor(await buildDoctorContext(options.platform, options.app));
  renderDoctorReport(report);
  if (options.platform === 'ios' && options.fix) {
    await fixExportCompliance(options.app);
  }
  return report.ok;
}

/** Attach the `doctor` command to the program. */
export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('check that the local toolchain and store account are ready')
    .option('--platform <p>', 'ios (default), android, tvos, macos, or visionos')
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option(
      '--fix',
      'install any missing build tools (Apple platforms only; asks for consent first)',
    )
    .option('--yes', 'skip prompts and proceed with installs (CI/agents)')
    .option('--json', 'machine-readable output for CI/agents')
    .action(
      async (options: {
        platform?: string;
        app?: string;
        fix?: boolean;
        yes?: boolean;
        json?: boolean;
      }) => {
        // doctor's toolchain/account checks are family-level, so every Apple platform reuses the iOS readiness path.
        const platform: DoctorPlatform = isApplePlatform(parsePlatform(options.platform ?? 'ios'))
          ? 'ios'
          : 'android';
        if (options.json === true) {
          const report = await inspectDoctor(await buildDoctorContext(platform, options.app));
          console.log(JSON.stringify(report, null, 2));
          if (!report.ok) process.exitCode = 1;
          return;
        }
        const ok = await runDoctor({
          platform,
          ...(options.app !== undefined ? { app: options.app } : {}),
          fix: options.fix === true,
          yes: options.yes === true,
        });
        if (!ok) process.exitCode = 1;
      },
    );
}
