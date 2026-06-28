/**
 * Shared iOS signing preflight — the early, actionable checks that fire BEFORE a ~15-minute archive
 * instead of letting `xcodebuild` die at exit 65 (issue #261). Used by the build pipeline
 * ({@link signingPreflightWarnings}) and `launch doctor` ({@link signingPreflightDoctorChecks}) so
 * both surfaces share one readiness model and one message vocabulary.
 *
 * The App Store Connect reads (bundle-id registration + live capabilities) live here; the pure
 * warning phrasing lives in {@link multiTargetSigningWarnings}. App Group *container* creation is
 * portal-only — surfaced as an advisory notice, not an API check.
 */

import { join } from 'node:path';
import {
  discoverExtensionBundleIds,
  multiTargetSigningWarnings,
  type TargetSigningReadiness,
} from './appleTargets.js';
import {
  appGroupContainers,
  appGroupPortalNotice,
  mapEntitlementsToCapabilities,
} from './capabilities.js';
import type { AppDescriptor } from './types.js';
import type { DoctorCheck } from './doctor/types.js';

/** The read-only App Store Connect surface the signing preflight needs. */
export interface SigningPreflightAscApi {
  findBundleId(identifier: string): Promise<{ id: string } | null>;
  listBundleIdCapabilities(bundleIdResourceId: string): Promise<{ capabilityType: string }[]>;
}

/**
 * Resolve the embedded-extension bundle ids to grade: configured (`ios.extensions`) plus any discovered
 * in a generated `ios/*.xcodeproj/project.pbxproj`. Returns `[]` when the native project hasn't been
 * prebuilt yet — the configured list still covers the common case.
 */
export function resolveExtensionBundleIdsForApp(app: AppDescriptor): string[] {
  const configured = app.iosExtensions ?? [];
  const nativeDir = join(app.dir, 'ios');
  const discovered = discoverExtensionBundleIds(nativeDir, app.bundleId);
  return [...new Set([...configured, ...discovered])].filter((id) => id !== app.bundleId);
}

/** The portal-only App Group notice for an app's entitlements, or `null` when none are declared. */
export function appGroupPreflightNotice(
  entitlements: Record<string, unknown> | undefined,
): string | null {
  return appGroupPortalNotice(appGroupContainers(entitlements));
}

/**
 * Read each target's App ID registration and live capabilities from App Store Connect. Pure output
 * shape — the network I/O is isolated here so tests can drive {@link multiTargetSigningWarnings} and
 * {@link signingPreflightDoctorChecks} without a client.
 */
export async function gatherTargetSigningReadiness(
  asc: SigningPreflightAscApi,
  bundleId: string,
  extensions: string[],
  entitlements: Record<string, unknown> | undefined,
): Promise<TargetSigningReadiness[]> {
  const required = mapEntitlementsToCapabilities(entitlements).enable;
  return Promise.all(
    [{ id: bundleId, required }, ...extensions.map((id) => ({ id, required: [] as string[] }))].map(
      async ({ id, required: needed }) => {
        const bundle = await asc.findBundleId(id);
        if (!bundle) return { bundleId: id, registered: false, missingCapabilities: [] };
        const enabled = new Set(
          (await asc.listBundleIdCapabilities(bundle.id)).map((cap) => cap.capabilityType),
        );
        return {
          bundleId: id,
          registered: true,
          missingCapabilities: needed.filter((cap) => !enabled.has(cap)),
        };
      },
    ),
  );
}

/** Turn readiness facts into build-time warning strings (best-effort — never throws). */
export function signingPreflightWarnings(readiness: TargetSigningReadiness[]): string[] {
  return multiTargetSigningWarnings(readiness);
}

/** Turn readiness facts into doctor checks — unregistered/missing-capability targets fail the run. */
export function signingPreflightDoctorChecks(
  readiness: TargetSigningReadiness[],
  appGroupNotice?: string | null,
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  if (appGroupNotice) {
    checks.push({
      status: 'info',
      title: 'App Groups require portal setup',
      detail: appGroupNotice,
    });
  }
  for (const warning of multiTargetSigningWarnings(readiness)) {
    checks.push({
      status: 'fail',
      title: `Signing preflight: ${readiness.find((target) => warning.includes(target.bundleId))?.bundleId ?? 'target'}`,
      detail: warning,
      hint: 'Run `launch creds setup --app <name>` to register and provision each target',
    });
  }
  return checks;
}
