/**
 * `launch release-train <start|status|release|abort>` — one command that drives an app's whole release
 * across iOS + Android + OTA as a single, resumable, CI-gradable record (ADR 0004).
 *
 * Thin by design: it resolves config + env, builds the live `TrainEngine` via `core/releaseTrain/builder.ts`
 * (which wraps the existing release primitives — `appStoreRelease`, the Play submitter, the OTA publish
 * core), and hands every decision to `core/releaseTrain/orchestrator.ts`. The train coordinates **submit → review →
 * release → OTA**; the binaries themselves are built first with `launch build` (the train promotes the
 * latest processed build, it does not compile). `start` kicks each car's submit and writes the record;
 * `status` reconciles it forward (the workhorse — run it on a CI cron or with `--watch`); `release`
 * resolves a held/blocked train; `abort` stops it without ever un-releasing a live car (D5).
 *
 * `--hold` (D1) gives a synchronized launch: iOS is submitted for manual release and held until every
 * native car is approved, then released together. Apple honors the held gate; Android promotes to the
 * production track on submit (Google exposes no developer-release gate) — steer its staged rollout with
 * `launch rollout`. The exit codes mirror `launch status` (0 ok · 2 blocked/rejected · 3 in progress · 1 error).
 */

import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import type {
  AppDescriptor,
  BuildProfile,
  Car,
  LaunchConfig,
  TrainRecord,
} from '../../core/types.js';
import { loadConfig } from '../../core/config.js';
import { resolveCommandEnv, selectApp } from '../../core/pipeline.js';
import { createLogger, type Logger } from '../../core/logger.js';
import { addEnvFlags, envOverrides, type EnvFlags } from '../options.js';
import { isCloudStorage } from '../../core/storage.js';
import { resolveRuntimeVersion } from './update.js';
import { buildTrainRuntime, type TrainRuntime } from '../../core/releaseTrain/builder.js';
import { resolveTrainCars } from '../../core/releaseTrain/engine.js';
import {
  advanceTrain,
  isTrainSettled,
  startTrain,
  trainExitCode,
} from '../../core/releaseTrain/orchestrator.js';
import {
  latestTrainRecord,
  listTrainRecords,
  readTrainRecord,
  writeTrainRecord,
} from '../../core/releaseTrain/record.js';
import { isNativeCar, isOtaCar, isTrainPlatform } from '../../core/releaseTrain/guards.js';

/** CLI options for `launch release-train`. */
interface ReleaseTrainOptions extends EnvFlags {
  app?: string;
  /** Build profile whose env feeds the Android submit + OTA export. */
  profile: string;
  /** `start`: restrict the train to one native platform. */
  platform?: string;
  /** `start`: coordinate the native legs only (no OTA followers). */
  ota: boolean;
  /** `start`: hold every car until all native cars are approved, then release together (D1). */
  hold?: boolean;
  /** `start`: the OTA channel followers publish to. */
  channel: string;
  /** `start`: the runtime version OTA followers target (default: from app config). */
  runtimeVersion?: string;
  /** `status`: poll until the train settles. */
  watch?: boolean;
  /** Machine-readable output (the {@link TrainRecord}) for CI/agents. */
  json?: boolean;
}

/** How long to wait between `--watch` reconciles — store states change on the order of minutes. */
const WATCH_INTERVAL_MS = 30_000;

/** Mint a stable train id: the app handle slugged, plus a short random suffix to disambiguate reruns. */
export function mintTrainId(appName: string): string {
  const slug =
    appName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'train';
  return `${slug}-${randomUUID().slice(0, 4)}`;
}

/** A short human label for a car (the native platform, or the OTA follower's channel/runtime). */
export function carLabel(car: Car): string {
  return isOtaCar(car) ? `OTA ${car.platform} (${car.channel}/${car.runtimeVersion})` : car.kind;
}

/** One status line for a car: its label, state, and the most useful identifier or error. */
export function carStatusLine(car: Car): string {
  if (isOtaCar(car)) {
    return `${carLabel(car)}: ${car.state}${car.manifestId ? ` · ${car.manifestId}` : ''}`;
  }
  const detail = car.error ? ` — ${car.error}` : car.buildId ? ` · build ${car.buildId}` : '';
  return `${carLabel(car)}: ${car.state}${detail}`;
}

/** Render the train as a boxed summary: its id/app/lifecycle header, then one line per car. */
function renderTrain(record: TrainRecord, log: Logger): void {
  const header = `Train ${record.id} · ${record.app} · ${record.state}${record.hold ? ' · hold' : ''}`;
  log.box(header, record.cars.map(carStatusLine));
}

/** Resolve the train this verb acts on: an explicit id, else the latest live/recent train. */
function resolveTarget(id: string | undefined): TrainRecord {
  const record = id ? readTrainRecord(id) : latestTrainRecord();
  if (!record) {
    const known = listTrainRecords().map((train) => train.id);
    throw new Error(
      id
        ? `No release train "${id}". Known: ${known.join(', ') || 'none'}.`
        : 'No release train yet. Start one with `launch release-train start`.',
    );
  }
  return record;
}

/** Load config + app + env and build the runtime — the shared head of every verb that touches the store. */
async function prepare(options: ReleaseTrainOptions): Promise<{
  config: LaunchConfig;
  app: AppDescriptor;
  profile: BuildProfile;
  runtime: TrainRuntime;
  log: Logger;
}> {
  const log = createLogger(false);
  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, options.app);
  const profile = config.profiles[options.profile] ?? { name: options.profile };
  const resolvedEnv = await resolveCommandEnv({
    app,
    profile,
    cliEnv: envOverrides(options),
    includeLocal: options.includeLocal,
    envExclude: config.envExclude,
  });
  const runtime = buildTrainRuntime(
    config,
    app,
    profile,
    resolvedEnv.values,
    options.hold === true,
    log,
  );
  return { config, app, profile, runtime, log };
}

/** `start`: resolve the cars from config, kick each native submit, and write the new record. */
async function runStart(options: ReleaseTrainOptions): Promise<void> {
  const platformFilter = options.platform;
  if (platformFilter !== undefined && !isTrainPlatform(platformFilter)) {
    throw new Error(`Unknown --platform "${platformFilter}". Use "ios" or "android".`);
  }
  const { config, app, runtime, log } = await prepare(options);
  const runtimeVersion = resolveRuntimeVersion(app, options.runtimeVersion);
  const cars = resolveTrainCars({
    hasBundleId: app.bundleId !== undefined,
    hasPackageName: app.packageName !== undefined,
    hasCloudStorage: isCloudStorage(config),
    runtimeVersion,
    channel: options.channel,
    ...(platformFilter ? { platformFilter } : {}),
    noOta: !options.ota,
  });
  if (cars.platforms.length === 0) {
    throw new Error(
      `${app.name} declares no iOS bundle id or Android package — nothing to release.`,
    );
  }

  log.step(
    'release-train',
    `starting ${app.name}: ${cars.platforms.join(' + ')}${cars.ota.length ? ' + OTA' : ''}`,
  );
  const record = await startTrain(
    {
      id: mintTrainId(app.name),
      app: app.name,
      hold: options.hold === true,
      platforms: cars.platforms,
      ota: cars.ota,
      now: new Date().toISOString(),
    },
    runtime.engine,
  );
  writeTrainRecord(record);
  report(record, options, log);
  log.info(`Track it with \`launch release-train status ${record.id} --watch\`.`);
}

/** Reconcile a train once (optionally forcing the held gate), persist it, and report. */
async function reconcileOnce(
  record: TrainRecord,
  runtime: TrainRuntime,
  force: boolean,
  log: Logger,
): Promise<TrainRecord> {
  const advanced = await advanceTrain(record, runtime.engine, {
    now: new Date().toISOString(),
    force,
    onWarn: (message) => {
      log.warn(message);
    },
  });
  writeTrainRecord(advanced);
  return advanced;
}

/** `status`: reconcile the train forward (looping under `--watch`) and report. */
async function runStatus(id: string | undefined, options: ReleaseTrainOptions): Promise<void> {
  const target = resolveTarget(id);
  const { runtime, log } = await prepare({ ...options, app: target.app });

  let record = await reconcileOnce(target, runtime, false, log);
  if (options.watch && !options.json) {
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    while (!isTrainSettled(record)) {
      await sleep(WATCH_INTERVAL_MS);
      record = await reconcileOnce(record, runtime, false, log);
      log.gap();
      renderTrain(record, log);
    }
  }
  report(record, options, log);
}

/** `release`: override the hold gate on a held/blocked train and release the ready cars now (D6). */
async function runRelease(id: string | undefined, options: ReleaseTrainOptions): Promise<void> {
  const target = resolveTarget(id);
  const { runtime, log } = await prepare({ ...options, app: target.app });
  const record = await reconcileOnce(target, runtime, true, log);
  report(record, options, log);
}

/** `abort`: stop the train. Never un-releases a live car — just marks the record terminated (D6). */
function runAbort(id: string | undefined, options: ReleaseTrainOptions, log: Logger): void {
  const target = resolveTarget(id);
  const record: TrainRecord = { ...target, state: 'aborted', updatedAt: new Date().toISOString() };
  writeTrainRecord(record);
  log.info(
    `Aborted ${record.id}. Live cars are untouched — roll back explicitly with \`launch rollout pause\` / \`launch updates rollback\`.`,
  );
  report(record, options, log);
}

/** Emit the train as JSON (CI/agents) or the boxed human view, and set the process exit code. */
function report(record: TrainRecord, options: ReleaseTrainOptions, log: Logger): void {
  if (options.json) console.log(JSON.stringify(record, null, 2));
  else renderTrain(record, log);
  process.exitCode = trainExitCode(record);
}

/** Whether a car is still in flight — used only by tests/consumers reasoning about a record. */
export function hasLiveCar(record: TrainRecord): boolean {
  return record.cars.some((car) =>
    isNativeCar(car)
      ? car.state !== 'released' && car.state !== 'failed'
      : car.state !== 'published',
  );
}

/** Attach the `release-train` command to the program. */
export function registerReleaseTrainCommand(program: Command): void {
  const command = program
    .command('release-train')
    .description(
      "coordinate an app's iOS + Android + OTA release as one resumable record (ADR 0004)",
    )
    .argument('[action]', 'start | status | release | abort', 'status')
    .argument('[id]', 'train id (default: the latest train)')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option(
      '-p, --profile <name>',
      'build profile whose env feeds the Android submit + OTA export',
      'production',
    )
    .option('--platform <p>', 'start: restrict to one native platform (ios or android)')
    .option('--no-ota', 'start: coordinate the native legs only (no OTA followers)')
    .option('--hold', 'start: hold every car until all are approved, then release together')
    .option('--channel <name>', 'start: OTA channel the followers publish to', 'production')
    .option(
      '--runtime-version <v>',
      'start: runtime version OTA followers target (default: from app config)',
    )
    .option('--watch', 'status: poll until the train settles', false)
    .option('--json', 'machine-readable output for CI/agents', false);
  addEnvFlags(command).action(
    async (action: string, id: string | undefined, options: ReleaseTrainOptions) => {
      switch (action) {
        case 'start':
          await runStart(options);
          return;
        case 'status':
          await runStatus(id, options);
          return;
        case 'release':
          await runRelease(id, options);
          return;
        case 'abort':
          runAbort(id, options, createLogger(false));
          return;
        default:
          throw new Error(`Unknown action "${action}". Use start | status | release | abort.`);
      }
    },
  );
}
