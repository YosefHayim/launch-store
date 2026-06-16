import { describe, expect, it, vi } from "vitest";
import { appRecordProbe } from "./appRecord.js";
import { subscriptionGroupProbe } from "./subscriptionGroup.js";
import { playAppProbe } from "./playApp.js";
import { playFirstUploadProbe } from "./playFirstUpload.js";
import { playInternalTrackProbe } from "./playInternalTrack.js";
import type { AscReadinessApi, PlayReadinessApi, ProbeResult, ReadinessContext } from "../types.js";
import type { AppDescriptor, LaunchConfig } from "../../types.js";

/** A minimal valid config; pass `products` to exercise the subscription-group scope. */
function config(products?: LaunchConfig["products"]): LaunchConfig {
  return {
    profiles: {},
    credentials: "local",
    storage: "local",
    buildEngine: "fastlane",
    submit: "app-store-connect",
    ...(products ? { products } : {}),
  };
}

/** A discovered app; override `bundleId`/`packageName` to scope it to a store. */
function app(over: Partial<AppDescriptor> = {}): AppDescriptor {
  return { name: "app", dir: "/a", configPath: "/a/app.json", ...over };
}

/** A read-only ASC fake — only the methods readiness reads exist, so a write is impossible by construction. */
function ascApi(over: Partial<AscReadinessApi> = {}): AscReadinessApi {
  return { getAppId: vi.fn(async () => "app-1"), listSubscriptionGroups: vi.fn(async () => [{ id: "g1" }]), ...over };
}

/** A read-only Play fake, mirroring {@link ascApi}. */
function playApi(over: Partial<PlayReadinessApi> = {}): PlayReadinessApi {
  return {
    assertAppExists: vi.fn(async () => undefined),
    getLatestVersionCode: vi.fn(async () => 42),
    listTracks: vi.fn(async () => [{ track: "internal" }]),
    ...over,
  };
}

/** Build a context with explicit clients (or `null` to simulate unconfigured credentials). */
function ctx(args: {
  apps: AppDescriptor[];
  asc?: AscReadinessApi | null;
  play?: PlayReadinessApi | null;
  products?: LaunchConfig["products"];
}): ReadinessContext {
  return {
    config: config(args.products),
    apps: args.apps,
    resolveAscApi: async () => args.asc ?? null,
    resolvePlayApi: async () => args.play ?? null,
  };
}

/** The per-app status + identifier of a `checked` result (empty for any other state). */
function findings(result: ProbeResult): { status: string; identifier: string }[] {
  return result.state === "checked" ? result.apps.map(({ status, identifier }) => ({ status, identifier })) : [];
}

describe("appRecordProbe", () => {
  it("omits itself when no app has a bundle id", async () => {
    const result = await appRecordProbe.check(ctx({ apps: [app({ packageName: "com.x" })] }));
    expect(result.state).toBe("omitted");
  });

  it("skips when no Apple account is configured", async () => {
    const result = await appRecordProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: null }));
    expect(result.state).toBe("skipped");
  });

  it("passes when the app record exists, blocks when it doesn't", async () => {
    const ok = await appRecordProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const api = ascApi({ getAppId: vi.fn(async () => null) });
    const missing = await appRecordProbe.check(ctx({ apps: [app({ bundleId: "com.x" })], asc: api }));
    expect(findings(missing)).toEqual([{ status: "blocker", identifier: "com.x" }]);
    expect(api.getAppId).toHaveBeenCalledWith("com.x");
  });
});

describe("subscriptionGroupProbe", () => {
  const withSubs = { "com.x": { subscriptionGroups: [{ referenceName: "g", localizations: [], subscriptions: [] }] } };

  it("omits itself when no app declares subscriptions", async () => {
    const result = await subscriptionGroupProbe.check(ctx({ apps: [app({ bundleId: "com.x" })] }));
    expect(result.state).toBe("omitted");
  });

  it("blocks when the declared group is absent and passes when present", async () => {
    const empty = ascApi({ listSubscriptionGroups: vi.fn(async () => []) });
    const missing = await subscriptionGroupProbe.check(
      ctx({ apps: [app({ bundleId: "com.x" })], asc: empty, products: withSubs }),
    );
    expect(findings(missing)).toEqual([{ status: "blocker", identifier: "com.x" }]);

    const ok = await subscriptionGroupProbe.check(
      ctx({ apps: [app({ bundleId: "com.x" })], asc: ascApi(), products: withSubs }),
    );
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);
  });

  it("warns instead of blocking when the app record isn't there to check against", async () => {
    const api = ascApi({ getAppId: vi.fn(async () => null) });
    const result = await subscriptionGroupProbe.check(
      ctx({ apps: [app({ bundleId: "com.x" })], asc: api, products: withSubs }),
    );
    expect(findings(result)).toEqual([{ status: "warn", identifier: "com.x" }]);
  });
});

describe("playAppProbe", () => {
  it("passes when the app is reachable, blocks when Play rejects it", async () => {
    const ok = await playAppProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: playApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const denied = playApi({
      assertAppExists: vi.fn(async () => {
        throw new Error("app not found");
      }),
    });
    const blocked = await playAppProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: denied }));
    expect(findings(blocked)).toEqual([{ status: "blocker", identifier: "com.x" }]);
  });
});

describe("playFirstUploadProbe", () => {
  it("passes with an uploaded build, blocks at versionCode 0, warns on a read failure", async () => {
    const ok = await playFirstUploadProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: playApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const none = playApi({ getLatestVersionCode: vi.fn(async () => 0) });
    const blocked = await playFirstUploadProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: none }));
    expect(findings(blocked)).toEqual([{ status: "blocker", identifier: "com.x" }]);

    const broken = playApi({
      getLatestVersionCode: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    const warned = await playFirstUploadProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: broken }));
    expect(findings(warned)).toEqual([{ status: "warn", identifier: "com.x" }]);
  });
});

describe("playInternalTrackProbe", () => {
  it("passes when an internal track exists, warns when it doesn't", async () => {
    const ok = await playInternalTrackProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: playApi() }));
    expect(findings(ok)).toEqual([{ status: "ok", identifier: "com.x" }]);

    const noTrack = playApi({ listTracks: vi.fn(async () => [{ track: "production" }]) });
    const warned = await playInternalTrackProbe.check(ctx({ apps: [app({ packageName: "com.x" })], play: noTrack }));
    expect(findings(warned)).toEqual([{ status: "warn", identifier: "com.x" }]);
  });
});
