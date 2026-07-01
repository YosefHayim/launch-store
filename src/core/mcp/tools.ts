/**
 * The Launch MCP tool registry — the `read`-tier reads, the `dryRun`-tier rehearsals, and the `write` /
 * `dangerous`-tier mutations, each gated by the operator's enabled capability tiers.
 *
 * Each tool is a thin adapter: it builds the same context its CLI sibling builds, calls the SAME pure
 * orchestrator (`runPlanners`, `runProbes`, `captureSnapshot`, `inspectDoctor`, `validateConfig`,
 * `runSyncBatch`, …), and returns the structured outcome as JSON via {@link jsonResult}. It deliberately
 * does NOT call the CLI's `run*` wrappers — those print to stdout and set `process.exitCode`, both fatal on
 * the stdio transport (which owns stdout) — it calls the orchestrator underneath them, exactly as the
 * command does. The write tools mutate the store the same way `launch sync` does but with no interactive
 * confirm: opting the server into the `write` (or `dangerous`) tier IS the consent.
 *
 * Adding a tool here is the only edit needed to expose a new capability; the server filters this list by
 * the operator's enabled tiers and wires the survivors to the protocol. Tool names are snake_case (the
 * MCP convention) and mirror the CLI surface (`store doctor` → `store_doctor`).
 */

import { loadConfig, findLaunchConfig } from '../config.js';
import { buildJobs, selectApps } from '../syncJobs.js';
import { runSyncBatch } from '../syncRun.js';
import { createAscClientResolver, createPlayClientResolver } from '../storeClients.js';
import { registerBuiltinPlanners, listSurfacePlanners } from '../plan/registry.js';
import { runPlanners } from '../plan/orchestrator.js';
import type {
  PlanContext,
  ReadinessContext,
  ReadinessCategory,
  SnapshotContext,
  DoctorPlatform,
  McpTool,
  McpToolResult,
  Platform,
} from '../types.js';
import { registerBuiltinProbes, selectReadinessProbes } from '../readiness/registry.js';
import { runProbes } from '../readiness/orchestrator.js';
import { registerBuiltinSources, listSnapshotSources } from '../snapshot/registry.js';
import { captureSnapshot } from '../snapshot/orchestrator.js';
import { diffSnapshots } from '../snapshot/diff.js';
import { listSnapshots, loadSnapshot, saveSnapshot } from '../snapshot/store.js';
import { loadConfigSchema, validateConfig } from '../configSchema.js';
import { checkConfigSemantics } from '../configSemantics.js';
import { renderConfigDocs } from '../docs/configDocs.js';
import { inspectDoctor } from '../doctor/inspect.js';
import { buildDoctorContext } from '../doctor/context.js';
import { previewBuild } from '../buildPreview.js';
/**
 * Build the standard success result for a tool: its structured report (a `PlanOutcome`, a `DoctorReport`,
 * …), pretty-printed as JSON text. `value` is `unknown` because callers pass whatever their orchestrator
 * returns and `JSON.stringify` accepts it directly — no cast, and the concrete type is enforced at the
 * call site, not here.
 */
function jsonResult(value: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/** Read an optional string argument, returning `undefined` for any non-string (incl. missing) value. */
function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

/** The literal token meaning "capture live state now and diff against it" rather than a saved name. */
const LIVE = 'live';

/** A reusable `{ app?: string }` input schema — the comma-separated handle filter every store tool takes. */
const APP_FILTER_SCHEMA = {
  type: 'object',
  properties: {
    app: { type: 'string', description: 'comma-separated app handles (default: all apps)' },
  },
} as const;

/** Build the plan/audit/snapshot store context: config + apps narrowed by `app`, plus the memoized resolvers. */
async function buildStoreContext(
  app: string | undefined,
): Promise<PlanContext & ReadinessContext & SnapshotContext> {
  const { config, apps } = await loadConfig();
  return {
    config,
    apps: selectApps(apps, app),
    resolveAscApi: createAscClientResolver(),
    resolvePlayApi: createPlayClientResolver(),
  };
}

/** Run the plan flow for an optional surface, graded with `check` (the `drift` gate) or not (`plan`). */
async function runPlanTool(
  args: Record<string, unknown>,
  check: boolean,
): Promise<ReturnType<typeof jsonResult>> {
  registerBuiltinPlanners();
  const surface = optionalString(args, 'surface');
  let planners = listSurfacePlanners();
  if (surface !== undefined) {
    const match = planners.find((planner) => planner.id === surface);
    if (!match) {
      const available = planners.map((planner) => planner.id).join(', ') || 'none';
      throw new Error(`Unknown surface "${surface}". Available: ${available}.`);
    }
    planners = [match];
  }
  const ctx = await buildStoreContext(optionalString(args, 'app'));
  return jsonResult(await runPlanners(ctx, planners, { check }));
}

/** Run a readiness sweep over one probe category (`account` / `submit` / `iap`) and return the outcome. */
async function runReadinessTool(
  args: Record<string, unknown>,
  category: ReadinessCategory,
): Promise<ReturnType<typeof jsonResult>> {
  registerBuiltinProbes();
  const ctx = await buildStoreContext(optionalString(args, 'app'));
  return jsonResult(await runProbes(ctx, selectReadinessProbes(category)));
}

/** Capture live state into a {@link import("../types.js").Snapshot}, for the `live` diff arm. */
async function captureLive(app: string | undefined): Promise<ReturnType<typeof captureSnapshot>> {
  registerBuiltinSources();
  const ctx = await buildStoreContext(app);
  return captureSnapshot(ctx, listSnapshotSources(), {
    name: LIVE,
    capturedAt: new Date().toISOString(),
  });
}

/** Run the doctor preflight for an `ios`/`android` arg (default `ios`) and return the structured report. */
async function runDoctorTool(
  args: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResult>> {
  const requested = optionalString(args, 'platform') ?? 'ios';
  if (requested !== 'ios' && requested !== 'android') {
    throw new Error(`Unknown platform "${requested}". Use "ios" or "android".`);
  }
  const platform: DoctorPlatform = requested;
  return jsonResult(
    await inspectDoctor(await buildDoctorContext(platform, optionalString(args, 'app'))),
  );
}

/**
 * Rehearse a `launch build <platform>` run: resolve the engine, submitter, profile, distribution, and (on
 * Android) track + rollout from config, writing nothing. The `dryRun` tier's first tool — it answers "what
 * would a build actually run?" via {@link previewBuild}, which reuses the pipeline's own pure resolvers and
 * never touches the toolchain, network, or stdout.
 */
async function runBuildPlanTool(
  args: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResult>> {
  const requested = optionalString(args, 'platform') ?? 'ios';
  if (requested !== 'ios' && requested !== 'android') {
    throw new Error(`Unknown platform "${requested}". Use "ios" or "android".`);
  }
  const platform: Platform = requested;
  const { config, apps } = await loadConfig();
  const profile = optionalString(args, 'profile');
  const distribution = optionalString(args, 'distribution');
  return jsonResult(
    previewBuild({
      config,
      apps: selectApps(apps, optionalString(args, 'app')),
      platform,
      ...(profile !== undefined ? { profile } : {}),
      ...(distribution !== undefined ? { distribution } : {}),
    }),
  );
}

/**
 * Apply `launch sync` headlessly: reconcile App Store Connect (capabilities, IAPs, subscriptions, pricing,
 * listing copy, screenshots, previews) to match `launch.config.ts` across the selected apps, then return
 * the structured {@link import("../syncRun.js").SyncRunReport}. Shared by the `write`-tier `sync` tool
 * (`allowDestructive: false` — additive only) and the `dangerous`-tier `sync_destructive` tool
 * (`allowDestructive: true` — permits capability removals); the tier IS the consent, so there is no
 * interactive confirm. Resolves the active Apple key once via the same memoized resolver the read tools use.
 */
async function runSyncTool(
  args: Record<string, unknown>,
  allowDestructive: boolean,
): Promise<ReturnType<typeof jsonResult>> {
  const { config, apps } = await loadConfig();
  const jobs = buildJobs(selectApps(apps, optionalString(args, 'app')), config);
  if (jobs.length === 0) {
    return jsonResult({
      apps: [],
      summary: { apps: 0, applied: 0, failed: 0, skipped: 0, planErrors: 0 },
    });
  }
  const client = await createAscClientResolver()();
  if (!client) throw new Error('No active Apple account. Run `launch creds set-key` first.');
  return jsonResult(await runSyncBatch(client, jobs, allowDestructive));
}

/**
 * The v1 read-only tool set. Order is display order in the agent's tool list: the three GitOps/readiness
 * reads, then config introspection, then snapshots, then the local doctor.
 */
export const READ_TOOLS: readonly McpTool[] = [
  {
    name: 'plan',
    description:
      'Diff launch.config against live store state (read-only): capabilities, IAPs, subscriptions, pricing.',
    capability: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        surface: {
          type: 'string',
          description: 'restrict to one surface id (default: all surfaces)',
        },
        app: { type: 'string', description: 'comma-separated app handles (default: all apps)' },
      },
    },
    handler: (args) => runPlanTool(args, false),
  },
  {
    name: 'drift',
    description:
      'Report whether live store state has drifted from launch.config (plan graded as a CI gate).',
    capability: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        surface: {
          type: 'string',
          description: 'restrict to one surface id (default: all surfaces)',
        },
        app: { type: 'string', description: 'comma-separated app handles (default: all apps)' },
      },
    },
    handler: (args) => runPlanTool(args, true),
  },
  {
    name: 'audit',
    description:
      'Pre-submit readiness sweep: would a submission be rejected right now? (read-only)',
    capability: 'read',
    inputSchema: APP_FILTER_SCHEMA,
    handler: (args) => runReadinessTool(args, 'submit'),
  },
  {
    name: 'store_doctor',
    description: 'Store-account readiness: Apple app record, Play onboarding & access (read-only).',
    capability: 'read',
    inputSchema: APP_FILTER_SCHEMA,
    handler: (args) => runReadinessTool(args, 'account'),
  },
  {
    name: 'iap_doctor',
    description:
      'In-app-purchase readiness: products & subscriptions exist and are submittable (read-only).',
    capability: 'read',
    inputSchema: APP_FILTER_SCHEMA,
    handler: (args) => runReadinessTool(args, 'iap'),
  },
  {
    name: 'config_validate',
    description:
      'Validate the launch.config.ts in this directory against the schema (shape errors) plus cross-field semantic checks (advisories), each reported by field path.',
    capability: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const found = await findLaunchConfig();
      if (!found)
        throw new Error('No launch.config.{ts,mjs,js} in this directory. Run `launch init` first.');
      const violations = validateConfig(found.config);
      const semantic = checkConfigSemantics(found.config);
      return jsonResult({ path: found.path, valid: violations.length === 0, violations, semantic });
    },
  },
  {
    name: 'config_schema',
    description: 'Return the JSON Schema for launch.config.ts (generated from the config types).',
    capability: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => jsonResult(loadConfigSchema()),
  },
  {
    name: 'config_docs',
    description: 'Return the launch.config.ts field reference as Markdown.',
    capability: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => jsonResult({ markdown: renderConfigDocs(loadConfigSchema()) }),
  },
  {
    name: 'snapshot_list',
    description: 'List saved store-state snapshots, newest first.',
    capability: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () =>
      jsonResult(
        listSnapshots().map((snapshot) => ({
          name: snapshot.name,
          capturedAt: snapshot.capturedAt,
          reports: snapshot.reports.length,
        })),
      ),
  },
  {
    name: 'snapshot_diff',
    description:
      'Compare a saved snapshot against another saved snapshot or freshly-captured live state (default: live).',
    capability: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        baseline: { type: 'string', description: 'the saved snapshot to compare from' },
        against: {
          type: 'string',
          description: 'another saved snapshot name, or "live" (default)',
        },
        app: { type: 'string', description: 'comma-separated app handles (default: all apps)' },
      },
      required: ['baseline'],
    },
    handler: async (args) => {
      const baselineName = optionalString(args, 'baseline');
      if (baselineName === undefined) throw new Error('`baseline` is required.');
      const baseline = loadSnapshot(baselineName);
      if (!baseline) throw new Error(`No snapshot named "${baselineName}".`);
      const againstName = optionalString(args, 'against') ?? LIVE;
      let against = baseline;
      if (againstName === LIVE) {
        against = (await captureLive(optionalString(args, 'app'))).snapshot;
      } else {
        const loaded = loadSnapshot(againstName);
        if (!loaded) throw new Error(`No snapshot named "${againstName}".`);
        against = loaded;
      }
      return jsonResult(diffSnapshots(baseline, against));
    },
  },
  {
    name: 'snapshot_export',
    description:
      'Return a saved snapshot as JSON; pass capture:true to capture live state into a new saved snapshot first.',
    capability: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'a saved snapshot name to export, OR the name to save a fresh capture under',
        },
        capture: {
          type: 'boolean',
          description: 'capture live state and save it under `name` before exporting',
        },
        app: {
          type: 'string',
          description: 'comma-separated app handles when capturing (default: all apps)',
        },
      },
      required: ['name'],
    },
    handler: async (args) => {
      const name = optionalString(args, 'name');
      if (name === undefined) throw new Error('`name` is required.');
      if (args['capture'] === true) {
        const result = await captureLive(optionalString(args, 'app'));
        const snapshot = { ...result.snapshot, name };
        const file = saveSnapshot(snapshot);
        return jsonResult({ ...result, snapshot, file });
      }
      const snapshot = loadSnapshot(name);
      if (!snapshot) throw new Error(`No snapshot named "${name}".`);
      return jsonResult(snapshot);
    },
  },
  {
    name: 'doctor',
    description:
      'Local preflight: build toolchain + store-account reachability for ios (default) or android (read-only).',
    capability: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['ios', 'android'],
          description: 'ios (default) or android',
        },
        app: { type: 'string', description: 'comma-separated app handles (default: all apps)' },
      },
    },
    handler: runDoctorTool,
  },
];

/**
 * The `dryRun` tool set: tools that *rehearse* a mutation and report what they would do, writing nothing.
 * Gated behind the `dryRun` capability tier (operator opts in with `mcp: { capabilities: ["read", "dryRun"] }`),
 * registered through the same {@link import("./gate.js").gateTools} as {@link READ_TOOLS}. v1 ships one: a
 * build-plan preview — the read-only twin of the store dry-run that `plan`/`drift` already cover.
 */
export const DRY_RUN_TOOLS: readonly McpTool[] = [
  {
    name: 'build_plan',
    description:
      'Rehearse `launch build`: resolve the engine, submitter, profile, distribution, and Android track/rollout from config. Writes nothing.',
    capability: 'dryRun',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['ios', 'android'],
          description: 'ios (default) or android',
        },
        app: { type: 'string', description: 'comma-separated app handles (default: all apps)' },
        profile: {
          type: 'string',
          description: 'build profile to preview (default: production, else the first profile)',
        },
        distribution: {
          type: 'string',
          enum: ['store', 'internal'],
          description: 'store (default) or internal',
        },
      },
    },
    handler: runBuildPlanTool,
  },
];

/**
 * The `write` tool set: tools that mutate the store but only *additively* — they create and update, never
 * remove. Gated behind the `write` capability tier (operator opts in with `mcp: { capabilities: ["read",
 * "write"] }`); because tiers don't nest, granting `write` does NOT grant `dangerous`. v1 ships one: `sync`,
 * the headless twin of `launch sync` — it applies `launch.config.ts` to App Store Connect with no
 * interactive confirm, since opting the server into the tier IS the consent.
 */
export const WRITE_TOOLS: readonly McpTool[] = [
  {
    name: 'sync',
    description:
      'Apply launch.config to App Store Connect (capabilities, IAPs, subscriptions, pricing, listing copy, screenshots, previews). Additive — creates and updates, never removes. Writes to the store.',
    capability: 'write',
    inputSchema: APP_FILTER_SCHEMA,
    handler: (args) => runSyncTool(args, false),
  },
];

/**
 * The `dangerous` tool set: mutations that can REMOVE store state and are not cleanly reversible. Gated
 * behind the `dangerous` capability tier (operator opts in with `mcp: { capabilities: [..., "dangerous"]
 * }`), a separate grant from `write`. v1 ships one: `sync_destructive` — `sync` plus destructive removals
 * (the equivalent of `launch sync --allow-destructive`), e.g. removing a capability that config no longer
 * declares. The tier opt-in is the consent; there is no interactive confirm on the stdio transport.
 */
export const DANGEROUS_TOOLS: readonly McpTool[] = [
  {
    name: 'sync_destructive',
    description:
      'Like `sync`, but also performs DESTRUCTIVE removals (equivalent to `launch sync --allow-destructive`), e.g. removing a capability config no longer declares. Irreversible — use with care.',
    capability: 'dangerous',
    inputSchema: APP_FILTER_SCHEMA,
    handler: (args) => runSyncTool(args, true),
  },
];

/** Every tool across all capability tiers — the registry the server gates by the operator's enabled tiers. */
export const ALL_TOOLS: readonly McpTool[] = [
  ...READ_TOOLS,
  ...DRY_RUN_TOOLS,
  ...WRITE_TOOLS,
  ...DANGEROUS_TOOLS,
];
