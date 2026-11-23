import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../path-exists.ts';
import {
  parsePbxprojTargets,
  splitMainAndExtensions,
  multiTargetSigningWarnings,
  type TargetSigningReadiness,
} from '../build/apple-targets.ts';
import {
  appGroupContainers,
  appGroupPortalNotice,
  readCapabilitiesFromEntitlements,
} from './capabilities.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { DoctorCheck } from '../types/doctor.ts';

/** The read-only App Store Connect surface the signing preflight needs. */
type SigningPreflightAscApi = {
  findBundleId(identifier: string): Promise<{ id: string } | null>;
  listBundleIdCapabilities(bundleIdResourceId: string): Promise<{ capabilityType: string }[]>;
};

async function readExtensionBundleIds(
  nativeDirectory: string,
  mainBundleId: string | undefined,
): Promise<string[]> {
  const isNativeDirectoryPresent = await pathExists(nativeDirectory);

  if (isNativeDirectoryPresent == false) {
    return [];
  }

  let directoryNames: string[];

  try {
    directoryNames = await readdir(nativeDirectory);
  } catch (error) {
    throw new Error(`Could not read ${nativeDirectory}`, { cause: error });
  }

  function isXcodeProject(directoryName: string): boolean {
    return directoryName.endsWith('.xcodeproj');
  }

  const projectDirectory = directoryNames.find(isXcodeProject);

  if (projectDirectory == null) {
    return [];
  }

  const projectFile = join(nativeDirectory, projectDirectory, 'project.pbxproj');
  const isProjectFilePresent = await pathExists(projectFile);

  if (isProjectFilePresent == false) {
    return [];
  }

  let projectText: string;

  try {
    projectText = await readFile(projectFile, 'utf8');
  } catch (error) {
    throw new Error(`Could not read ${projectFile}`, { cause: error });
  }

  const targets = parsePbxprojTargets(projectText);

  return splitMainAndExtensions(targets, mainBundleId).extensions;
}

/** Resolve the embedded-extension bundle ids to grade */
export async function resolveExtensionBundleIdsForApp(app: AppDescriptor): Promise<string[]> {
  let configured: readonly string[] = [];

  if (app.iosExtensions != null) {
    configured = app.iosExtensions;
  }

  const nativeDirectory = join(app.dir, 'ios');
  const discovered = await readExtensionBundleIds(nativeDirectory, app.bundleId);

  function isNotMainBundle(extensionId: string): boolean {
    return extensionId != app.bundleId;
  }

  return [...new Set([...configured, ...discovered])].filter(isNotMainBundle);
}

/** The portal-only App Group notice for an app's entitlements, or `null` when none are declared. */
export function appGroupPreflightNotice(
  entitlements: Record<string, unknown> | undefined,
): string | null {
  return appGroupPortalNotice(appGroupContainers(entitlements));
}

type TargetRequirement = {
  id: string;
  required: string[];
};

/** Read each target's App ID registration and live capabilities from App Store Connect. */
export async function gatherTargetSigningReadiness(
  asc: SigningPreflightAscApi,
  bundleId: string,
  extensions: readonly string[],
  entitlements: Record<string, unknown> | undefined,
): Promise<TargetSigningReadiness[]> {
  const required = readCapabilitiesFromEntitlements(entitlements).enable;

  function extensionRequirement(extensionId: string): TargetRequirement {
    return { id: extensionId, required: [] };
  }

  const targetRequirements: TargetRequirement[] = [
    { id: bundleId, required },
    ...extensions.map(extensionRequirement),
  ];

  async function readTarget(targetRequirement: TargetRequirement): Promise<TargetSigningReadiness> {
    const bundle = await asc.findBundleId(targetRequirement.id);

    const isUnregistered = bundle == null;

    if (isUnregistered) {
      return { bundleId: targetRequirement.id, registered: false, missingCapabilities: [] };
    }

    const enabledCapabilities = await asc.listBundleIdCapabilities(bundle.id);

    function capabilityTypeOf(capability: { capabilityType: string }): string {
      return capability.capabilityType;
    }

    const enabled = new Set(enabledCapabilities.map(capabilityTypeOf));

    function isCapabilityMissing(capabilityType: string): boolean {
      return enabled.has(capabilityType) == false;
    }

    return {
      bundleId: targetRequirement.id,
      registered: true,
      missingCapabilities: targetRequirement.required.filter(isCapabilityMissing),
    };
  }

  return Promise.all(targetRequirements.map(readTarget));
}

/** Turn readiness facts into build-time warning strings (best-effort - never throws). */
export function signingPreflightWarnings(readiness: readonly TargetSigningReadiness[]): string[] {
  return multiTargetSigningWarnings(readiness);
}

function hasAppGroupNotice(notice: string | null | undefined): notice is string {
  if (notice == null) {
    return false;
  }

  return notice != '';
}

/** Turn readiness facts into doctor checks - unregistered/missing-capability targets fail the run. */
export function signingPreflightDoctorChecks(
  readiness: TargetSigningReadiness[],
  appGroupNotice?: string | null,
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  if (hasAppGroupNotice(appGroupNotice)) {
    checks.push({
      status: 'info',
      title: 'App Groups require portal setup',
      detail: appGroupNotice,
    });
  }

  for (const warning of multiTargetSigningWarnings(readiness)) {
    function warningMentionsTarget(target: TargetSigningReadiness): boolean {
      return warning.includes(target.bundleId);
    }

    const matchedTarget = readiness.find(warningMentionsTarget);
    let targetLabel = 'target';

    if (matchedTarget != null) {
      targetLabel = matchedTarget.bundleId;
    }

    checks.push({
      status: 'fail',
      title: `Signing preflight: ${targetLabel}`,
      detail: warning,
      hint: 'Run `launch-store creds setup --app <name>` to register and provision each target',
    });
  }

  return checks;
}
