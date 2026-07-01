/**
 * The `launch release-train` engine: a small state machine over the existing release primitives
 * (`appStoreRelease`, the Play submitter, the OTA publish core). UI-free, like `core/plan/orchestrator.ts`
 * — the command (`cli/commands/releaseTrain.ts`) resolves credentials, builds the live {@link TrainEngine},
 * and renders; this module owns only the decisions, so the whole state machine unit-tests against a fake
 * engine with no network. See `docs/adr/0004-release-train.md`.
 *
 * Two operations:
 * - {@link startTrain} kicks each car's submit and writes the initial record (cars resolved by the command).
 * - {@link advanceTrain} reconciles the record forward — reads each native car's live state, opens the gate
 *   when policy allows, fires the ready releases, publishes the OTA followers whose platform went live, and
 *   recomputes the train's lifecycle.
 *
 * The engine exposes **no undo/rollback method**, which is the structural form of ADR 0004 D5: the train
 * can never auto-revert a live car — recovery stays explicit (`launch rollout pause`, `launch updates
 * rollback`). A spy test asserts no such call is ever made.
 */

import { isCarTerminal, isNativeCar, isOtaCar } from './guards.js';
import type {
  Car,
  NativeCar,
  NativeCarState,
  OtaCar,
  TrainPlatform,
  TrainRecord,
  TrainState,
} from '../types.js';

/**
 * The live operations the orchestrator drives — one method per car action, each wrapping an existing core
 * primitive. The command supplies the real implementation (`core/releaseTrain/engine.ts`); tests pass a
 * fake. Methods do the work or throw; the orchestrator owns the resulting car state (mirrors how
 * `appStoreRelease`'s `act()` captures a step's failure rather than letting it abort the walk). There is
 * deliberately no `undo`/`rollback` — see the module header.
 */
export interface TrainEngine {
  /** Promote the latest valid build for this platform and submit it for review. Throws on a precondition. */
  submitNative(car: NativeCar): Promise<{ buildId?: string }>;
  /** Read this car's current live store state (in-review / approved / released / rejected). */
  readNative(car: NativeCar): Promise<NativeCarState>;
  /** Fire this car's release now — press the held developer release (iOS) / complete the rollout. */
  releaseNative(car: NativeCar): Promise<void>;
  /** Publish this OTA car's bundle now that its native platform is live. Returns the manifest id. */
  publishOta(car: OtaCar): Promise<{ manifestId?: string }>;
}

/** An OTA follower to coordinate, resolved from config by the command (one per native platform with a channel). */
export interface OtaCarSpec {
  /** The native platform whose release opens this follower's gate. */
  platform: TrainPlatform;
  /** The channel the bundle publishes to. */
  channel: string;
  /** The runtime version this update targets. */
  runtimeVersion: string;
}

/** Everything {@link startTrain} needs — the train identity, its cars (resolved from config), and the gate. */
export interface StartTrainInput {
  /** Stable train id / record filename stem (an app slug + short suffix), minted by the command. */
  id: string;
  /** The app handle this train coordinates (one app per train — ADR D2). */
  app: string;
  /** Hold-until-all-approved (ADR D1): no car releases until every native car is approved. */
  hold: boolean;
  /** The native platforms to coordinate, in display order. */
  platforms: TrainPlatform[];
  /** OTA followers to coordinate; empty under `--no-ota` or with no cloud storage. */
  ota: OtaCarSpec[];
  /** ISO-8601 "now" — injected so the record's timestamps are deterministic in tests. */
  now: string;
}

/** Options for one {@link advanceTrain} reconcile. */
export interface AdvanceOptions {
  /** ISO-8601 "now" stamped on every car this reconcile changes. */
  now: string;
  /** Override the `--hold` gate and release the ready cars now — the `release` verb resolving a blocked train. */
  force?: boolean;
  /** Sink for non-fatal warnings (e.g. an OTA publish that will be retried next reconcile). */
  onWarn?: (message: string) => void;
}

/** Process exit codes for `release-train status --json`, mirroring `launch status` (worst-wins, error first). */
export const TRAIN_EXIT = { ok: 0, error: 1, blocked: 2, inProgress: 3 } as const;

/** Reduce an unknown thrown value to a message, narrowing `Error` first (no `unknown` left in flow). */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a native car has stopped at a failure the train must surface (rejected or failed). */
function isNativeFailure(car: NativeCar): boolean {
  return car.state === 'rejected' || car.state === 'failed';
}

/**
 * Resolve the train's lifecycle from its cars and gate. `done` once every car is terminal; `blocked` when
 * a held train has a rejected/failed native car needing an operator (ADR D5) — skipped after an explicit
 * `release`, which is the operator acting; otherwise `running`.
 */
export function deriveTrainState(cars: Car[], hold: boolean, forced: boolean): TrainState {
  if (cars.every(isCarTerminal)) return 'done';
  if (hold && !forced && cars.filter(isNativeCar).some(isNativeFailure)) return 'blocked';
  return 'running';
}

/**
 * Create a train: submit each native car for review, add its OTA followers as `pending`, and derive the
 * initial lifecycle. A car whose submit throws a precondition (no processed build, no app record) is
 * recorded `failed` with the reason rather than aborting the others — the same per-car isolation the rest
 * of the release flow uses, so one platform's problem never strands the train.
 */
export async function startTrain(
  input: StartTrainInput,
  engine: TrainEngine,
): Promise<TrainRecord> {
  const cars: Car[] = [];
  for (const platform of input.platforms) {
    const car: NativeCar = { kind: platform, state: 'building', updatedAt: input.now };
    try {
      const { buildId } = await engine.submitNative(car);
      car.state = 'submitted';
      if (buildId !== undefined) car.buildId = buildId;
    } catch (error) {
      car.state = 'failed';
      car.error = message(error);
    }
    cars.push(car);
  }
  for (const ota of input.ota) {
    cars.push({
      kind: 'ota',
      platform: ota.platform,
      channel: ota.channel,
      runtimeVersion: ota.runtimeVersion,
      state: 'pending',
      updatedAt: input.now,
    });
  }
  return {
    id: input.id,
    app: input.app,
    hold: input.hold,
    state: deriveTrainState(cars, input.hold, false),
    createdAt: input.now,
    updatedAt: input.now,
    cars,
  };
}

/**
 * Reconcile a train forward one step and return the updated record (the caller persists it — this stays
 * pure and I/O-free, like the plan orchestrator). In order:
 *
 * 1. **Read** every non-terminal native car's live store state and adopt it.
 * 2. **Gate** the synchronized release: open when forced (`release`), when not holding, or when every
 *    native car is approved — and never while a held train is blocked by a rejection.
 * 3. **Fire** each approved car's release through the gate (a held train sits its cars at `approved` until
 *    this opens; an unheld train's cars reach `released` on their own and skip this).
 * 4. **Publish** each `pending` OTA follower whose native platform is now `released` (per-platform gate, D4).
 * 5. **Recompute** the train's lifecycle.
 *
 * A terminal train (`done` / `aborted`) is returned untouched. The input record is not mutated.
 */
export async function advanceTrain(
  record: TrainRecord,
  engine: TrainEngine,
  options: AdvanceOptions,
): Promise<TrainRecord> {
  if (record.state === 'done' || record.state === 'aborted') return record;

  const { now } = options;
  const forced = options.force === true;
  const cars = record.cars.map((car): Car => ({ ...car }));

  // 1. Read live state for every native car still in flight.
  for (const car of cars) {
    if (!isNativeCar(car) || isCarTerminal(car)) continue;
    const next = await engine.readNative(car);
    if (next !== car.state) {
      car.state = next;
      car.updatedAt = now;
      if (!isNativeFailure(car)) delete car.error;
    }
  }

  // 2. Decide whether the release gate is open this reconcile.
  const natives = cars.filter(isNativeCar);
  const blocked = record.hold && !forced && natives.some(isNativeFailure);
  const allApproved = natives.every((car) => car.state === 'approved' || car.state === 'released');
  const gateOpen = forced || (!blocked && (!record.hold || allApproved));

  // 3. Fire the release for every approved car once the gate is open.
  if (gateOpen) {
    for (const car of natives) {
      if (car.state !== 'approved') continue;
      try {
        await engine.releaseNative(car);
        car.state = 'released';
        car.updatedAt = now;
        delete car.error;
      } catch (error) {
        car.state = 'failed';
        car.error = message(error);
        car.updatedAt = now;
      }
    }
  }

  // 4. Publish each pending OTA follower whose native platform just went live (per-platform gate, D4).
  for (const car of cars) {
    if (!isOtaCar(car) || car.state !== 'pending') continue;
    const native = natives.find((candidate) => candidate.kind === car.platform);
    if (native?.state !== 'released') continue;
    try {
      const { manifestId } = await engine.publishOta(car);
      car.state = 'published';
      if (manifestId !== undefined) car.manifestId = manifestId;
      car.updatedAt = now;
    } catch (error) {
      // Non-fatal: leave it pending so the next reconcile retries; never abort the other cars.
      options.onWarn?.(
        `OTA ${car.platform} (${car.channel}/${car.runtimeVersion}) publish failed: ${message(error)}`,
      );
    }
  }

  // 5. Recompute the train's lifecycle from the advanced cars.
  return { ...record, cars, state: deriveTrainState(cars, record.hold, forced), updatedAt: now };
}

/**
 * The process exit code for a train, in the `launch status` priority order (error › blocked › in progress
 * › ok). A rejected/failed car or a `blocked` train reports `blocked` (2); any car still in flight reports
 * `inProgress` (3); an all-terminal train with no failures is `ok` (0).
 */
export function trainExitCode(record: TrainRecord): number {
  const failed = record.cars.filter(isNativeCar).some(isNativeFailure);
  if (record.state === 'blocked' || failed) return TRAIN_EXIT.blocked;
  if (record.cars.some((car) => !isCarTerminal(car))) return TRAIN_EXIT.inProgress;
  return TRAIN_EXIT.ok;
}

/**
 * Whether further reconciling is pointless — a `--watch` loop stops here. True once the train is `done` or
 * `aborted`, and on `blocked` (which needs an operator decision, not more polling).
 */
export function isTrainSettled(record: TrainRecord): boolean {
  return record.state === 'done' || record.state === 'aborted' || record.state === 'blocked';
}
