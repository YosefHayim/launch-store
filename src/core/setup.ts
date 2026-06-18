/**
 * `launch setup` — the automatic, zero-to-ready front door.
 *
 * The goal is the experience a developer expects from a modern setup wizard (PostHog's `npx wizard`,
 * Expo's `eas init`): run one command, watch it configure everything it safely can on its own, see a
 * single board that says "here's what's ready and what's left," then a dry-run rehearsal that proves
 * the whole build → sign → submit pipeline without touching anything. No interrogation, no manual
 * steps beyond the one thing only the user can supply (their own signing key — Launch has no cloud to
 * fetch it from, by design).
 *
 * It is deliberately *not* a fourth copy of the setup logic. The auto-applied steps reuse the same
 * primitives the rest of Launch uses — {@link configTemplate}/{@link runInit}'s scaffold, the toolchain
 * installer {@link ensureToolchain}, the readiness probes from `doctor` — and the rehearsal is the real
 * {@link runBuild} pipeline in `--dry-run`. The two sibling flows it complements:
 *   - the no-args `launch` wizard's interactive, teaching-first `runGuidedSetup` (prompts every step);
 *   - `launch setup ios`, the detailed iOS provisioning *report* (account, App ID, cert, profile).
 * This one is the hands-off middle: minimal prompts, a status board, and a rehearsal.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppDescriptor, Platform } from "./types.js";
import { loadConfig } from "./config.js";
import { DEFAULT_IN_REPO_ARTIFACT_DIR, ENV_EXAMPLE_TEMPLATE, configTemplate, detectAppRoot } from "./configScaffold.js";
import { resolveArtifactDir } from "./storage.js";
import { ensureArtifactDirIgnored } from "./gitignore.js";
import { createLogger } from "./logger.js";
import { capture, exists } from "./exec.js";
import { hostOsLabel, hostResources, isMac } from "./os.js";
import { isInteractive, withSpinner } from "./progress.js";
import { inspectPackageSetup } from "./packageManager.js";
import { checkApp, formatFinding } from "./configCheck.js";
import {
  ANDROID_TOOLS,
  REQUIRED_TOOLS,
  type Tool,
  ensureToolchain,
  fixHint,
  missingRequiredTools,
} from "./toolchain.js";
import { formatAccountSummary, getActiveAccount, loadActiveAscKey } from "./accounts.js";
import { runBuild } from "./pipeline.js";
import { AppStoreConnectClient } from "../apple/ascClient.js";
import { loadServiceAccount } from "../google/credentials.js";
import { GooglePlayClient, parseServiceAccount } from "../google/playClient.js";

/**
 * The state of one readiness check, mapped to the board glyph and to whether it blocks "ready":
 * `ok` (✓, done), `todo` (✗, a real gap the user must close), `info` (•, advisory — present-but-optional
 * or a not-yet-provisioned state the build resolves on its own, so it never blocks readiness).
 */
export type ReadinessStatus = "ok" | "todo" | "info";

/** One line of the readiness board: a single check, its state, and an optional short context/fix hint. */
export interface ReadinessRow {
  /** What was checked, e.g. `"Xcode (xcodebuild)"` or `"Apple account: Personal"`. */
  label: string;
  /** Whether it's done, a gap, or advisory — see {@link ReadinessStatus}. */
  status: ReadinessStatus;
  /** A short detail (present-state context) or, for a `todo`, the exact command/hint to fix it. */
  detail?: string;
}

/** A titled section of the board (Environment, Config, Toolchain, …) holding its checks in display order. */
export interface ReadinessGroup {
  title: string;
  rows: ReadinessRow[];
}

/** The full readiness picture rendered as the board and summarized in the outro. */
export interface SetupReadiness {
  groups: ReadinessGroup[];
}

/** The glyph for a check state — mirrors `doctor`'s convention (✓ pass · ✗ gap · • advisory). */
function mark(status: ReadinessStatus): string {
  switch (status) {
    case "ok":
      return "✓";
    case "todo":
      return "✗";
    case "info":
      return "•";
  }
}

/** A row with a detail only when one is present, so `exactOptionalPropertyTypes` stays satisfied. */
function row(label: string, status: ReadinessStatus, detail?: string): ReadinessRow {
  return { label, status, ...(detail ? { detail } : {}) };
}

/** Narrow a thrown value to its message without leaking `unknown` past the boundary. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Render the board as plain lines: each group's title, then its checks indented under it with a glyph
 * and optional `— detail`. Pure (no color, no I/O) so it's unit-testable; the caller frames it with the
 * Aurora receipt box, which adds the color and border on a TTY.
 */
export function formatSetupBoard(readiness: SetupReadiness): string[] {
  const lines: string[] = [];
  for (const group of readiness.groups) {
    if (lines.length > 0) lines.push("");
    lines.push(group.title);
    for (const check of group.rows) {
      lines.push(`  ${mark(check.status)} ${check.label}${check.detail ? ` — ${check.detail}` : ""}`);
    }
  }
  return lines;
}

/** Every unresolved gap across the board, flattened — what the outro lists as "left to do." Pure. */
export function pendingTodos(readiness: SetupReadiness): ReadinessRow[] {
  return readiness.groups.flatMap((group) => group.rows.filter((check) => check.status === "todo"));
}

/**
 * Turn a toolchain list into readiness rows against the set of commands found on `PATH`: a present tool
 * is ✓, a missing *required* tool is a ✗ with its `brew install …`/guide hint, and a missing
 * *recommended* tool (ccache) is an advisory • — its absence only slows builds, it never blocks. Pure.
 */
export function toolchainReadinessRows(tools: Tool[], present: Set<string>): ReadinessRow[] {
  return tools.map((tool) => {
    if (present.has(tool.command)) return row(tool.label, "ok");
    if (tool.tier === "recommended") return row(tool.label, "info", `recommended — ${fixHint(tool)}`);
    return row(tool.label, "todo", fixHint(tool));
  });
}

/** Environment facts — host OS, cores, package manager — shown as advisory context, never a gap. */
function environmentRows(): ReadinessRow[] {
  const { cores } = hostResources();
  const pkg = inspectPackageSetup(process.cwd());
  const version = pkg.pm.version ? `@${pkg.pm.version}` : "";
  return [
    row("Host", "info", `${hostOsLabel()} · ${cores} cores`),
    row(
      "Package manager",
      "info",
      `${pkg.pm.name}${version}${pkg.workspace ? ` · ${pkg.workspace.kind} workspace` : ""}`,
    ),
  ];
}

/** Config readiness: whether `launch.config.ts` exists (auto-scaffolded by {@link runSetup}) and apps were found. */
function configRows(apps: AppDescriptor[]): ReadinessRow[] {
  const hasConfig = existsSync(join(process.cwd(), "launch.config.ts"));
  return [
    hasConfig ? row("launch.config.ts", "ok", "present") : row("launch.config.ts", "todo", "run: launch init"),
    apps.length > 0
      ? row(`Apps detected: ${apps.length}`, "ok", apps.map((app) => app.name).join(", "))
      : row("Apps", "todo", "no app.json found — run Launch from your app's repo"),
  ];
}

/**
 * iOS account readiness, best-effort over the network: the active Apple account, then — when a key is in
 * hand — whether Apple's agreements are accepted (the EAS-class 2FA breakage can't happen with API-key
 * auth) and whether each iOS app already has an App Store Connect record (the one step the API can't
 * create). A probe that can't reach Apple degrades to a single `todo` rather than failing setup.
 */
async function appleAccountRows(apps: AppDescriptor[]): Promise<ReadinessRow[]> {
  const account = getActiveAccount();
  if (!account) {
    return [row("Apple account", "todo", "import your App Store Connect key: launch creds set-key")];
  }
  const rows = [row(`Apple account: ${account.label}`, "ok", formatAccountSummary(account, { includeLabel: false }))];

  const ascKey = await loadActiveAscKey();
  if (!ascKey) return rows;
  const client = new AppStoreConnectClient(ascKey);
  try {
    await client.assertReady();
    rows.push(row("Apple agreements", "ok", "accepted · API-key auth (no password, no 2FA)"));
  } catch (error) {
    rows.push(row("Apple agreements", "todo", errorMessage(error)));
    return rows; // can't read app records if the account itself isn't ready
  }
  for (const app of apps) {
    if (!app.bundleId) continue;
    const appId = await client.getAppId(app.bundleId).catch(() => null);
    rows.push(
      appId
        ? row(`App Store record · ${app.bundleId}`, "ok")
        : row(`App Store record · ${app.bundleId}`, "todo", "create it once at appstoreconnect.apple.com/apps"),
    );
  }
  return rows;
}

/**
 * Android account readiness, best-effort: whether a Play service account is imported and can reach each
 * Android app. An unreachable app deep-links the one-time Play Console step (create + enroll in App
 * Signing) as a `todo`.
 */
async function playAccountRows(apps: AppDescriptor[]): Promise<ReadinessRow[]> {
  const json = await loadServiceAccount();
  if (!json) {
    return [row("Play service account", "todo", "import it: launch creds set-key --platform android")];
  }
  const rows = [row("Play service account", "ok", "imported")];
  const client = new GooglePlayClient(parseServiceAccount(json));
  for (const app of apps) {
    if (!app.packageName) continue;
    try {
      await client.assertAppExists(app.packageName);
      rows.push(row(`Play app · ${app.packageName}`, "ok"));
    } catch {
      rows.push(
        row(`Play app · ${app.packageName}`, "todo", "create + enroll in Play App Signing at play.google.com/console"),
      );
    }
  }
  return rows;
}

/**
 * Whether a distribution identity is visible to `codesign` the way a build looks it up (the macOS-Tahoe
 * footgun `doctor` guards against). Advisory, not a gap: the build provisions signing inline when it's
 * absent, so a fresh machine still reads as ready-to-build. macOS only.
 */
async function signingRows(): Promise<ReadinessRow[]> {
  if (!isMac()) return [];
  try {
    const identities = await capture("security", ["find-identity", "-v", "-p", "codesigning"]);
    return [
      /Apple Distribution|iPhone Distribution/.test(identities)
        ? row("Distribution identity", "ok", "visible to codesign (login keychain · Tahoe-safe)")
        : row("Distribution identity", "info", "none yet — the build provisions one, or run: launch creds setup"),
    ];
  } catch {
    return [row("Distribution identity", "info", "could not query codesign identities")];
  }
}

/** Per-app config-footgun rows: a clean app is ✓; an error finding is a ✗ gap; a warning is advisory. */
async function appConfigRows(apps: AppDescriptor[], platform: Platform): Promise<ReadinessRow[]> {
  const rows: ReadinessRow[] = [];
  for (const app of apps) {
    const findings = await checkApp(app, platform);
    if (findings.length === 0) {
      rows.push(row(app.name, "ok", "app config clean"));
      continue;
    }
    for (const finding of findings) {
      rows.push(row(app.name, finding.severity === "error" ? "todo" : "info", formatFinding(finding)));
    }
  }
  return rows;
}

/**
 * Read the whole readiness picture for a platform without changing anything: environment, config, the
 * build toolchain, the store account (best-effort network probe), iOS signing, and each app's config.
 * The board is rendered straight from this — call it *after* {@link runSetup}'s auto-apply so it reflects
 * the freshly-scaffolded config and installed tools.
 */
export async function collectReadiness(platform: Platform, apps: AppDescriptor[]): Promise<SetupReadiness> {
  const tools = platform === "android" ? ANDROID_TOOLS : REQUIRED_TOOLS;
  const present = new Set<string>();
  for (const tool of tools) {
    if (await exists(tool.command)) present.add(tool.command);
  }

  const groups: ReadinessGroup[] = [
    { title: "Environment", rows: environmentRows() },
    { title: "Config", rows: configRows(apps) },
    { title: "Toolchain", rows: toolchainReadinessRows(tools, present) },
  ];

  if (platform === "ios") {
    groups.push({
      title: "Apple account",
      rows: await withSpinner("Checking your Apple account", () => appleAccountRows(apps)),
    });
    const signing = await signingRows();
    if (signing.length > 0) groups.push({ title: "Signing", rows: signing });
  } else {
    groups.push({
      title: "Google Play",
      rows: await withSpinner("Checking Google Play access", () => playAccountRows(apps)),
    });
  }

  groups.push({ title: "App config", rows: await appConfigRows(apps, platform) });
  return { groups };
}

/**
 * Write `launch.config.ts` (and `.env.example` when absent) into `cwd` — the non-interactive scaffold.
 * Scaffolds the in-repo {@link DEFAULT_IN_REPO_ARTIFACT_DIR} and auto-gitignores it, matching `launch init`
 * so a hands-off `launch setup` never leaves build binaries staged for commit.
 */
async function scaffoldConfig(apps: AppDescriptor[]): Promise<void> {
  const cwd = process.cwd();
  writeFileSync(
    join(cwd, "launch.config.ts"),
    configTemplate(detectAppRoot(apps, cwd), undefined, undefined, DEFAULT_IN_REPO_ARTIFACT_DIR),
  );
  const envExample = join(cwd, ".env.example");
  if (!existsSync(envExample)) writeFileSync(envExample, ENV_EXAMPLE_TEMPLATE);
  await ensureArtifactDirIgnored(resolveArtifactDir(DEFAULT_IN_REPO_ARTIFACT_DIR, cwd), cwd);
}

/** Options for {@link runSetup}. */
export interface SetupOptions {
  /** Which platform to get ready (`--platform`); defaults to iOS. */
  platform: Platform;
  /** Skip every prompt and proceed with installs (`--yes`) — for CI/agents. */
  yes: boolean;
  /** Run the dry-run pipeline rehearsal at the end (`--no-rehearse` turns it off). */
  rehearse: boolean;
}

/** Rehearse the whole pipeline in `--dry-run` (no build, network, or account change) for the first app. */
async function rehearsePipeline(platform: Platform, app: AppDescriptor): Promise<void> {
  await runBuild({
    platform,
    appName: app.name,
    profileName: "production",
    explain: false,
    submit: true,
    target: "testing",
    dryRun: true,
  });
}

/**
 * The `launch setup` flow: detect the project, auto-apply every safe step (scaffold the config; on a
 * Mac, install any missing iOS build tools), render the readiness board, then rehearse the pipeline in
 * dry-run. Ends green when everything's ready, or lists exactly what's left — chiefly the one thing only
 * the user can provide, their signing key. Auto-installing tools asks a single consent unless `--yes`.
 */
export async function runSetup(options: SetupOptions): Promise<void> {
  const { platform, yes, rehearse } = options;
  const log = createLogger(false);
  log.notice(
    "Launch setup",
    `Getting your ${platform === "ios" ? "iOS" : "Android"} app ready to ship — hands-off where it's safe.`,
  );

  // 1 · Config — scaffold it the first time, no questions asked.
  let { apps } = await loadConfig();
  if (existsSync(join(process.cwd(), "launch.config.ts"))) {
    log.step("config", "launch.config.ts present");
  } else {
    await scaffoldConfig(apps);
    log.step("config", "scaffolded launch.config.ts + .env.example");
    ({ apps } = await loadConfig());
  }

  // 2 · Toolchain — auto-install missing iOS build tools (Mac only). Install only when we can ask (a TTY)
  // or were told to (`--yes`); a non-interactive run without `--yes` just lets the board report the gaps,
  // so it never blocks on a prompt that can't be answered (CI/agents).
  if (platform === "ios" && isMac() && (isInteractive() || yes) && (await missingRequiredTools()).length > 0) {
    await ensureToolchain({ assumeYes: yes || !isInteractive() });
  }

  // 3 · Verify — one board showing what's ready and what's left.
  const readiness = await collectReadiness(platform, apps);
  log.gap();
  log.box("Launch setup", formatSetupBoard(readiness));

  // 4 · Rehearse — prove the build → sign → submit pipeline end-to-end, changing nothing.
  const firstApp = apps[0];
  if (rehearse && firstApp) {
    log.gap();
    log.notice("Rehearsing the pipeline", "Dry-run — no build, no network, no account changes.");
    try {
      await rehearsePipeline(platform, firstApp);
    } catch (error) {
      log.warn(`Rehearsal stopped early: ${errorMessage(error)}`);
    }
  }

  // 5 · Outro — green when ready, else the exact remaining steps.
  const todos = pendingTodos(readiness);
  log.gap();
  if (todos.length === 0) {
    log.box("You're ready", [`Ship it now:  launch build ${platform}`]);
    return;
  }
  log.notice(
    `Almost there — ${todos.length} step${todos.length === 1 ? "" : "s"} left:`,
    ...todos.map((todo) => `${todo.label}${todo.detail ? ` — ${todo.detail}` : ""}`),
  );
  if (!isInteractive()) log.info("Re-run `launch setup` once those are done to confirm everything's green.");
}
