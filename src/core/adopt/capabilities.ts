/**
 * The **capabilities** adopter (advisory tier): reconstruct an app's `ios.entitlements` from its enabled
 * App Store Connect capabilities + its provisioning profile, so `launch sync` re-derives the same
 * capabilities on the next run.
 *
 * Two sources, because Apple splits the truth: the bundle id's `bundleIdCapabilities` say *which*
 * capabilities are on (the toggle), while the concrete *values* — app-group ids, iCloud container ids,
 * merchant ids, `aps-environment`, associated-domains — live only in the provisioning profile's embedded
 * entitlements (Apple's API has no endpoint for them; see `docs/adr/0002`). So this reads the real values
 * from the profile (Mac-only, via {@link extractProfileEntitlements}) and, for any capability enabled with
 * no recoverable value, writes the entitlement key with the build-breaking {@link NEEDS_VALUE} sentinel
 * for the developer to fill in. Advisory, not importable: without the profile (off-Mac) every value is a gap.
 *
 * The planning is a pure function ({@link planCapabilityEntitlements}) so the mapping is unit-tested
 * without a Mac or a real profile; the adopter just wires the ASC reads and the profile decode to it.
 */

import type { CapabilitySetting } from "../../apple/ascClient.js";
import { entitlementForCapability, isCapabilityEntitlement } from "../capabilities.js";
import { extractProfileEntitlements } from "./profileEntitlements.js";
import {
  NEEDS_VALUE,
  type Adopter,
  type AdoptCatalogApi,
  type AdoptTarget,
  type EntitlementValue,
  type PlannedWrite,
} from "./types.js";

/** One planned entitlement to add to `app.json`: its key, the value (real or {@link NEEDS_VALUE}), and any caveat. */
export interface PlannedEntitlement {
  key: string;
  value: EntitlementValue;
  note?: string;
}

/** Inputs to {@link planCapabilityEntitlements} — everything read from ASC + the profile + the current app.json. */
export interface CapabilityPlanInput {
  /** Raw `capabilityType` strings currently enabled on the bundle id. */
  enabledTypes: string[];
  /** Capability settings keyed by `capabilityType` (data-protection level, iCloud version) — advisory detail. */
  settingsByType: Record<string, CapabilitySetting[]>;
  /** The provisioning profile's decoded entitlements, or `null` when unavailable (off-Mac / no profile). */
  profileEntitlements: Record<string, EntitlementValue> | null;
  /** Entitlement keys already declared in the app's `app.json` — never overwritten. */
  existing: Record<string, unknown>;
}

/** Summarize a capability's settings as a short advisory string (e.g. `DATA_PROTECTION_PERMISSION_LEVEL=COMPLETE`). */
function describeSettings(settings: CapabilitySetting[] | undefined): string | undefined {
  if (!settings || settings.length === 0) return undefined;
  const parts = settings
    .map((setting) => {
      const option = setting.options?.[0]?.key;
      return option ? `${setting.key}=${option}` : setting.key;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Plan the entitlement additions for one app. Pure and deterministic: it prefers the profile's real
 * values (high-confidence imports), then fills any enabled-but-unrecovered capability with a
 * {@link NEEDS_VALUE} placeholder, and skips every key the app.json already declares. Output is sorted by
 * key so the plan and any test assertions are stable.
 */
export function planCapabilityEntitlements(input: CapabilityPlanInput): PlannedEntitlement[] {
  const planned = new Map<string, PlannedEntitlement>();

  // 1. Real values from the provisioning profile — the only honest source for identifier values.
  for (const [key, value] of Object.entries(input.profileEntitlements ?? {})) {
    if (!isCapabilityEntitlement(key) || key in input.existing) continue;
    planned.set(key, { key, value });
  }

  // 2. Each enabled capability with no recovered value → a build-breaking placeholder to fill in by hand.
  const profileMissing = input.profileEntitlements === null;
  for (const type of input.enabledTypes) {
    const key = entitlementForCapability(type);
    if (!key || key in input.existing || planned.has(key)) continue;
    const settings = describeSettings(input.settingsByType[type]);
    const reason = profileMissing
      ? "provisioning profile unavailable (off-Mac or none) — value not recovered"
      : "enabled on App Store Connect but no value in the provisioning profile";
    planned.set(key, { key, value: NEEDS_VALUE, note: settings ? `${reason}; settings: ${settings}` : reason });
  }

  return [...planned.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Pick the profile whose entitlements to read — prefer the most recently named, falling back to the first. */
function chooseProfileContent(profiles: { name: string; profileContent: string }[]): string | null {
  if (profiles.length === 0) return null;
  // Prefer an App Store profile (its entitlements reflect the shipping app) when names disambiguate.
  const appStore = profiles.find((profile) => /app\s*store/i.test(profile.name));
  return (appStore ?? profiles[0])?.profileContent ?? null;
}

/** Read a bundle id's enabled capabilities + profile entitlements and plan the `app.json` writes. */
export const capabilitiesAdopter: Adopter = {
  domain: "capabilities",
  fidelity: "advisory",
  async read(asc: AdoptCatalogApi, target: AdoptTarget): Promise<PlannedWrite[]> {
    const bundle = await asc.findBundleId(target.bundleId);
    if (!bundle) return [];

    const [capabilities, profiles] = await Promise.all([
      asc.listBundleIdCapabilities(bundle.id),
      asc.listProfilesForBundleId(bundle.id),
    ]);
    const profileContent = chooseProfileContent(profiles);
    const profileEntitlements = profileContent ? await extractProfileEntitlements(profileContent) : null;

    const settingsByType: Record<string, CapabilitySetting[]> = {};
    for (const capability of capabilities) {
      if (capability.settings) settingsByType[capability.capabilityType] = capability.settings;
    }

    const planned = planCapabilityEntitlements({
      enabledTypes: capabilities.map((capability) => capability.capabilityType),
      settingsByType,
      profileEntitlements,
      existing: target.app.iosEntitlements ?? {},
    });

    return planned.map((entitlement) => ({
      description: `capabilities: add entitlement ${entitlement.key}${entitlement.value === NEEDS_VALUE ? ` = ${NEEDS_VALUE}` : ""}`,
      fidelity: "advisory",
      ...(entitlement.note ? { note: entitlement.note } : {}),
      change: { home: "app.json", configPath: target.app.configPath, key: entitlement.key, value: entitlement.value },
    }));
  },
};
