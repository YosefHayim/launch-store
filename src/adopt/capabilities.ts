import { entitlementForCapability, isCapabilityEntitlement } from '../credentials/capabilities.ts';
import type { AdoptTarget, Adopter, EntitlementValue, PlannedWrite } from '../types/adopt.ts';
import type { CapabilitySetting } from '../types/appleCatalog.ts';
import { extractProfileEntitlements } from './profileEntitlements.ts';

export const NEEDS_VALUE = 'NEEDS_VALUE';

type PlannedEntitlement = Readonly<{
  key: string;
  value: EntitlementValue;
  note?: string;
}>;

type CapabilityPlanInput = Readonly<{
  enabledTypes: readonly string[];
  settingsByType: Readonly<Record<string, readonly CapabilitySetting[]>>;
  profileEntitlements: Readonly<Record<string, EntitlementValue>> | null;
  existing: Readonly<Record<string, unknown>>;
}>;

function describeSetting(setting: CapabilitySetting): string {
  if (setting.options == null) {
    return setting.key;
  }

  const hasOptions = setting.options.length > 0;

  if (hasOptions == false) {
    return setting.key;
  }

  const firstOption = setting.options[0];

  if (firstOption == null) {
    return setting.key;
  }

  return `${setting.key}=${firstOption.key}`;
}

/** Render capability settings as concise key/value advice. */
function describeSettings(settings: readonly CapabilitySetting[] | undefined): string | undefined {
  if (settings == null) {
    return undefined;
  }

  const isEmpty = settings.length == 0;

  if (isEmpty) {
    return undefined;
  }

  return settings.map(describeSetting).join(', ');
}

/** Plan missing entitlement values without overwriting existing app configuration. */
export function planCapabilityEntitlements(
  capabilityPlan: CapabilityPlanInput,
): PlannedEntitlement[] {
  const plannedEntitlements = new Map<string, PlannedEntitlement>();
  let profileEntitlements: Readonly<Record<string, EntitlementValue>> = {};

  if (capabilityPlan.profileEntitlements != null) {
    profileEntitlements = capabilityPlan.profileEntitlements;
  }

  for (const [entitlementKey, entitlementValue] of Object.entries(profileEntitlements)) {
    const isCapability = isCapabilityEntitlement(entitlementKey);

    if (isCapability == false) {
      continue;
    }

    const isAlreadyDeclared = entitlementKey in capabilityPlan.existing;

    if (isAlreadyDeclared) {
      continue;
    }

    plannedEntitlements.set(entitlementKey, {
      key: entitlementKey,
      value: entitlementValue,
    });
  }

  for (const capabilityType of capabilityPlan.enabledTypes) {
    const entitlementKey = entitlementForCapability(capabilityType);

    if (entitlementKey == null) {
      continue;
    }

    const isAlreadyDeclared = entitlementKey in capabilityPlan.existing;

    if (isAlreadyDeclared) {
      continue;
    }

    const isAlreadyPlanned = plannedEntitlements.has(entitlementKey);

    if (isAlreadyPlanned) {
      continue;
    }

    let note = 'enabled on App Store Connect but no value in the provisioning profile';

    if (capabilityPlan.profileEntitlements == null) {
      note = 'provisioning profile unavailable (off-Mac or none) - value not recovered';
    }

    const settingDescription = describeSettings(capabilityPlan.settingsByType[capabilityType]);

    if (settingDescription != null) {
      note = `${note}; settings: ${settingDescription}`;
    }

    plannedEntitlements.set(entitlementKey, {
      key: entitlementKey,
      value: NEEDS_VALUE,
      note,
    });
  }

  function byEntitlementKey(
    firstEntitlement: PlannedEntitlement,
    secondEntitlement: PlannedEntitlement,
  ) {
    return firstEntitlement.key.localeCompare(secondEntitlement.key);
  }

  return [...plannedEntitlements.values()].sort(byEntitlementKey);
}

type ProfileWithContent = Readonly<{
  name: string;
  profileContent: string;
}>;

function isAppStoreProfile(profile: ProfileWithContent): boolean {
  // Matches an App Store distribution profile name, ignoring spaces and case.
  return /app\s*store/i.test(profile.name);
}

/** Choose the best profile content for entitlement recovery. */
function chooseProfileContent(profiles: readonly ProfileWithContent[]): string | null {
  const isEmpty = profiles.length == 0;

  if (isEmpty) {
    return null;
  }

  const appStoreProfile = profiles.find(isAppStoreProfile);

  if (appStoreProfile != null) {
    return appStoreProfile.profileContent;
  }

  const firstProfile = profiles[0];

  if (firstProfile == null) {
    return null;
  }

  return firstProfile.profileContent;
}

/** Turn one planned entitlement into an advisory app.json write. */
function plannedWriteForEntitlement(
  entitlement: PlannedEntitlement,
  configPath: string,
): PlannedWrite {
  let valueDescription = '';

  if (entitlement.value == NEEDS_VALUE) {
    valueDescription = ` = ${NEEDS_VALUE}`;
  }

  if (entitlement.note != null) {
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
}

function plannedWriteFor(configPath: string) {
  return function writeEntitlement(entitlement: PlannedEntitlement): PlannedWrite {
    return plannedWriteForEntitlement(entitlement, configPath);
  };
}

/** Read enabled capabilities and plan missing app.json entitlements. */
export const capabilitiesAdopter: Adopter = {
  domain: 'capabilities',
  fidelity: 'advisory',
  async read(appleCatalog, target: AdoptTarget) {
    const bundleResource = await appleCatalog.findBundleId(target.bundleId);

    if (bundleResource == null) {
      return [];
    }

    const capabilitiesPromise = appleCatalog.listBundleIdCapabilities(bundleResource.id);
    const profilesPromise = appleCatalog.listProfilesForBundleId(bundleResource.id);
    const capabilities = await capabilitiesPromise;
    const profiles = await profilesPromise;
    const profileContent = chooseProfileContent(profiles);
    let profileEntitlements: Record<string, EntitlementValue> | null = null;

    if (profileContent != null) {
      profileEntitlements = await extractProfileEntitlements(profileContent);
    }

    const settingsByType: Record<string, readonly CapabilitySetting[]> = {};

    for (const capability of capabilities) {
      if (capability.settings != null) {
        settingsByType[capability.capabilityType] = capability.settings;
      }
    }

    let existingEntitlements: Record<string, unknown> = {};

    if (target.app.iosEntitlements != null) {
      existingEntitlements = target.app.iosEntitlements;
    }

    function capabilityTypeOf(capability: { capabilityType: string }): string {
      return capability.capabilityType;
    }

    const plannedEntitlements = planCapabilityEntitlements({
      enabledTypes: capabilities.map(capabilityTypeOf),
      settingsByType,
      profileEntitlements,
      existing: existingEntitlements,
    });

    return plannedEntitlements.map(plannedWriteFor(target.app.configPath));
  },
};
