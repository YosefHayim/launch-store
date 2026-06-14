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

import { existsSync, readFileSync } from "node:fs";
import type { Command } from "commander";
import { cancel, confirm, isCancel } from "@clack/prompts";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { pickOne } from "../../core/prompt.js";
import { AppStoreConnectClient, type BetaGroupResource } from "../../apple/ascClient.js";

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
  if (!ascKey) throw new Error("No active Apple account. Run `launch creds set-key` first.");
  return new AppStoreConnectClient(ascKey);
}

/** Resolve the selected app to its App Store Connect app id, failing with an actionable message. */
async function resolveAppId(
  asc: AppStoreConnectClient,
  appName: string | undefined,
): Promise<{ appId: string; name: string }> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, appName);
  if (!app.bundleId) throw new Error(`App "${app.name}" has no iOS bundle identifier (set ios.bundleIdentifier).`);
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
  const eligible = options.externalOnly ? groups.filter((group) => group.isInternal !== true) : groups;
  const kind = options.externalOnly ? "external " : "";

  const groupName = options.group;
  if (groupName) {
    const match = eligible.find((group) => group.name.toLowerCase() === groupName.toLowerCase());
    if (match) return match;
    throw new Error(
      `No ${kind}beta group named "${groupName}". Create one with \`launch testflight create-group "${groupName}"\`.`,
    );
  }

  if (eligible.length === 0) {
    throw new Error(`No ${kind}beta groups for this app. Create one with \`launch testflight create-group <name>\`.`);
  }
  const [sole, ...rest] = eligible;
  if (sole && rest.length === 0) return sole;

  return pickOne<BetaGroupResource>({
    message: "Which beta group?",
    options: eligible.map((group) => ({
      value: group,
      label: group.name,
      hint: group.isInternal ? "internal" : "external",
    })),
    canPrompt: options.canPrompt,
    nonInteractive: { kind: "require", flagHint: "Pass --group <name>." },
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
    const [email, firstName, lastName] = line.split(",").map((cell) => cell.trim());
    if (!email?.includes("@")) continue; // header row, blank line, or junk — skip
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
    if (!tester.email.includes("@")) throw new Error(`"${tester.email}" is not a valid email.`);
    byEmail.set(tester.email.toLowerCase(), tester);
  }
  return [...byEmail.values()];
}

/** Read a CSV file, failing clearly when the path is wrong. */
function readCsv(path: string): string {
  if (!existsSync(path)) throw new Error(`CSV file not found: ${path}`);
  return readFileSync(path, "utf8");
}

/** Confirm an outward-facing/destructive action, honoring `--yes` and refusing to guess without a TTY. */
async function confirmAction(message: string, assumeYes: boolean, canPrompt: boolean): Promise<boolean> {
  if (assumeYes) return true;
  if (!canPrompt) throw new Error(`${message} Re-run with --yes to proceed non-interactively.`);
  const ok = await confirm({ message });
  if (isCancel(ok)) {
    cancel("Cancelled.");
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
    console.log(`No beta groups for ${name}. Create one with \`launch testflight create-group <name>\`.`);
    return;
  }
  for (const group of groups) {
    const count = (await asc.listBetaTestersInGroup(group.id)).length;
    const kind = group.isInternal ? "internal" : "external";
    const link = group.publicLink ? ` — ${group.publicLink}` : "";
    console.log(`• ${group.name} (${kind}, ${count} tester${count === 1 ? "" : "s"})${link}`);
  }
  console.log(`\n${groups.length} group(s) for ${name}.`);
}

/** `launch testflight create-group <name>` — create an external beta group (idempotent on name). */
async function createGroup(groupName: string, options: { app?: string }): Promise<void> {
  const asc = await client();
  const { appId, name } = await resolveAppId(asc, options.app);
  const existing = await asc.findBetaGroupByName(appId, groupName);
  if (existing) {
    console.log(`Beta group "${existing.name}" already exists for ${name}.`);
    return;
  }
  const created = await asc.createBetaGroup(appId, groupName);
  console.log(`✓ Created external beta group "${created.name}" for ${name}.`);
  console.log(`• Add testers with \`launch testflight add <email> --group "${created.name}"\`.`);
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
    console.log(
      `No testers in "${group.name}". Add one with \`launch testflight add <email> --group "${group.name}"\`.`,
    );
    return;
  }
  for (const tester of testers) {
    const fullName = [tester.firstName, tester.lastName].filter(Boolean).join(" ");
    const state = tester.state ? ` [${tester.state.toLowerCase()}]` : "";
    console.log(`• ${tester.email}${fullName ? ` — ${fullName}` : ""}${state}`);
  }
  console.log(`\n${testers.length} tester(s) in "${group.name}".`);
}

/** `launch testflight add <emails...>` — invite/add testers to a beta group, idempotently. */
async function addTesters(emails: string[], options: TesterCommandOptions): Promise<void> {
  const assumeYes = options.yes === true;
  const canPrompt = !assumeYes && process.stdin.isTTY;
  const testers = collectTesters(emails, options);
  if (testers.length === 0) throw new Error("No testers to add. Pass one or more emails, or --csv <path>.");

  const asc = await client();
  const { appId, name } = await resolveAppId(asc, options.app);
  const group = await resolveGroup(asc, appId, {
    ...(options.group ? { group: options.group } : {}),
    externalOnly: true,
    canPrompt,
  });

  // Skip anyone already in the group so re-running the command is a no-op.
  const present = new Set((await asc.listBetaTestersInGroup(group.id)).map((tester) => tester.email.toLowerCase()));
  const pending = testers.filter((tester) => !present.has(tester.email.toLowerCase()));
  const skipped = testers.length - pending.length;

  if (pending.length === 0) {
    console.log(`All ${testers.length} tester(s) are already in "${group.name}". Nothing to do.`);
    return;
  }
  if (options.dryRun === true) {
    console.log(
      `[dry-run] would add ${pending.length} tester(s) to "${group.name}" (${name}); ${skipped} already present:`,
    );
    for (const tester of pending) console.log(`  • ${tester.email}`);
    return;
  }
  const proceed = await confirmAction(
    `Add ${pending.length} tester(s) to "${group.name}" for ${name}? New emails get a TestFlight invite.`,
    assumeYes,
    canPrompt,
  );
  if (!proceed) {
    console.log("Aborted; no testers added.");
    return;
  }

  let invited = 0;
  let linked = 0;
  for (const tester of pending) {
    const existing = await asc.findBetaTesterByEmail(tester.email);
    if (existing) {
      await asc.addTestersToGroup(group.id, [existing.id]);
      linked++;
      console.log(`✓ Added existing tester ${tester.email}`);
    } else {
      await asc.createBetaTester(group.id, tester);
      invited++;
      console.log(`✓ Invited ${tester.email}`);
    }
  }
  console.log(`\nDone: ${invited} invited, ${linked} existing added, ${skipped} already present → "${group.name}".`);
}

/** `launch testflight rm <emails...>` — remove testers from a beta group (the inverse of `add`). */
async function removeTesters(emails: string[], options: TesterCommandOptions): Promise<void> {
  if (emails.length === 0) throw new Error("Pass one or more tester emails to remove.");
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
    console.log(`No matching testers in "${group.name}".`);
    return;
  }
  if (options.dryRun === true) {
    console.log(`[dry-run] would remove ${matched.length} tester(s) from "${group.name}":`);
    for (const tester of matched) console.log(`  • ${tester.email}`);
    return;
  }
  const proceed = await confirmAction(`Remove ${matched.length} tester(s) from "${group.name}"?`, assumeYes, canPrompt);
  if (!proceed) {
    console.log("Aborted; no testers removed.");
    return;
  }
  await asc.removeTestersFromGroup(
    group.id,
    matched.map((tester) => tester.id),
  );
  console.log(`✓ Removed ${matched.length} tester(s) from "${group.name}".`);
}

/** Attach the `testflight` command (with its tester/group subcommands) to the program. */
export function registerTestflightCommand(program: Command): void {
  const testflight = program.command("testflight").description("manage TestFlight beta groups and testers");

  testflight
    .command("groups")
    .description("list the app's TestFlight beta groups")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .action((options: { app?: string }) => listGroups(options));

  testflight
    .command("create-group")
    .description("create an external beta group testers can be invited into")
    .argument("<name>", 'the group name, e.g. "External Testers"')
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .action((groupName: string, options: { app?: string }) => createGroup(groupName, options));

  testflight
    .command("testers")
    .description("list the testers in a beta group")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("-g, --group <name>", "beta group (auto-selected if there's only one)")
    .action((options: { app?: string; group?: string }) => listTesters(options));

  testflight
    .command("add")
    .description("invite/add testers to a beta group (sends a TestFlight invite to new emails)")
    .argument("[emails...]", "tester emails to add")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("-g, --group <name>", "external beta group to add into (auto-selected if there's only one)")
    .option("--first <name>", "first name applied to bare emails")
    .option("--last <name>", "last name applied to bare emails")
    .option("--csv <path>", "import testers from a CSV (email,firstName,lastName per line)")
    .option("--dry-run", "report what would change without inviting anyone", false)
    .option("-y, --yes", "skip the confirmation prompt", false)
    .action((emails: string[], options: TesterCommandOptions) => addTesters(emails, options));

  testflight
    .command("rm")
    .description("remove testers from a beta group")
    .argument("<emails...>", "tester emails to remove")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("-g, --group <name>", "beta group to remove from (auto-selected if there's only one)")
    .option("--dry-run", "report what would change without removing anyone", false)
    .option("-y, --yes", "skip the confirmation prompt", false)
    .action((emails: string[], options: TesterCommandOptions) => removeTesters(emails, options));
}
