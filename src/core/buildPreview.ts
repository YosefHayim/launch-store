/**
 * A read-only, write-free rehearsal of what `launch build <platform>` would do — the engine behind the
 * `build_plan` MCP tool's `dryRun` capability tier.
 *
 * This is the dry-run twin of `core/pipeline.ts`'s `prepareBuild`, but stripped to the decisions that can
 * be made from config alone: which app, profile, build engine, submitter, distribution, and (on Android)
 * track + rollout a build would resolve to. It performs NO writes, NO network calls, NO child processes,
 * and crucially NO logging — `prepareBuild` drives a stdout `Logger` and resolves credentials/env, both
 * fatal on the MCP stdio transport (which owns stdout) and both side-effecting. The reconcile-style
 * dry-run of *store* state already lives behind `launch plan` / `launch drift`; this fills the build half,
 * letting an agent answer "what would `launch build ios` actually run?" without touching the toolchain.
 *
 * It reuses the pipeline's own pure resolvers (`resolveBuildEngineName`, `resolveSubmitterName`,
 * `resolveAndroidRelease`) so the preview can never disagree with the real run's selection logic.
 */

import type { AppDescriptor, LaunchConfig, Platform, PlayTrack } from "./types.js";
import { resolveAndroidRelease, resolveBuildEngineName, resolveSubmitterName } from "./pipeline.js";

/**
 * One app's resolved build plan — every decision `launch build` would make for it before any expensive
 * native work, with nothing applied. `identifier` is the store-side id for the platform (iOS bundle id /
 * Android package name), absent when the app declares none for that platform (itself a buildable-state
 * signal the agent can flag).
 */
export interface AppBuildPlan {
  /** App handle as discovered (the `--app` selector). */
  app: string;
  /** iOS bundle id / Android package name, or `undefined` when the app targets the other platform only. */
  identifier?: string;
  /** Registered build-engine name the run would use (e.g. `fastlane`, `gradle`, `eas`). */
  buildEngine: string;
  /** Registered submitter name the run would use (e.g. `app-store-connect`, `google-play`). */
  submitter: string;
  /** Android track the run would target; omitted on iOS. */
  track?: string;
  /** Android staged-rollout fraction (0–1) the run would use; omitted on iOS. */
  rollout?: number;
}

/**
 * The full build-plan preview for one `launch build <platform>` invocation across the in-scope apps. Pure
 * data, serialized verbatim by the `build_plan` MCP tool; carries the shared decisions (platform, profile,
 * distribution) once, then the per-app resolution.
 */
export interface BuildPreview {
  platform: Platform;
  /** The build profile name resolved for this run. */
  profile: string;
  /** How the build would be distributed (`store` default, or `internal` for an ad-hoc link). */
  distribution: string;
  /** One resolved plan per in-scope app. */
  apps: AppBuildPlan[];
}

/** What {@link previewBuild} needs: the loaded config, the in-scope apps, and the run's platform/flags. */
export interface BuildPreviewInput {
  config: LaunchConfig;
  apps: AppDescriptor[];
  platform: Platform;
  /** Profile name to preview; defaults to `production` when the config declares it, else the first profile. */
  profile?: string;
  /** Distribution mode (`store` | `internal`); defaults to `store`. */
  distribution?: string;
  /** Android track override (`--track`); falls back to the profile default then the safe per-target floor. */
  track?: PlayTrack;
  /** Android rollout override (`--rollout`); falls back to the profile default then `1.0`. */
  rollout?: number;
}

/** The id an app exposes on a given platform — bundle id for iOS, package name for Android. */
function identifierFor(app: AppDescriptor, platform: Platform): string | undefined {
  return platform === "ios" ? app.bundleId : app.packageName;
}

/**
 * Pick the profile to preview: an explicit name (validated against the config), else `production` when
 * declared, else the first declared profile, else the synthetic `production` the real pipeline falls back
 * to. Throws on an explicit-but-unknown name so a typo surfaces as an error rather than a silent default.
 */
function resolveProfileName(config: LaunchConfig, requested: string | undefined): string {
  const names = Object.keys(config.profiles);
  if (requested !== undefined) {
    if (!(requested in config.profiles)) {
      throw new Error(`Unknown profile "${requested}". Declared profiles: ${names.join(", ") || "none"}.`);
    }
    return requested;
  }
  if ("production" in config.profiles) return "production";
  return names[0] ?? "production";
}

/**
 * Rehearse a `launch build <platform>` run against config alone, writing nothing. Resolves the shared
 * profile/distribution once, then each app's engine, submitter, and (on Android) track + rollout via the
 * pipeline's own resolvers, so the preview tracks the real selection logic by construction.
 */
export function previewBuild(input: BuildPreviewInput): BuildPreview {
  const { config, apps, platform } = input;
  const profileName = resolveProfileName(config, input.profile);
  const profile = config.profiles[profileName] ?? { name: profileName, sizeBudgetMB: 200 };
  const distribution = input.distribution ?? "store";

  const planned = apps.map((app): AppBuildPlan => {
    const identifier = identifierFor(app, platform);
    const base: AppBuildPlan = {
      app: app.name,
      buildEngine: resolveBuildEngineName(config, platform),
      submitter: resolveSubmitterName(config, platform),
      ...(identifier !== undefined ? { identifier } : {}),
    };
    if (platform !== "android") return base;
    // `internal` distribution rehearses an internal-testing upload; `store` rehearses a production release.
    const target = distribution === "internal" ? "testing" : "production";
    const { track, rollout } = resolveAndroidRelease(
      {
        target,
        ...(input.track !== undefined ? { track: input.track } : {}),
        ...(input.rollout !== undefined ? { rollout: input.rollout } : {}),
      },
      profile,
    );
    return { ...base, track, rollout };
  });

  return { platform, profile: profileName, distribution, apps: planned };
}
