export type TrainPlatform = 'ios' | 'android';
/**
 * A native (iOS / Android) car's lifecycle. Linear happy path with two failure exits:
 * `building -> submitted -> in-review -> approved -> released`, where `in-review` can go `rejected` and any
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
 * A native platform car - the iOS or Android leg of the release. Carries the build it submitted and, on a
 * `rejected` / `failed` car, the reason, so a reconcile can report why the train is holding.
 */
export type NativeCar = {
  kind: TrainPlatform;
  state: NativeCarState;
  buildId?: string;
  error?: string;
  updatedAt: string;
};
/**
 * An OTA car - a JS bundle that follows its native platform live. Gated per-platform (D4): it publishes
 * only once the native build carrying its `runtimeVersion` is released in that platform's store, so JS is
 * never pushed to a runtime version users don't have yet.
 */
export type OtaCar = {
  kind: 'ota';
  platform: TrainPlatform;
  channel: string;
  runtimeVersion: string;
  state: OtaCarState;
  manifestId?: string;
  updatedAt: string;
};
/** One car of a train - a native platform leg or an OTA follower. */
export type Car = NativeCar | OtaCar;
/**
 * One app's coordinated release, persisted at `~/.launch/release-trains/<id>.json`. Created by
 * `release-train start`, advanced by `release-train status`. Holds every car plus the train-wide gate
 * (`hold`) and lifecycle (`state`).
 */
export type TrainRecord = {
  id: string;
  app: string;
  hold: boolean;
  state: TrainState;
  createdAt: string;
  updatedAt: string;
  cars: Car[];
};
