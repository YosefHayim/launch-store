import { describe, expect, it, vi } from 'vitest';
import type { Car, NativeCar, NativeCarState, TrainRecord } from '../types/releaseTrain.ts';
import { isNativeCar, isOtaCar } from './guards.ts';
import {
  advanceTrain,
  deriveTrainState,
  isNativeApprovedOrReleased,
  isNativeFailure,
  isReleaseGateOpen,
  isTrainSettled,
  startTrain,
  trainExitCode,
  type TrainEngine,
} from './orchestrator.ts';

const NOW = '2026-06-16T00:00:00.000Z';
const LATER = '2026-06-16T01:00:00.000Z';

function fakeEngine(
  reads: Partial<Record<string, NativeCarState[]>> = {},
  overrides: Partial<TrainEngine> = {},
): TrainEngine & { calls: string[] } {
  const queues = new Map<string, NativeCarState[]>();

  for (const [platform, stateQueue] of Object.entries(reads)) {
    if (stateQueue != null) {
      queues.set(platform, [...stateQueue]);
    }
  }

  const calls: string[] = [];

  async function submitNative(trainCar: NativeCar): Promise<{ buildId: string }> {
    calls.push(`submit:${trainCar.kind}`);

    return { buildId: `${trainCar.kind}-100` };
  }

  async function readNative(trainCar: NativeCar): Promise<NativeCarState> {
    calls.push(`read:${trainCar.kind}`);
    const stateQueue = queues.get(trainCar.kind);

    if (stateQueue == null) {
      return trainCar.state;
    }

    const nextCarPhase = stateQueue.shift();

    if (nextCarPhase == null) {
      return trainCar.state;
    }

    return nextCarPhase;
  }

  async function releaseNative(trainCar: NativeCar): Promise<void> {
    calls.push(`release:${trainCar.kind}`);
  }

  async function publishOta(trainCar: { platform: string }): Promise<{ manifestId: string }> {
    calls.push(`publishOta:${trainCar.platform}`);

    return { manifestId: `${trainCar.platform}-manifest` };
  }

  const engine: TrainEngine & { calls: string[] } = {
    calls,
    submitNative,
    readNative,
    releaseNative,
    publishOta,
  };
  const submitOverride = overrides.submitNative;
  const readOverride = overrides.readNative;
  const releaseOverride = overrides.releaseNative;
  const publishOverride = overrides.publishOta;

  if (submitOverride != null) {
    return { ...engine, submitNative: submitOverride };
  }

  if (readOverride != null) {
    return { ...engine, readNative: readOverride };
  }

  if (releaseOverride != null) {
    return { ...engine, releaseNative: releaseOverride };
  }

  if (publishOverride != null) {
    return { ...engine, publishOta: publishOverride };
  }

  return engine;
}

function iosTrain(carPhase: NativeCarState, over: Partial<TrainRecord> = {}): TrainRecord {
  return {
    id: 'app-ab12',
    app: 'app',
    hold: false,
    state: 'running',
    createdAt: NOW,
    updatedAt: NOW,
    cars: [
      { kind: 'ios', state: carPhase, updatedAt: NOW },
      {
        kind: 'ota',
        platform: 'ios',
        channel: 'production',
        runtimeVersion: '1.0.0',
        state: 'pending',
        updatedAt: NOW,
      },
    ],
    ...over,
  };
}

function native(record: TrainRecord, platform: string): Car | undefined {
  function isPlatformCar(trainCar: Car): boolean {
    if (isNativeCar(trainCar) == false) {
      return false;
    }

    return trainCar.kind == platform;
  }

  return record.cars.find(isPlatformCar);
}

function ota(record: TrainRecord, platform: string): Car | undefined {
  function isPlatformCar(trainCar: Car): boolean {
    if (isOtaCar(trainCar) == false) {
      return false;
    }

    return trainCar.platform == platform;
  }

  return record.cars.find(isPlatformCar);
}

describe('startTrain', () => {
  it('submits every native car, adds pending OTA followers, and starts running', async () => {
    const engine = fakeEngine();
    const record = await startTrain(
      {
        id: 'app-ab12',
        app: 'app',
        hold: false,
        platforms: ['ios', 'android'],
        ota: [{ platform: 'ios', channel: 'production', runtimeVersion: '1.0.0' }],
        now: NOW,
      },
      engine,
    );
    expect(engine.calls).toEqual(['submit:ios', 'submit:android']);
    expect(record.state).toBe('running');
    expect(native(record, 'ios')).toMatchObject({ state: 'submitted', buildId: 'ios-100' });
    expect(native(record, 'android')).toMatchObject({ state: 'submitted' });
    expect(ota(record, 'ios')).toMatchObject({ state: 'pending' });
  });

  it('records a submit precondition failure on that car without aborting the others', async () => {
    async function submitNative(trainCar: NativeCar): Promise<{ buildId: string }> {
      if (trainCar.kind == 'ios') {
        throw new Error('no processed build');
      }

      return { buildId: 'android-100' };
    }

    const engine = fakeEngine({}, { submitNative });
    const record = await startTrain(
      {
        id: 'app-ab12',
        app: 'app',
        hold: false,
        platforms: ['ios', 'android'],
        ota: [],
        now: NOW,
      },
      engine,
    );
    expect(native(record, 'ios')).toMatchObject({ state: 'failed', error: 'no processed build' });
    expect(native(record, 'android')).toMatchObject({ state: 'submitted' });
  });

  it('submits native cars at the same time instead of one after another', async () => {
    let markAndroidSubmitted: (() => void) | null = null;
    const androidSubmitted = new Promise<void>(function captureAndroidStart(
      startAndroid: () => void,
    ): void {
      markAndroidSubmitted = startAndroid;
    });

    async function submitNative(trainCar: NativeCar): Promise<{ buildId: string }> {
      if (trainCar.kind == 'ios') {
        await androidSubmitted;

        return { buildId: 'ios-100' };
      }

      const startAndroid = markAndroidSubmitted;

      if (startAndroid == null) {
        throw new Error('android start signal missing');
      }

      startAndroid();

      return { buildId: 'android-100' };
    }

    const engine = fakeEngine({}, { submitNative });
    const record = await startTrain(
      {
        id: 'app-ab12',
        app: 'app',
        hold: false,
        platforms: ['ios', 'android'],
        ota: [],
        now: NOW,
      },
      engine,
    );
    expect(native(record, 'ios')).toMatchObject({ state: 'submitted', buildId: 'ios-100' });
    expect(native(record, 'android')).toMatchObject({ state: 'submitted', buildId: 'android-100' });
  });
});

describe('advanceTrain - release-when-ready (no hold)', () => {
  it('adopts the live state of an in-flight car', async () => {
    const engine = fakeEngine({ ios: ['in-review'] });
    const record = await advanceTrain(iosTrain('submitted'), engine, { now: LATER });
    expect(native(record, 'ios')).toMatchObject({ state: 'in-review', updatedAt: LATER });
    expect(record.state).toBe('running');
  });

  it('publishes the OTA follower once its platform reads released, and never calls releaseNative', async () => {
    const engine = fakeEngine({ ios: ['released'] });
    const record = await advanceTrain(iosTrain('in-review'), engine, { now: LATER });
    expect(native(record, 'ios')).toMatchObject({ state: 'released' });
    expect(ota(record, 'ios')).toMatchObject({ state: 'published', manifestId: 'ios-manifest' });
    expect(record.state).toBe('done');
    expect(engine.calls).not.toContain('release:ios');
  });

  it('does not publish the OTA follower while its platform is still in review', async () => {
    const engine = fakeEngine({ ios: ['in-review'] });
    const record = await advanceTrain(iosTrain('submitted'), engine, { now: LATER });
    expect(ota(record, 'ios')).toMatchObject({ state: 'pending' });
    expect(engine.calls).not.toContain('publishOta:ios');
  });

  it('leaves the OTA car pending and warns when publish throws (retried next reconcile)', async () => {
    const onWarn = vi.fn();

    async function publishOta(): Promise<{ manifestId?: string }> {
      throw new Error('bucket offline');
    }

    const engine = fakeEngine({ ios: ['released'] }, { publishOta });
    const record = await advanceTrain(iosTrain('in-review'), engine, { now: LATER, onWarn });
    expect(ota(record, 'ios')).toMatchObject({ state: 'pending' });
    expect(onWarn).toHaveBeenCalledOnce();
    expect(record.state).toBe('running');
  });
});

describe('advanceTrain - hold gate', () => {
  function heldTwoPlatform(iosPhase: NativeCarState, androidPhase: NativeCarState): TrainRecord {
    return {
      id: 'app-ab12',
      app: 'app',
      hold: true,
      state: 'running',
      createdAt: NOW,
      updatedAt: NOW,
      cars: [
        { kind: 'ios', state: iosPhase, updatedAt: NOW },
        { kind: 'android', state: androidPhase, updatedAt: NOW },
      ],
    };
  }

  it('holds an approved car while the other platform is still in review', async () => {
    const engine = fakeEngine();
    const record = await advanceTrain(heldTwoPlatform('approved', 'in-review'), engine, {
      now: LATER,
    });
    expect(native(record, 'ios')).toMatchObject({ state: 'approved' });
    expect(engine.calls).not.toContain('release:ios');
    expect(record.state).toBe('running');
  });

  it('releases every car together once all native cars are approved', async () => {
    const engine = fakeEngine({ android: ['approved'] });
    const record = await advanceTrain(heldTwoPlatform('approved', 'in-review'), engine, {
      now: LATER,
    });
    expect(engine.calls).toContain('release:ios');
    expect(engine.calls).toContain('release:android');
    expect(native(record, 'ios')).toMatchObject({ state: 'released' });
    expect(native(record, 'android')).toMatchObject({ state: 'released' });
    expect(record.state).toBe('done');
  });

  it('enters blocked when a held car is rejected, firing no releases', async () => {
    const engine = fakeEngine({ ios: ['rejected'] });
    const record = await advanceTrain(heldTwoPlatform('submitted', 'approved'), engine, {
      now: LATER,
    });
    expect(record.state).toBe('blocked');
    expect(native(record, 'ios')).toMatchObject({ state: 'rejected' });
    expect(engine.calls).not.toContain('release:android');
    expect(trainExitCode(record)).toBe(2);
  });

  it('force-releases the ready cars on a blocked train, leaving the failed car tracked', async () => {
    const blocked = {
      id: 'app-ab12',
      app: 'app',
      hold: true,
      state: 'blocked' as const,
      createdAt: NOW,
      updatedAt: NOW,
      cars: [
        { kind: 'ios' as const, state: 'failed' as const, error: 'rejected', updatedAt: NOW },
        { kind: 'android' as const, state: 'approved' as const, updatedAt: NOW },
      ],
    };
    const engine = fakeEngine();
    const record = await advanceTrain(blocked, engine, { now: LATER, force: true });
    expect(engine.calls).toContain('release:android');
    expect(native(record, 'android')).toMatchObject({ state: 'released' });
    expect(native(record, 'ios')).toMatchObject({ state: 'failed', error: 'rejected' });
    expect(record.state).toBe('done');
  });
});

describe('advanceTrain - invariants', () => {
  it('never reads, releases, or publishes for a terminal (done) train', async () => {
    const engine = fakeEngine({ ios: ['released'] });
    const done = iosTrain('released', { state: 'done' });
    const record = await advanceTrain(done, engine, { now: LATER });
    expect(engine.calls).toEqual([]);
    expect(record).toBe(done);
  });

  it('does not mutate the input record', async () => {
    const engine = fakeEngine({ ios: ['released'] });
    const inputRecord = iosTrain('in-review');
    await advanceTrain(inputRecord, engine, { now: LATER });
    expect(native(inputRecord, 'ios')).toMatchObject({ state: 'in-review', updatedAt: NOW });
  });

  it('never invokes any undo/rollback path across a full release (no such method exists)', async () => {
    const engine = fakeEngine({ ios: ['released'] });
    const record = await advanceTrain(iosTrain('approved', { hold: true }), engine, {
      now: LATER,
      force: true,
    });

    function isForwardCall(call: string): boolean {
      return /^(submit|read|release|publishOta):/.test(call);
    }

    expect(engine.calls.every(isForwardCall)).toBe(true);
    expect(native(record, 'ios')).toMatchObject({ state: 'released' });
  });
});

describe('release gate helpers', () => {
  it('classifies native failures and approved-or-released cars', () => {
    expect(isNativeFailure({ kind: 'ios', state: 'rejected', updatedAt: NOW })).toBe(true);
    expect(isNativeFailure({ kind: 'ios', state: 'failed', updatedAt: NOW })).toBe(true);
    expect(isNativeFailure({ kind: 'ios', state: 'approved', updatedAt: NOW })).toBe(false);
    expect(isNativeApprovedOrReleased({ kind: 'ios', state: 'approved', updatedAt: NOW })).toBe(
      true,
    );
    expect(isNativeApprovedOrReleased({ kind: 'ios', state: 'released', updatedAt: NOW })).toBe(
      true,
    );
    expect(isNativeApprovedOrReleased({ kind: 'ios', state: 'in-review', updatedAt: NOW })).toBe(
      false,
    );
  });

  it('opens the gate for release-when-ready, hold-all-approved, and force', () => {
    expect(isReleaseGateOpen(false, false, false, false)).toBe(true);
    expect(isReleaseGateOpen(true, false, false, false)).toBe(false);
    expect(isReleaseGateOpen(true, false, false, true)).toBe(true);
    expect(isReleaseGateOpen(true, true, true, false)).toBe(true);
    expect(isReleaseGateOpen(true, false, true, true)).toBe(false);
  });
});

describe('deriveTrainState / trainExitCode / isTrainSettled', () => {
  it('is done only when every car is terminal', () => {
    expect(
      deriveTrainState(
        [
          { kind: 'ios', state: 'released', updatedAt: NOW },
          {
            kind: 'ota',
            platform: 'ios',
            channel: 'c',
            runtimeVersion: '1',
            state: 'published',
            updatedAt: NOW,
          },
        ],
        false,
        false,
      ),
    ).toBe('done');
  });

  it('blocks a held train with a failure unless forced', () => {
    const cars: Car[] = [
      { kind: 'ios', state: 'failed', updatedAt: NOW },
      { kind: 'android', state: 'in-review', updatedAt: NOW },
    ];
    expect(deriveTrainState(cars, true, false)).toBe('blocked');
    expect(deriveTrainState(cars, true, true)).toBe('running');
    expect(deriveTrainState(cars, false, false)).toBe('running');
  });

  it('ranks exit codes ok < in-progress < blocked', () => {
    const allTerminal: TrainRecord = {
      id: 'app-ab12',
      app: 'app',
      hold: false,
      state: 'done',
      createdAt: NOW,
      updatedAt: NOW,
      cars: [
        { kind: 'ios', state: 'released', updatedAt: NOW },
        {
          kind: 'ota',
          platform: 'ios',
          channel: 'production',
          runtimeVersion: '1.0.0',
          state: 'published',
          updatedAt: NOW,
        },
      ],
    };
    expect(trainExitCode(allTerminal)).toBe(0);
    expect(trainExitCode(iosTrain('in-review'))).toBe(3);
    expect(trainExitCode(iosTrain('rejected'))).toBe(2);
  });

  it('settles a watch loop on done/aborted/blocked only', () => {
    expect(isTrainSettled(iosTrain('released', { state: 'done' }))).toBe(true);
    expect(isTrainSettled(iosTrain('failed', { state: 'aborted' }))).toBe(true);
    expect(isTrainSettled(iosTrain('rejected', { state: 'blocked' }))).toBe(true);
    expect(isTrainSettled(iosTrain('in-review', { state: 'running' }))).toBe(false);
  });
});
