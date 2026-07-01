/**
 * `launch testflight groups|create-group|testers|add|rm` — manage who can test an app on TestFlight,
 * straight from the CLI.
 *
 * Launch already uploads builds to TestFlight; this is the management layer around it. A tester reaches
 * an app's TestFlight only through one of its beta groups, so every tester operation resolves a group
 * first. Adding a brand-new email creates the tester and sends Apple's invite; an email that already
 * exists on the team is linked into the group rather than duplicated (a re-create would 409).
 *
 * Auth is the same App Store Connect API key the rest of Launch uses — no password, no 2FA. Outward-
 * facing actions (sending invites, removing testers) confirm before running or take `--yes`; `--dry-run`
 * reports exactly what would change and touches no tester.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { cancel, confirm, isCancel } from '@clack/prompts';
import { loadConfig } from '../../core/config.js';
import { selectApp } from '../../core/pipeline.js';
import { loadActiveAscKey } from '../../core/accounts.js';
import { pickOne } from '../../core/prompt.js';
import { createLogger } from '../../core/logger.js';
import { AppStoreConnectClient, type BetaGroupResource } from '../../apple/ascClient.js';
import type { PlannedAction } from '../../core/ascSync.js';
import {
  loadBetaReviewConfig,
  reconcileBetaReview,
  summarizeBetaReview,
} from '../../core/betaReview.js';
import {
  downloadFeedbackAttachments,
  listBetaFeedback,
  type FeedbackFilters,
} from '../../core/testflightFeedback.js';
import type { BetaFeedback, BetaFeedbackKind } from '../../core/types.js';

const log = createLogger(false);

/** One tester to add, parsed from a CLI argument or a CSV row. */
interface TesterInput {
  email: string;
  firstName?: string;
  lastName?: string;
}

/** Options for the tester-mutating subcommands (`add` / `rm`). `first`/`last`/`csv` are add-only. */
interface TesterCommandOptions {
  app?: string;
  group?: string;
  first?: string;
  last?: string;
  csv?: string;
  dryRun?: boolean;
  yes?: boolean;
}

/** Resolve the App Store Connect client for the active account, or fail with the fix. */
async function client(): Promise<AppStoreConnectClient> {
  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error('No active Apple account. Run `launch creds set-key` first.');
  return new AppStoreConnectClient(ascKey);
}

/** Resolve the selected app to its App Store Connect app id, failing with an actionable message. */
async function resolveAppId(
  asc: AppStoreConnectClient,
  appName: string | undefined,
): Promise<{ appId: string; name: string }> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, appName);
  if (!app.bundleId)
    throw new Error(`App "${app.name}" has no iOS bundle identifier (set ios.bundleIdentifier).`);
  const appId = await asc.getAppId(app.bundleId);
  if (!appId) {
    throw new Error(
      `No App Store Connect record for ${app.bundleId}. Create the app once in App Store Connect, then retry.`,
    );
  }
  return { appId, name: app.name };
}

/**
 * Resolve which beta group to operate on: the one named with `--group`, the sole eligible group, or an
 * interactive pick. `externalOnly` narrows to invite-by-email groups — the only kind `add` can target,
 * since internal groups hold App Store Connect team users rather than invited emails.
 */
async function resolveGroup(
  asc: AppStoreConnectClient,
  appId: string,
  options: { group?: string; externalOnly: boolean; canPrompt: boolean },
): Promise<BetaGroupResource> {
  const groups = await asc.listBetaGroups(appId);
  const eligible = options.externalOnly
    ? groups.filter((group) => group.isInternal !== true)
    : groups;
  const kind = options.externalOnly ? 'external ' : '';

  const groupName = options.group;
  if (groupName) {
    const match = eligible.find((group) => group.name.toLowerCase() === groupName.toLowerCase());
    if (match) return match;
    throw new Error(
      `No ${kind}beta group named "${groupName}". Create one with \`launch testflight create-group "${groupName}"\`.`,
    );
  }

  if (eligible.length === 0) {
    throw new Error(
      `No ${kind}beta groups for this app. Create one with \`launch testflight create-group <name>\`.`,
    );
  }
  const [sole, ...rest] = eligible;
  if (sole && rest.length === 0) return sole;

  return pickOne<BetaGroupResource>({
    message: 'Which beta group?',
    options: eligible.map((group) => ({
      value: group,
      label: group.name,
      hint: group.isInternal ? 'internal' : 'external',
    })),
    canPrompt: options.canPrompt,
    nonInteractive: { kind: 'require', flagHint: 'Pass --group <name>.' },
  });
}

/**
 * Parse a testers CSV into rows. Accepts `email[,firstName[,lastName]]` per line; a leading header row
 * (its first cell isn't an email) and blank lines are skipped. Kept dependency-free and forgiving — a
 * hand-edited tester list shouldn't need a spreadsheet library to import.
 */
export function parseTestersCsv(text: string): TesterInput[] {
  const rows: TesterInput[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [email, firstName, lastName] = line.split(',').map((cell) => cell.trim());
    if (!email?.includes('@')) continue; // header row, blank line, or junk — skip
    rows.push({ email, ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) });
  }
  return rows;
}

/** Gather testers to add from positional emails and/or a `--csv` file, de-duped by email (last wins). */
function collectTesters(emails: string[], options: TesterCommandOptions): TesterInput[] {
  const fromArgs = emails.map((email) => ({
    email,
    ...(options.first ? { firstName: options.first } : {}),
    ...(options.last ? { lastName: options.last } : {}),
  }));
  const fromCsv = options.csv ? parseTestersCsv(readCsv(options.csv)) : [];

  const byEmail = new Map<string, TesterInput>();
  for (const tester of [...fromArgs, ...fromCsv]) {
    if (!tester.email.includes('@')) throw new Error(`"${tester.email}" is not a valid email.`);
    byEmail.set(tester.email.toLowerCase(), tester);
  }
  return [...byEmail.values()];
}

/** Read a CSV file, failing clearly when the path is wrong. */
function readCsv(path: string): string {
  if (!existsSync(path)) throw new Error(`CSV file not found: ${path}`);
  return readFileSync(path, 'utf8');
}

/** Confirm an outward-facing/destructive action, honoring `--yes` and refusing to guess without a TTY. */
async function confirmAction(
  message: string,
  assumeYes: boolean,
  canPrompt: boolean,
): Promise<boolean> {
  if (assumeYes) return true;
  if (!canPrompt) throw new Error(`${message} Re-run with --yes to proceed non-interactively.`);
  const ok = await confirm({ message });
  if (isCancel(ok)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  return ok;
}

/** `launch testflight groups` — list the app's beta groups with tester counts. */
async function listGroups(options: { app?: string }): Promise<void> {
  const asc = await client();
  const { appId, name } = await resolveAppId(asc, options.app);
  const groups = await asc.listBetaGroups(appId);
  if (groups.length === 0) {
    log.line(
      `No beta groups for ${name}. Create one with \`launch testflight create-group <name>\`.`,
    );
    return;
  }
  for (const group of groups) {
    const count = (await asc.listBetaTestersInGroup(group.id)).length;
    const kind = group.isInternal ? 'internal' : 'external';
    const link = group.publicLink ? ` — ${group.publicLink}` : '';
    log.line(`• ${group.name} (${kind}, ${count} tester${count === 1 ? '' : 's'})${link}`);
  }
  log.line(`\n${groups.length} group(s) for ${name}.`);
}

/** `launch testflight create-group <name>` — create an external beta group (idempotent on name). */
async function createGroup(groupName: string, options: { app?: string }): Promise<void> {
  const asc = await client();
  const { appId, name } = await resolveAppId(asc, options.app);
  const existing = await asc.findBetaGroupByName(appId, groupName);
  if (existing) {
    log.line(`Beta group "${existing.name}" already exists for ${name}.`);
    return;
  }
  const created = await asc.createBetaGroup(appId, groupName);
  log.line(`✓ Created external beta group "${created.name}" for ${name}.`);
  log.line(`• Add testers with \`launch testflight add <email> --group "${created.name}"\`.`);
}

/** `launch testflight testers` — list the testers in a beta group. */
async function listTesters(options: { app?: string; group?: string }): Promise<void> {
  const asc = await client();
  const { appId } = await resolveAppId(asc, options.app);
  const group = await resolveGroup(asc, appId, {
    ...(options.group ? { group: options.group } : {}),
    externalOnly: false,
    canPrompt: process.stdin.isTTY,
  });
  const testers = await asc.listBetaTestersInGroup(group.id);
  if (testers.length === 0) {
    log.line(
      `No testers in "${group.name}". Add one with \`launch testflight add <email> --group "${group.name}"\`.`,
    );
    return;
  }
  for (const tester of testers) {
    const fullName = [tester.firstName, tester.lastName].filter(Boolean).join(' ');
    const state = tester.state ? ` [${tester.state.toLowerCase()}]` : '';
    log.line(`• ${tester.email}${fullName ? ` — ${fullName}` : ''}${state}`);
  }
  log.line(`\n${testers.length} tester(s) in "${group.name}".`);
}

/** `launch testflight add <emails...>` — invite/add testers to a beta group, idempotently. */
async function addTesters(emails: string[], options: TesterCommandOptions): Promise<void> {
  const assumeYes = options.yes === true;
  const canPrompt = !assumeYes && process.stdin.isTTY;
  const testers = collectTesters(emails, options);
  if (testers.length === 0)
    throw new Error('No testers to add. Pass one or more emails, or --csv <path>.');

  const asc = await client();
  const { appId, name } = await resolveAppId(asc, options.app);
  const group = await resolveGroup(asc, appId, {
    ...(options.group ? { group: options.group } : {}),
    externalOnly: true,
    canPrompt,
  });

  // Skip anyone already in the group so re-running the command is a no-op.
  const present = new Set(
    (await asc.listBetaTestersInGroup(group.id)).map((tester) => tester.email.toLowerCase()),
  );
  const pending = testers.filter((tester) => !present.has(tester.email.toLowerCase()));
  const skipped = testers.length - pending.length;

  if (pending.length === 0) {
    log.line(`All ${testers.length} tester(s) are already in "${group.name}". Nothing to do.`);
    return;
  }
  if (options.dryRun === true) {
    log.line(
      `[dry-run] would add ${pending.length} tester(s) to "${group.name}" (${name}); ${skipped} already present:`,
    );
    for (const tester of pending) log.line(`  • ${tester.email}`);
    return;
  }
  const proceed = await confirmAction(
    `Add ${pending.length} tester(s) to "${group.name}" for ${name}? New emails get a TestFlight invite.`,
    assumeYes,
    canPrompt,
  );
  if (!proceed) {
    log.line('Aborted; no testers added.');
    return;
  }

  let invited = 0;
  let linked = 0;
  for (const tester of pending) {
    const existing = await asc.findBetaTesterByEmail(tester.email);
    if (existing) {
      await asc.addTestersToGroup(group.id, [existing.id]);
      linked++;
      log.line(`✓ Added existing tester ${tester.email}`);
    } else {
      await asc.createBetaTester(group.id, tester);
      invited++;
      log.line(`✓ Invited ${tester.email}`);
    }
  }
  log.line(
    `\nDone: ${invited} invited, ${linked} existing added, ${skipped} already present → "${group.name}".`,
  );
}

/** `launch testflight rm <emails...>` — remove testers from a beta group (the inverse of `add`). */
async function removeTesters(emails: string[], options: TesterCommandOptions): Promise<void> {
  if (emails.length === 0) throw new Error('Pass one or more tester emails to remove.');
  const assumeYes = options.yes === true;
  const canPrompt = !assumeYes && process.stdin.isTTY;
  const wanted = new Set(emails.map((email) => email.toLowerCase()));

  const asc = await client();
  const { appId } = await resolveAppId(asc, options.app);
  const group = await resolveGroup(asc, appId, {
    ...(options.group ? { group: options.group } : {}),
    externalOnly: false,
    canPrompt,
  });

  const matched = (await asc.listBetaTestersInGroup(group.id)).filter((tester) =>
    wanted.has(tester.email.toLowerCase()),
  );
  if (matched.length === 0) {
    log.line(`No matching testers in "${group.name}".`);
    return;
  }
  if (options.dryRun === true) {
    log.line(`[dry-run] would remove ${matched.length} tester(s) from "${group.name}":`);
    for (const tester of matched) log.line(`  • ${tester.email}`);
    return;
  }
  const proceed = await confirmAction(
    `Remove ${matched.length} tester(s) from "${group.name}"?`,
    assumeYes,
    canPrompt,
  );
  if (!proceed) {
    log.line('Aborted; no testers removed.');
    return;
  }
  await asc.removeTestersFromGroup(
    group.id,
    matched.map((tester) => tester.id),
  );
  log.line(`✓ Removed ${matched.length} tester(s) from "${group.name}".`);
}

/** Options for `launch testflight feedback` — list tester crash/screenshot feedback and optionally download attachments. */
interface FeedbackOptions {
  app?: string;
  build?: string;
  type?: string;
  out?: string;
  json?: boolean;
}

/** The accepted `--type` values, also the {@link BetaFeedbackKind} union — validated before reaching the core. */
const FEEDBACK_KINDS: readonly BetaFeedbackKind[] = ['crash', 'screenshot'];

/** Parse + validate `--type`, returning the kind or undefined (both kinds) when absent. Exported for tests. */
export function parseFeedbackType(value: string | undefined): BetaFeedbackKind | undefined {
  if (value === undefined) return undefined;
  const kind = FEEDBACK_KINDS.find((candidate) => candidate === value.trim().toLowerCase());
  if (!kind)
    throw new Error(`--type must be one of ${FEEDBACK_KINDS.join(' | ')} (got "${value}").`);
  return kind;
}

/** Resolve the selected app's iOS bundle id, erroring when the app has none (TestFlight is iOS-only). */
async function resolveBundleId(appSelector: string | undefined): Promise<string> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, appSelector);
  if (!app.bundleId) {
    throw new Error(
      `No iOS bundle identifier for ${app.name} (set ios.bundleIdentifier in app.json).`,
    );
  }
  return app.bundleId;
}

/**
 * Strip C0/C1 control characters (ANSI escapes, carriage returns) from tester-controllable text before
 * it's printed to a terminal — a crafted comment or device name could otherwise inject escape sequences.
 */
function clean(text: string): string {
  return text.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
}

/** Render one piece of beta feedback as a copy-pasteable block: id + kind, meta line, comment, screenshot URLs. */
export function renderFeedback(item: BetaFeedback): string {
  const deviceModel = item.deviceModel ? clean(item.deviceModel) : undefined;
  const osVersion = item.osVersion ? clean(item.osVersion) : undefined;
  const device = [deviceModel, osVersion ? `iOS ${osVersion}` : undefined]
    .filter(Boolean)
    .join(' · ');
  const meta = [
    item.buildVersion ? `build ${item.buildVersion}` : undefined,
    device || undefined,
    item.email ? clean(item.email) : undefined,
    item.createdDate ? item.createdDate.slice(0, 10) : undefined,
  ]
    .filter(Boolean)
    .join('  ');
  const icon = item.kind === 'crash' ? '✗ crash' : '▣ screenshot';
  const lines = [`${item.id}  ${icon}`, `  ${meta}`];
  if (item.comment) lines.push(`  "${clean(item.comment)}"`);
  for (const shot of item.screenshots ?? []) lines.push(`  ${clean(shot.url)}`);
  return lines.join('\n');
}

/** Options for `launch testflight release` — set "What to Test" notes and submit a build for beta review. */
interface ReleaseOptions {
  app?: string;
  build?: string;
  whatsNew?: string;
  locale?: string;
  config?: string;
  review?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

/**
 * Render one beta-review action line: `✗` for a failure (with Apple's detail), `•` for a skip,
 * `+` for a planned/applied change. Exported for tests.
 */
export function renderBetaAction(action: PlannedAction): string {
  if (action.status === 'failed')
    return `✗ ${action.description}${action.error ? ` — ${action.error}` : ''}`;
  if (action.status === 'skipped') return `• ${action.description}`;
  return `+ ${action.description}`;
}

/**
 * `launch testflight release` — set a build's "What to Test" notes (from `--whats-new` or
 * `testflight.config.json`) and submit it for Beta App Review. Notes from `--whats-new` apply to
 * `--locale` (default `en-US`); a config file localizes them. `--no-review` sets notes only.
 */
async function releaseBuild(options: ReleaseOptions): Promise<void> {
  const log = createLogger(false);
  const whatToTest = options.whatsNew
    ? { [options.locale ?? 'en-US']: options.whatsNew }
    : loadBetaReviewConfig(options.config ?? 'testflight.config.json').whatToTest;

  const asc = await client();
  const { appId, name } = await resolveAppId(asc, options.app);
  const submitForReview = options.review !== false;
  const input = {
    appId,
    ...(options.build ? { buildVersion: options.build } : {}),
    whatToTest,
    submitForReview,
  };

  const plan = await reconcileBetaReview(asc, { ...input, dryRun: true });
  const planned = plan.actions.filter((action) => action.status === 'planned');
  const label = `${name} build ${plan.buildVersion}`;

  log.gap();
  if (plan.actions.length === 0) {
    log.step(label, 'TestFlight release prep already in sync');
    return;
  }
  log.notice(label, ...plan.actions.map(renderBetaAction));

  log.gap();
  log.info(`${planned.length} change(s) for ${label}.`);
  if (options.dryRun === true) {
    log.info('Dry run — no changes made. Re-run without --dry-run to apply.');
    return;
  }
  if (planned.length === 0) {
    log.step('testflight', 'nothing to apply (everything already in sync)');
    return;
  }

  if (options.yes !== true) {
    if (!process.stdout.isTTY) {
      throw new Error(
        'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
      );
    }
    const proceed = await confirm({ message: `Apply ${planned.length} change(s) to ${label}?` });
    if (isCancel(proceed) || !proceed) {
      cancel('Aborted — no changes made.');
      return;
    }
  }

  const applied = await reconcileBetaReview(asc, { ...input, dryRun: false });
  const summary = summarizeBetaReview(applied.actions);
  const rows = applied.actions.map((action) => {
    if (action.status === 'failed') return `✗ ${action.description} — ${action.error ?? 'failed'}`;
    return `${action.status === 'skipped' ? '•' : '✓'} ${action.description}`;
  });
  log.box(summary.failed > 0 ? 'Applied with errors' : 'Applied', rows);
  if (summary.failed > 0) process.exitCode = 1;
}

/** Attach the `testflight` command (with its tester/group subcommands) to the program. */
export function registerTestflightCommand(program: Command): void {
  const testflight = program
    .command('testflight')
    .description('manage TestFlight beta groups and testers');

  testflight
    .command('groups')
    .description("list the app's TestFlight beta groups")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .action((options: { app?: string }) => listGroups(options));

  testflight
    .command('create-group')
    .description('create an external beta group testers can be invited into')
    .argument('<name>', 'the group name, e.g. "External Testers"')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .action((groupName: string, options: { app?: string }) => createGroup(groupName, options));

  testflight
    .command('testers')
    .description('list the testers in a beta group')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('-g, --group <name>', "beta group (auto-selected if there's only one)")
    .action((options: { app?: string; group?: string }) => listTesters(options));

  testflight
    .command('add')
    .description('invite/add testers to a beta group (sends a TestFlight invite to new emails)')
    .argument('[emails...]', 'tester emails to add')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option(
      '-g, --group <name>',
      "external beta group to add into (auto-selected if there's only one)",
    )
    .option('--first <name>', 'first name applied to bare emails')
    .option('--last <name>', 'last name applied to bare emails')
    .option('--csv <path>', 'import testers from a CSV (email,firstName,lastName per line)')
    .option('--dry-run', 'report what would change without inviting anyone', false)
    .option('-y, --yes', 'skip the confirmation prompt', false)
    .action((emails: string[], options: TesterCommandOptions) => addTesters(emails, options));

  testflight
    .command('rm')
    .description('remove testers from a beta group')
    .argument('<emails...>', 'tester emails to remove')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('-g, --group <name>', "beta group to remove from (auto-selected if there's only one)")
    .option('--dry-run', 'report what would change without removing anyone', false)
    .option('-y, --yes', 'skip the confirmation prompt', false)
    .action((emails: string[], options: TesterCommandOptions) => removeTesters(emails, options));

  testflight
    .command('release')
    .description('set a build\'s "What to Test" notes and submit it for Beta App Review')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option(
      '--build <version>',
      'target build by CFBundleVersion (default: the latest valid build)',
    )
    .option('--whats-new <text>', 'What to Test notes (for --locale); overrides the config file')
    .option('--locale <locale>', 'locale for --whats-new', 'en-US')
    .option(
      '--config <path>',
      'path to testflight.config.json (localized whatToTest)',
      'testflight.config.json',
    )
    .option('--no-review', "set the notes only; don't submit for Beta App Review")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((options: ReleaseOptions) => releaseBuild(options));

  testflight
    .command('feedback')
    .description(
      'list tester crash & screenshot feedback, newest first (download attachments with --out)',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--build <version>', 'only show feedback for this build (CFBundleVersion)')
    .option('--type <kind>', 'only show one kind: crash | screenshot')
    .option('--out <dir>', 'download screenshot attachments into this directory')
    .option('--json', 'output machine-readable JSON', false)
    .action(async (options: FeedbackOptions) => {
      const kind = parseFeedbackType(options.type);
      const filters: FeedbackFilters = {
        ...(options.build ? { build: options.build } : {}),
        ...(kind ? { kind } : {}),
      };
      const bundleId = await resolveBundleId(options.app);
      const asc = await client();
      const found = await listBetaFeedback(asc, bundleId, filters);

      if (options.out) {
        const written = await downloadFeedbackAttachments(asc, found, options.out);
        if (!options.json) {
          log.line(
            `Downloaded ${written.length} screenshot${written.length === 1 ? '' : 's'} to ${options.out}.`,
          );
        }
      }
      if (options.json) {
        log.line(JSON.stringify(found, null, 2));
        return;
      }
      if (found.length === 0) {
        log.line('No TestFlight feedback yet. Testers submit it from the TestFlight app.');
        return;
      }
      log.line(found.map(renderFeedback).join('\n\n'));
      log.line(`\n${found.length} feedback item${found.length === 1 ? '' : 's'}.`);
    });
}
