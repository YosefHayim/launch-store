/**
 * The persisted shapes behind `launch release-train` — the cross-store coordinated release (ADR 0004).
 *
 * A **train** is one app's whole release; each platform (and each OTA follower) is a **car**. The record
 * is the single source of truth, advanced by reconcile (`status`) the same way `~/.launch/build-state/`
 * is — never a daemon. These shapes mirror the plan surface types: a discriminated union the
 * orchestrator walks without naming concrete states inline. The car classifiers that read them
 * (`isOtaCar`, `isCarTerminal`, …) are runtime logic, so they live in `core/releaseTrain/guards.ts`.
 */

/**
 * The native platforms a release train coordinates. The train orchestrates iOS + Android only; the newer
 * Apple platforms (`tvos`/`macos`/`visionos` of the `Platform` union) build and submit directly via
 * `launch build` / `launch release`, but are not yet cars in the multi-platform train — so this is
 * deliberately narrower than `Platform`, and the CLI rejects a `--platform` outside it.
 */
export type TrainPlatform = 'ios' | 'android';

/**
 * A native (iOS / Android) car's lifecycle. Linear happy path with two failure exits:
 * `building → submitted → in-review → approved → released`, where `in-review` can go `rejected` and any
 * non-terminal step can end `failed`. `released` / `failed` are terminal.
 */
export type NativeCarState =
  | 'building'
  | 'submitted'
  | 'in-review'
  | 'approved'
  | 'released'
  | 'rejected'
  | 'failed';

/** An OTA car's lifecycle: it waits `pending` until its native platform is live, then `published` (D4). */
export type OtaCarState = 'pending' | 'published';

/** Every car state, for code that handles both kinds uniformly. */
export type CarState = NativeCarState | OtaCarState;

/** The whole train's lifecycle: `running` until every car is terminal (`done`); `blocked` needs an operator. */
export type TrainState = 'running' | 'blocked' | 'done' | 'aborted';

/**
 * A native platform car — the iOS or Android leg of the release. Carries the build it submitted and, on a
 * `rejected` / `failed` car, the reason, so a reconcile can report why the train is holding.
 */
export interface NativeCar {
  /** The native platform; also discriminates this from an {@link OtaCar} (whose `kind` is `"ota"`). */
  kind: TrainPlatform;
  /** Where this car is in its review→release lifecycle. */
  state: NativeCarState;
  /** The build this car submitted, once known — the artifact id `launch builds` tracks. */
  buildId?: string;
  /** Why the car is `rejected` / `failed`; absent otherwise. */
  error?: string;
  /** ISO-8601 timestamp of this car's last state change. */
  updatedAt: string;
}

/**
 * An OTA car — a JS bundle that follows its native platform live. Gated per-platform (D4): it publishes
 * only once the native build carrying its `runtimeVersion` is released in that platform's store, so JS is
 * never pushed to a runtime version users don't have yet.
 */
export interface OtaCar {
  /** Discriminant: always `"ota"`. */
  kind: 'ota';
  /** The native platform whose release opens this car's gate. */
  platform: TrainPlatform;
  /** The release channel the bundle publishes to (`launch update --channel`). */
  channel: string;
  /** The runtime version this update targets — the gate matches on it. */
  runtimeVersion: string;
  /** `pending` until the native release fires, then `published`. */
  state: OtaCarState;
  /** The published manifest's id, set once `state` is `"published"`. */
  manifestId?: string;
  /** ISO-8601 timestamp of this car's last state change. */
  updatedAt: string;
}

/** One car of a train — a native platform leg or an OTA follower. */
export type Car = NativeCar | OtaCar;

/**
 * One app's coordinated release, persisted at `~/.launch/release-trains/<id>.json`. Created by
 * `release-train start`, advanced by `release-train status`. Holds every car plus the train-wide gate
 * (`hold`) and lifecycle (`state`).
 */
export interface TrainRecord {
  /** Stable id (an app slug + short suffix); also the record's filename stem. */
  id: string;
  /** The app handle this train coordinates — one app per train (ADR D2). */
  app: string;
  /** Hold-until-all-approved: when true, no car releases until every native car is approved (ADR D1). */
  hold: boolean;
  /** The train's lifecycle state. */
  state: TrainState;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp of the last reconcile that advanced or persisted the record. */
  updatedAt: string;
  /** Every car: the native platform legs plus their OTA followers. */
  cars: Car[];
}
