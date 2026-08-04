import { type FileSystem, Path } from '@effect/platform';
import {
  discoverExtensionBundleIds,
  multiTargetSigningWarnings,
  type TargetSigningReadiness,
} from '../build/appleTargets.js';
import {
  appGroupContainers,
  appGroupPortalNotice,
  mapEntitlementsToCapabilities,
} from './capabilities.js';
import type { AppDescriptor } from '../types/app.js';
import type { DoctorCheck } from '../types/doctor.js';
import { Effect } from 'effect';
/** The read-only App Store Connect surface the signing preflight needs. */
export type SigningPreflightAscApi = {
  findBundleId(identifier: string): Effect.Effect<
    {
      id: string;
    } | null,
    unknown
  >;
  listBundleIdCapabilities(bundleIdResourceId: string): Effect.Effect<
    {
      capabilityType: string;
    }[],
    unknown
  >;
};
/**
 * Resolve the embedded-extension bundle ids to grade: configured (`ios.extensions`) plus any discovered
 * in a generated `ios/*.xcodeproj/project.pbxproj`. Returns `[]` when the native project hasn't been
 * prebuilt yet - the configured list still covers the common case.
 */
export const resolveExtensionBundleIdsForApp = (
  app: AppDescriptor,
): Effect.Effect<string[], unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    let configured: string[] = [];
    if (app.iosExtensions !== undefined) configured = app.iosExtensions;
    const nativeDirectory = pathService.join(app.dir, 'ios');
    const discovered = yield* discoverExtensionBundleIds(nativeDirectory, app.bundleId);
    return [...new Set([...configured, ...discovered])].filter(
      (extensionId) => extensionId !== app.bundleId,
    );
  });
/** The portal-only App Group notice for an app's entitlements, or `null` when none are declared. */
export const appGroupPreflightNotice = (
  entitlements: Record<string, unknown> | undefined,
): string | null => {
  return appGroupPortalNotice(appGroupContainers(entitlements));
};
/**
 * Read each target's App ID registration and live capabilities from App Store Connect. Pure output
 * shape - the network I/O is isolated here so tests can drive {@link multiTargetSigningWarnings} and
 * {@link signingPreflightDoctorChecks} without a client.
 */
export const gatherTargetSigningReadiness = (
  asc: SigningPreflightAscApi,
  bundleId: string,
  extensions: string[],
  entitlements: Record<string, unknown> | undefined,
): Effect.Effect<TargetSigningReadiness[], unknown> => {
  const required = mapEntitlementsToCapabilities(entitlements).enable;
  const targetRequirements: Array<{ id: string; required: string[] }> = [
    { id: bundleId, required },
    ...extensions.map((id) => ({ id, required: [] })),
  ];
  return Effect.forEach(
    targetRequirements,
    ({ id, required: needed }) =>
      Effect.gen(function* () {
        const bundle = yield* asc.findBundleId(id);
        if (!bundle) return { bundleId: id, registered: false, missingCapabilities: [] };
        const enabledCapabilities = yield* asc.listBundleIdCapabilities(bundle.id);
        const enabled = new Set(enabledCapabilities.map((capability) => capability.capabilityType));
        return {
          bundleId: id,
          registered: true,
          missingCapabilities: needed.filter((cap) => !enabled.has(cap)),
        };
      }),
    { concurrency: 'unbounded' },
  );
};
/** Turn readiness facts into build-time warning strings (best-effort - never throws). */
export const signingPreflightWarnings = (readiness: TargetSigningReadiness[]): string[] => {
  return multiTargetSigningWarnings(readiness);
};
/** Turn readiness facts into doctor checks - unregistered/missing-capability targets fail the run. */
export const signingPreflightDoctorChecks = (
  readiness: TargetSigningReadiness[],
  appGroupNotice?: string | null,
): DoctorCheck[] => {
  const checks: DoctorCheck[] = [];
  if (appGroupNotice) {
    checks.push({
      status: 'info',
      title: 'App Groups require portal setup',
      detail: appGroupNotice,
    });
  }
  for (const warning of multiTargetSigningWarnings(readiness)) {
    let targetLabel = readiness.find((target) => warning.includes(target.bundleId))?.bundleId;
    if (targetLabel === undefined) targetLabel = 'target';
    checks.push({
      status: 'fail',
      title: `Signing preflight: ${targetLabel}`,
      detail: warning,
      hint: 'Run `launch creds setup --app <name>` to register and provision each target',
    });
  }
  return checks;
};
