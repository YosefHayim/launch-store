import { describe, expect, it, vi } from "vitest";
import {
  advanceTrain,
  deriveTrainState,
  isTrainSettled,
  startTrain,
  trainExitCode,
  type TrainEngine,
} from "./orchestrator.js";
import { isNativeCar, isOtaCar, type Car, type NativeCarState, type TrainRecord } from "./types.js";

const NOW = "2026-06-16T00:00:00.000Z";
const LATER = "2026-06-16T01:00:00.000Z";

/**
 * A scripted {@link TrainEngine}: `readNative` returns the next queued state per platform, and every call
 * is recorded so a test can assert what the orchestrator did (and, crucially, did NOT) drive. It exposes
 * no undo/rollback — matching the real engine — so the no-auto-undo guarantee is structural here too.
 */
function fakeEngine(
  reads: Partial<Record<string, NativeCarState[]>> = {},
  overrides: Partial<TrainEngine> = {},
): TrainEngine & { calls: string[] } {
  const queues = new Map<string, NativeCarState[]>(Object.entries(reads).map(([k, v]) => [k, [...(v ?? [])]]));
  const calls: string[] = [];
  return {
    calls,
    submitNative: (car) => {
      calls.push(`submit:${car.kind}`);
      return Promise.resolve({ buildId: `${car.kind}-100` });
    },
    readNative: (car) => {
      calls.push(`read:${car.kind}`);
      const queue = queues.get(car.kind) ?? [];
      return Promise.resolve(queue.shift() ?? car.state);
    },
    releaseNative: (car) => {
      calls.push(`release:${car.kind}`);
      return Promise.resolve();
    },
    publishOta: (car) => {
      calls.push(`publishOta:${car.platform}`);
      return Promise.resolve({ manifestId: `${car.platform}-manifest` });
    },
    ...overrides,
  };
}

/** A running train with one iOS native car (in the given state) and its pending OTA follower. */
function iosTrain(state: NativeCarState, over: Partial<TrainRecord> = {}): TrainRecord {
  return {
    id: "app-ab12",
    app: "app",
    hold: false,
    state: "running",
    createdAt: NOW,
    updatedAt: NOW,
    cars: [
      { kind: "ios", state, updatedAt: NOW },
      {
        kind: "ota",
        platform: "ios",
        channel: "production",
        runtimeVersion: "1.0.0",
        state: "pending",
        updatedAt: NOW,
      },
    ],
    ...over,
  };
}

function native(record: TrainRecord, platform: string): Car | undefined {
  return record.cars.find((car) => isNativeCar(car) && car.kind === platform);
}
function ota(record: TrainRecord, platform: string): Car | undefined {
  return record.cars.find((car) => isOtaCar(car) && car.platform === platform);
}

describe("startTrain", () => {
  it("submits every native car, adds pending OTA followers, and starts running", async () => {
    const engine = fakeEngine();
    const record = await startTrain(
      {
        id: "app-ab12",
        app: "app",
        hold: false,
        platforms: ["ios", "android"],
        ota: [{ platform: "ios", channel: "production", runtimeVersion: "1.0.0" }],
        now: NOW,
      },
      engine,
    );

    expect(engine.calls).toEqual(["submit:ios", "submit:android"]);
    expect(record.state).toBe("running");
    expect(native(record, "ios")).toMatchObject({ state: "submitted", buildId: "ios-100" });
    expect(native(record, "android")).toMatchObject({ state: "submitted" });
    expect(ota(record, "ios")).toMatchObject({ state: "pending" });
  });

  it("records a submit precondition failure on that car without aborting the others", async () => {
    const engine = fakeEngine(
      {},
      {
        submitNative: (car) => {
          if (car.kind === "ios") return Promise.reject(new Error("no processed build"));
          return Promise.resolve({ buildId: "android-100" });
        },
      },
    );
    const record = await startTrain(
      { id: "app-ab12", app: "app", hold: false, platforms: ["ios", "android"], ota: [], now: NOW },
      engine,
    );
    expect(native(record, "ios")).toMatchObject({ state: "failed", error: "no processed build" });
    expect(native(record, "android")).toMatchObject({ state: "submitted" });
  });
});

describe("advanceTrain — release-when-ready (no hold)", () => {
  it("adopts the live state of an in-flight car", async () => {
    const engine = fakeEngine({ ios: ["in-review"] });
    const record = await advanceTrain(iosTrain("submitted"), engine, { now: LATER });
    expect(native(record, "ios")).toMatchObject({ state: "in-review", updatedAt: LATER });
    expect(record.state).toBe("running");
  });

  it("publishes the OTA follower once its platform reads released, and never calls releaseNative", async () => {
    const engine = fakeEngine({ ios: ["released"] });
    const record = await advanceTrain(iosTrain("in-review"), engine, { now: LATER });
    expect(native(record, "ios")).toMatchObject({ state: "released" });
    expect(ota(record, "ios")).toMatchObject({ state: "published", manifestId: "ios-manifest" });
    expect(record.state).toBe("done");
    expect(engine.calls).not.toContain("release:ios"); // AFTER_APPROVAL auto-releases; nothing to fire
  });

  it("does not publish the OTA follower while its platform is still in review", async () => {
    const engine = fakeEngine({ ios: ["in-review"] });
    const record = await advanceTrain(iosTrain("submitted"), engine, { now: LATER });
    expect(ota(record, "ios")).toMatchObject({ state: "pending" });
    expect(engine.calls).not.toContain("publishOta:ios");
  });

  it("leaves the OTA car pending and warns when publish throws (retried next reconcile)", async () => {
    const onWarn = vi.fn();
    const engine = fakeEngine({ ios: ["released"] }, { publishOta: () => Promise.reject(new Error("bucket offline")) });
    const record = await advanceTrain(iosTrain("in-review"), engine, { now: LATER, onWarn });
    expect(ota(record, "ios")).toMatchObject({ state: "pending" });
    expect(onWarn).toHaveBeenCalledOnce();
    expect(record.state).toBe("running");
  });
});

describe("advanceTrain — hold gate", () => {
  function heldTwoPlatform(iosState: NativeCarState, androidState: NativeCarState): TrainRecord {
    return {
      id: "app-ab12",
      app: "app",
      hold: true,
      state: "running",
      createdAt: NOW,
      updatedAt: NOW,
      cars: [
        { kind: "ios", state: iosState, updatedAt: NOW },
        { kind: "android", state: androidState, updatedAt: NOW },
      ],
    };
  }

  it("holds an approved car while the other platform is still in review", async () => {
    const engine = fakeEngine();
    const record = await advanceTrain(heldTwoPlatform("approved", "in-review"), engine, { now: LATER });
    expect(native(record, "ios")).toMatchObject({ state: "approved" });
    expect(engine.calls).not.toContain("release:ios");
    expect(record.state).toBe("running");
  });

  it("releases every car together once all native cars are approved", async () => {
    const engine = fakeEngine({ android: ["approved"] });
    const record = await advanceTrain(heldTwoPlatform("approved", "in-review"), engine, { now: LATER });
    expect(engine.calls).toContain("release:ios");
    expect(engine.calls).toContain("release:android");
    expect(native(record, "ios")).toMatchObject({ state: "released" });
    expect(native(record, "android")).toMatchObject({ state: "released" });
    expect(record.state).toBe("done");
  });

  it("enters blocked when a held car is rejected, firing no releases", async () => {
    const engine = fakeEngine({ ios: ["rejected"] });
    const record = await advanceTrain(heldTwoPlatform("submitted", "approved"), engine, { now: LATER });
    expect(record.state).toBe("blocked");
    expect(native(record, "ios")).toMatchObject({ state: "rejected" });
    expect(engine.calls).not.toContain("release:android"); // held back by the rejection
    expect(trainExitCode(record)).toBe(2);
  });

  it("force-releases the ready cars on a blocked train, leaving the failed car tracked", async () => {
    const blocked = {
      id: "app-ab12",
      app: "app",
      hold: true,
      state: "blocked" as const,
      createdAt: NOW,
      updatedAt: NOW,
      cars: [
        { kind: "ios" as const, state: "failed" as const, error: "rejected", updatedAt: NOW },
        { kind: "android" as const, state: "approved" as const, updatedAt: NOW },
      ],
    };
    const engine = fakeEngine();
    const record = await advanceTrain(blocked, engine, { now: LATER, force: true });
    expect(engine.calls).toContain("release:android");
    expect(native(record, "android")).toMatchObject({ state: "released" });
    expect(native(record, "ios")).toMatchObject({ state: "failed", error: "rejected" });
    expect(record.state).toBe("done"); // both cars terminal
  });
});

describe("advanceTrain — invariants", () => {
  it("never reads, releases, or publishes for a terminal (done) train", async () => {
    const engine = fakeEngine({ ios: ["released"] });
    const done = iosTrain("released", { state: "done" });
    const record = await advanceTrain(done, engine, { now: LATER });
    expect(engine.calls).toEqual([]);
    expect(record).toBe(done);
  });

  it("does not mutate the input record", async () => {
    const engine = fakeEngine({ ios: ["released"] });
    const input = iosTrain("in-review");
    await advanceTrain(input, engine, { now: LATER });
    expect(native(input, "ios")).toMatchObject({ state: "in-review", updatedAt: NOW });
  });

  it("never invokes any undo/rollback path across a full release (no such method exists)", async () => {
    // The engine has no undo method; assert the only side-effecting calls are forward ones.
    const engine = fakeEngine({ ios: ["released"] });
    const record = await advanceTrain(iosTrain("approved", { hold: true }), engine, { now: LATER, force: true });
    expect(engine.calls.every((call) => /^(submit|read|release|publishOta):/.test(call))).toBe(true);
    expect(native(record, "ios")).toMatchObject({ state: "released" });
  });
});

describe("deriveTrainState / trainExitCode / isTrainSettled", () => {
  it("is done only when every car is terminal", () => {
    expect(
      deriveTrainState(
        [
          { kind: "ios", state: "released", updatedAt: NOW },
          { kind: "ota", platform: "ios", channel: "c", runtimeVersion: "1", state: "published", updatedAt: NOW },
        ],
        false,
        false,
      ),
    ).toBe("done");
  });

  it("blocks a held train with a failure unless forced", () => {
    const cars: Car[] = [
      { kind: "ios", state: "failed", updatedAt: NOW },
      { kind: "android", state: "in-review", updatedAt: NOW },
    ];
    expect(deriveTrainState(cars, true, false)).toBe("blocked");
    expect(deriveTrainState(cars, true, true)).toBe("running");
    expect(deriveTrainState(cars, false, false)).toBe("running");
  });

  it("ranks exit codes ok < in-progress < blocked", () => {
    const allTerminal: TrainRecord = {
      id: "app-ab12",
      app: "app",
      hold: false,
      state: "done",
      createdAt: NOW,
      updatedAt: NOW,
      cars: [
        { kind: "ios", state: "released", updatedAt: NOW },
        {
          kind: "ota",
          platform: "ios",
          channel: "production",
          runtimeVersion: "1.0.0",
          state: "published",
          updatedAt: NOW,
        },
      ],
    };
    expect(trainExitCode(allTerminal)).toBe(0);
    expect(trainExitCode(iosTrain("in-review"))).toBe(3); // OTA still pending → in flight
    expect(trainExitCode(iosTrain("rejected"))).toBe(2);
  });

  it("settles a watch loop on done/aborted/blocked only", () => {
    expect(isTrainSettled(iosTrain("released", { state: "done" }))).toBe(true);
    expect(isTrainSettled(iosTrain("failed", { state: "aborted" }))).toBe(true);
    expect(isTrainSettled(iosTrain("rejected", { state: "blocked" }))).toBe(true);
    expect(isTrainSettled(iosTrain("in-review", { state: "running" }))).toBe(false);
  });
});
