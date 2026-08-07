import { Effect } from 'effect';
import { entitlementForCapability, isCapabilityEntitlement } from '../credentials/capabilities.js';
import type { AdoptTarget, Adopter, EntitlementValue, PlannedWrite } from '../types/adopt.js';
import type { CapabilitySetting } from '../types/appleCatalog.js';
import {
  extractProfileEntitlements,
  type ProfileEntitlementRequirements,
} from './profileEntitlements.js';

export const NEEDS_VALUE = 'NEEDS_VALUE';

export type PlannedEntitlement = Readonly<{
  key: string;
  value: EntitlementValue;
  note?: string;
}>;

export type CapabilityPlanInput = Readonly<{
  enabledTypes: readonly string[];
  settingsByType: Readonly<Record<string, readonly CapabilitySetting[]>>;
  profileEntitlements: Readonly<Record<string, EntitlementValue>> | null;
  existing: Readonly<Record<string, unknown>>;
}>;

/** Render capability settings as concise key/value advice. */
const describeSettings = (
  settings: readonly CapabilitySetting[] | undefined,
): string | undefined => {
  if (settings === undefined) return undefined;
  if (settings.length === 0) return undefined;
  const settingDescriptions = settings.map((setting) => {
    if (setting.options === undefined) return setting.key;
    if (setting.options.length === 0) return setting.key;
    const firstOption = setting.options[0];
    if (firstOption === undefined) return setting.key;
    return `${setting.key}=${firstOption.key}`;
  });
  if (settingDescriptions.length === 0) return undefined;
  return settingDescriptions.join(', ');
};

/** Plan missing entitlement values without overwriting existing app configuration. */
export const planCapabilityEntitlements = (
  capabilityPlan: CapabilityPlanInput,
): PlannedEntitlement[] => {
  const plannedEntitlements = new Map<string, PlannedEntitlement>();
  let profileEntitlements: Readonly<Record<string, EntitlementValue>> = {};
  if (capabilityPlan.profileEntitlements !== null)
    profileEntitlements = capabilityPlan.profileEntitlements;
  for (const [entitlementKey, entitlementValue] of Object.entries(profileEntitlements)) {
    if (!isCapabilityEntitlement(entitlementKey)) continue;
    if (entitlementKey in capabilityPlan.existing) continue;
    plannedEntitlements.set(entitlementKey, {
      key: entitlementKey,
      value: entitlementValue,
    });
  }

  for (const capabilityType of capabilityPlan.enabledTypes) {
    const entitlementKey = entitlementForCapability(capabilityType);
    if (entitlementKey === undefined) continue;
    if (entitlementKey in capabilityPlan.existing) continue;
    if (plannedEntitlements.has(entitlementKey)) continue;
    let note = 'enabled on App Store Connect but no value in the provisioning profile';
    if (capabilityPlan.profileEntitlements === null) {
      note = 'provisioning profile unavailable (off-Mac or none) - value not recovered';
    }
    const settingDescription = describeSettings(capabilityPlan.settingsByType[capabilityType]);
    if (settingDescription !== undefined) note = `${note}; settings: ${settingDescription}`;
    plannedEntitlements.set(entitlementKey, {
      key: entitlementKey,
      value: NEEDS_VALUE,
      note,
    });
  }
  return [...plannedEntitlements.values()].sort((firstEntitlement, secondEntitlement) =>
    firstEntitlement.key.localeCompare(secondEntitlement.key),
  );
};

type ProfileWithContent = Readonly<{
  name: string;
  profileContent: string;
}>;

/** Choose the best profile content for entitlement recovery. */
const chooseProfileContent = (profiles: readonly ProfileWithContent[]): string | null => {
  if (profiles.length === 0) return null;
  const appStoreProfile = profiles.find((profile) => /app\s*store/i.test(profile.name));
  if (appStoreProfile !== undefined) return appStoreProfile.profileContent;
  const firstProfile = profiles[0];
  if (firstProfile === undefined) return null;
  return firstProfile.profileContent;
};

/** Turn one planned entitlement into an advisory app.json write. */
const plannedWriteForEntitlement = (
  entitlement: PlannedEntitlement,
  configPath: string,
): PlannedWrite => {
  let valueDescription = '';
  if (entitlement.value === NEEDS_VALUE) valueDescription = ` = ${NEEDS_VALUE}`;
  if (entitlement.note !== undefined) {
    return {
      description: `capabilities: add entitlement ${entitlement.key}${valueDescription}`,
      fidelity: 'advisory',
      note: entitlement.note,
      change: {
        home: 'app.json',
        configPath,
        key: entitlement.key,
        value: entitlement.value,
      },
    };
  }
  return {
    description: `capabilities: add entitlement ${entitlement.key}${valueDescription}`,
    fidelity: 'advisory',
    change: {
      home: 'app.json',
      configPath,
      key: entitlement.key,
      value: entitlement.value,
    },
  };
};

/** Read enabled capabilities and plan missing app.json entitlements. */
export const capabilitiesAdopter: Adopter<ProfileEntitlementRequirements> = {
  domain: 'capabilities',
  fidelity: 'advisory',
  read: (appleCatalog, target: AdoptTarget) =>
    Effect.gen(function* () {
      const bundleResource = yield* appleCatalog.findBundleId(target.bundleId);
      if (bundleResource === null) return [];
      const [capabilities, profiles] = yield* Effect.all(
        [
          appleCatalog.listBundleIdCapabilities(bundleResource.id),
          appleCatalog.listProfilesForBundleId(bundleResource.id),
        ],
        { concurrency: 'unbounded' },
      );
      const profileContent = chooseProfileContent(profiles);
      let profileEntitlements: Record<string, EntitlementValue> | null = null;
      if (profileContent !== null)
        profileEntitlements = yield* extractProfileEntitlements(profileContent);
      const settingsByType: Record<string, CapabilitySetting[]> = {};
      for (const capability of capabilities) {
        if (capability.settings !== undefined)
          settingsByType[capability.capabilityType] = capability.settings;
      }
      let existingEntitlements: Record<string, unknown> = {};
      if (target.app.iosEntitlements !== undefined)
        existingEntitlements = target.app.iosEntitlements;
      const plannedEntitlements = planCapabilityEntitlements({
        enabledTypes: capabilities.map((capability) => capability.capabilityType),
        settingsByType,
        profileEntitlements,
        existing: existingEntitlements,
      });
      return plannedEntitlements.map((entitlement) =>
        plannedWriteForEntitlement(entitlement, target.app.configPath),
      );
    }),
};
