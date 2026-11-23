export type TrainPlatform = 'ios' | 'android';

/** A native (iOS / Android) car's lifecycle. */
export type NativeCarState =
  | 'building'
  | 'submitted'
  | 'in-review'
  | 'approved'
  | 'released'
  | 'rejected'
  | 'failed';

/** An OTA car's lifecycle: it waits `pending` until its native platform is live, then `published` (D4). */
type OtaCarState = 'pending' | 'published';

/** The whole train's lifecycle: `running` until every car is terminal (`done`); `blocked` needs an operator. */
export type TrainState = 'running' | 'blocked' | 'done' | 'aborted';

/** A native platform car - the iOS or Android leg of the release. */
export type NativeCar = Readonly<{
  kind: TrainPlatform;
  state: NativeCarState;
  buildId?: string;
  error?: string;
  updatedAt: string;
}>;

/** An OTA car - a JS bundle that follows its native platform live. */
export type OtaCar = Readonly<{
  kind: 'ota';
  platform: TrainPlatform;
  channel: string;
  runtimeVersion: string;
  state: OtaCarState;
  manifestId?: string;
  updatedAt: string;
}>;

/** One car of a train - a native platform leg or an OTA follower. */
export type Car = NativeCar | OtaCar;

/** One app's coordinated release, persisted at `~/.launch/release-trains/<id>.json`. */
export type TrainRecord = Readonly<{
  id: string;
  app: string;
  hold: boolean;
  state: TrainState;
  createdAt: string;
  updatedAt: string;
  cars: readonly Car[];
}>;
