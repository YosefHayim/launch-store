import { Effect } from 'effect';
import { entitlementForCapability, isCapabilityEntitlement } from '../credentials/capabilities.js';
import type { AdoptTarget, Adopter, EntitlementValue, PlannedWrite } from '../types/adopt.js';
import type { CapabilitySetting } from '../types/appleCatalog.js';
import {
  extractProfileEntitlements,
  type ProfileEntitlementRequirements,
} from './profileEntitlements.js';

export const NEEDS_VALUE = 'NEEDS_VALUE';

export type PlannedEntitlement = {
  key: string;
  value: EntitlementValue;
  note?: string;
};

export type CapabilityPlanInput = {
  enabledTypes: string[];
  settingsByType: Record<string, CapabilitySetting[]>;
  profileEntitlements: Record<string, EntitlementValue> | null;
  existing: Record<string, unknown>;
};

/** Render capability settings as concise key/value advice. */
const describeSettings = (settings: CapabilitySetting[] | undefined): string | undefined => {
  if (settings === undefined) return undefined;
  if (settings.length === 0) return undefined;
  const settingDescriptions = settings.map((setting) => {
    const firstOption = setting.options?.[0]?.key;
    if (firstOption !== undefined) return `${setting.key}=${firstOption}`;
    return setting.key;
  });
  if (settingDescriptions.length === 0) return undefined;
  return settingDescriptions.join(', ');
};

/** Plan missing entitlement values without overwriting existing app configuration. */
export const planCapabilityEntitlements = (input: CapabilityPlanInput): PlannedEntitlement[] => {
  const plannedEntitlements = new Map<string, PlannedEntitlement>();
  let profileEntitlements: Record<string, EntitlementValue> = {};
  if (input.profileEntitlements !== null) profileEntitlements = input.profileEntitlements;
  for (const [entitlementKey, entitlementValue] of Object.entries(profileEntitlements)) {
    if (!isCapabilityEntitlement(entitlementKey)) continue;
    if (entitlementKey in input.existing) continue;
    plannedEntitlements.set(entitlementKey, {
      key: entitlementKey,
      value: entitlementValue,
    });
  }

  for (const capabilityType of input.enabledTypes) {
    const entitlementKey = entitlementForCapability(capabilityType);
    if (entitlementKey === undefined) continue;
    if (entitlementKey in input.existing) continue;
    if (plannedEntitlements.has(entitlementKey)) continue;
    let note = 'enabled on App Store Connect but no value in the provisioning profile';
    if (input.profileEntitlements === null) {
      note = 'provisioning profile unavailable (off-Mac or none) - value not recovered';
    }
    const settingDescription = describeSettings(input.settingsByType[capabilityType]);
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

/** Choose the best profile content for entitlement recovery. */
const chooseProfileContent = (
  profiles: { name: string; profileContent: string }[],
): string | null => {
  if (profiles.length === 0) return null;
  const appStoreProfile = profiles.find((profile) => /app\s*store/i.test(profile.name));
  if (appStoreProfile !== undefined) return appStoreProfile.profileContent;
  const firstProfile = profiles[0];
  if (firstProfile === undefined) return null;
  return firstProfile.profileContent;
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
      return plannedEntitlements.map((entitlement): PlannedWrite => {
        let valueDescription = '';
        if (entitlement.value === NEEDS_VALUE) valueDescription = ` = ${NEEDS_VALUE}`;
        const plannedWrite: PlannedWrite = {
          description: `capabilities: add entitlement ${entitlement.key}${valueDescription}`,
          fidelity: 'advisory',
          change: {
            home: 'app.json',
            configPath: target.app.configPath,
            key: entitlement.key,
            value: entitlement.value,
          },
        };
        if (entitlement.note !== undefined) plannedWrite.note = entitlement.note;
        return plannedWrite;
      });
    }),
};
