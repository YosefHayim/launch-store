/**
 * `launch plan [surface]` / `launch drift [surface]` — the read-only diff of `launch.config.ts` against
 * live store state, and the CI gate over it.
 *
 * This is the GitOps loop fastlane and EAS can't offer: `plan` answers "what does my config say vs. what
 * is actually live?" in one shot, across every config-as-code surface and (as planners land) both stores;
 * `drift` is the same read graded for CI (`plan --check`). It owns no diff logic of its own — it resolves
 * credentials, walks the {@link import("../../core/plan/registry.js").listSurfacePlanners} registry, and
 * renders what the planners already compute. `--json` plus the documented exit codes (0 in sync · 2 drift ·
 * 1 error, error wins) make it scriptable. See `docs/adr/0003-plan-drift.md`.
 */

import type { Command } from "commander";
import { loadConfig } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { selectApps } from "../../core/syncJobs.js";
import type { AscCatalogApi, PlannedAction } from "../../core/ascSync.js";
import { listSurfacePlanners, registerBuiltinPlanners } from "../../core/plan/registry.js";
import { PLAN_EXIT, runPlanners, type PlanOutcome } from "../../core/plan/orchestrator.js";
import type { PlanContext, PlanStore } from "../../core/plan/types.js";

/** CLI options shared by `plan` and `drift` (the positional `<surface>` arrives as the action's first arg). */
interface PlanOptions {
  /** Comma-separated app handles; default is every discovered app. */
  app?: string;
  /** Grade drift as a failure (the `plan --check` gate). Always on for `drift`. */
  check?: boolean;
  /** Machine-readable output (the full {@link PlanOutcome}) for CI/agents. */
  json?: boolean;
}

/** Everything {@link runPlan} needs — the CLI options plus the optional surface scope. */
interface RunPlanInput extends PlanOptions {
  /** Restrict the run to one surface id (the `launch plan <surface>` argument). */
  surface?: string;
}

/** The leading glyph for a plan line: skipped advisory `•`, destructive `-`, change `~`, otherwise add `+`. */
export function planGlyph(action: PlannedAction): string {
  if (action.status === "skipped") return "•";
  if (action.destructive) return "-";
  return /^update\b/i.test(action.description) ? "~" : "+";
}

/** Human store name for a plan header. */
function storeLabel(store: PlanStore): string {
  return store === "appstore" ? "App Store" : "Google Play";
}

/** One rendered diff line for an action. */
function renderActionLine(action: PlannedAction): string {
  return `${planGlyph(action)} ${action.description}`;
}

/** Print the human diff, grouped store → app → surface, then a one-line summary + next step. */
function renderOutcome(log: ReturnType<typeof createLogger>, outcome: PlanOutcome): void {
  log.gap();
  if (outcome.surfaces.length === 0) {
    log.info("Nothing declared to plan — add products, capabilities, or a store.config.json listing, then re-run.");
    return;
  }

  for (const surface of outcome.surfaces) {
    if (surface.state === "skipped") {
      const hint = surface.hint ? ` (${surface.hint})` : "";
      log.warn(`${storeLabel(surface.store)} · ${surface.surface}: skipped — ${surface.reason}${hint}`);
      continue;
    }
    for (const app of surface.apps) {
      const head = `${app.app} · ${surface.surface} (${app.identifier})`;
      if (app.error !== undefined) log.error(`${head}: ${app.error}`);
      else if (app.actions.length === 0) log.step(`${app.app} · ${surface.surface}`, "in sync");
      else log.notice(head, ...app.actions.map(renderActionLine));
    }
  }

  log.gap();
  renderSummary(log, outcome);
}

/** The closing summary line and the contextual next step (apply, gate, or fix). */
function renderSummary(log: ReturnType<typeof createLogger>, outcome: PlanOutcome): void {
  const { changeCount, appErrorCount, skippedSurfaceCount } = outcome;
  if (changeCount === 0 && appErrorCount === 0 && skippedSurfaceCount === 0) {
    log.step("plan", "everything matches — no drift");
    return;
  }

  const parts: string[] = [];
  if (changeCount > 0) parts.push(`${changeCount} change(s)`);
  if (appErrorCount > 0) parts.push(`${appErrorCount} error(s)`);
  if (skippedSurfaceCount > 0) parts.push(`${skippedSurfaceCount} skipped`);
  log.info(parts.join(" · "));

  if (outcome.check) {
    if (outcome.exitCode === PLAN_EXIT.error)
      log.error("Drift check could not certify — resolve the errors/credentials above, then re-run.");
    else if (outcome.exitCode === PLAN_EXIT.drift) log.info("Drift detected. Run `launch sync` to reconcile.");
  } else {
    log.info("Run `launch sync` to apply, or `launch drift` to gate this in CI.");
  }
}

/**
 * Run the full plan flow. Exported so the same code backs `launch plan`, `launch drift`, and any future
 * caller. Resolves the App Store Connect client lazily and once (memoized on `ctx`) so a planner can emit
 * a skip instead of throwing when no account is configured, and so sibling planners share one client.
 */
export async function runPlan(input: RunPlanInput): Promise<void> {
  registerBuiltinPlanners();
  const log = createLogger(false);
  const { config, apps } = await loadConfig();
  const selected = selectApps(apps, input.app);

  let planners = listSurfacePlanners();
  if (input.surface !== undefined) {
    const match = planners.find((planner) => planner.id === input.surface);
    if (!match) {
      const available = planners.map((planner) => planner.id).join(", ") || "none";
      throw new Error(`Unknown surface "${input.surface}". Available: ${available}.`);
    }
    planners = [match];
  }

  let cachedApi: AscCatalogApi | null | undefined;
  const ctx: PlanContext = {
    config,
    apps: selected,
    async resolveAscApi() {
      if (cachedApi === undefined) {
        const ascKey = await loadActiveAscKey();
        cachedApi = ascKey ? new AppStoreConnectClient(ascKey) : null;
      }
      return cachedApi;
    },
  };

  const outcome = await runPlanners(ctx, planners, { check: input.check === true });

  if (input.json === true) console.log(JSON.stringify(outcome, null, 2));
  else renderOutcome(log, outcome);
  process.exitCode = outcome.exitCode;
}

/** Build the {@link RunPlanInput} from commander's parsed option bag, honoring exact-optional types. */
function toRunInput(surface: string | undefined, options: PlanOptions, forceCheck: boolean): RunPlanInput {
  return {
    ...(options.app !== undefined ? { app: options.app } : {}),
    ...(surface !== undefined ? { surface } : {}),
    check: forceCheck || options.check === true,
    json: options.json === true,
  };
}

/** Attach the `plan` and its `drift` alias to the program. */
export function registerPlanCommand(program: Command): void {
  program
    .command("plan [surface]")
    .description("diff launch.config against live store state (read-only): capabilities, IAPs, subscriptions, pricing")
    .option("-a, --app <names>", "comma-separated app handles (default: all apps)")
    .option("--check", "exit 2 when drift is present (CI gate); same as `launch drift`", false)
    .option("--json", "machine-readable output for CI/agents", false)
    .action(async (surface: string | undefined, options: PlanOptions) => {
      await runPlan(toRunInput(surface, options, false));
    });

  program
    .command("drift [surface]")
    .description("fail when live store state has drifted from launch.config (alias for `launch plan --check`)")
    .option("-a, --app <names>", "comma-separated app handles (default: all apps)")
    .option("--json", "machine-readable output for CI/agents", false)
    .action(async (surface: string | undefined, options: PlanOptions) => {
      await runPlan(toRunInput(surface, options, true));
    });
}
