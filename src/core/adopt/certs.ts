/**
 * The **certs** adopter (detect tier): report the distribution certificates and provisioning profiles an
 * app already has on App Store Connect, with a verdict on whether each is usable from this machine —
 * never importing them, because Apple cannot return a certificate's private key.
 *
 * A shipping app already has signing assets; the value here is *visibility*, not mutation. For each
 * certificate we say whether its private key is in this account's local keychain backup (matched on
 * serial via {@link describeStoredCredentials}); for each profile, whether the bundle id is provisioned
 * locally. When a usable key is missing, the adopter delegates the "add" to the existing
 * `launch creds setup` flow rather than re-implementing it — the one signing path stays single-sourced.
 *
 * The verdict logic is pure ({@link planCertReports}) so it unit-tests against fixtures; the adopter
 * wires the ASC reads and the local keychain index to it.
 */

import type { CertificateResource, ProfileResource } from "../../apple/ascClient.js";
import { describeStoredCredentials } from "../../apple/credentials.js";
import type { Adopter, AdoptCatalogApi, AdoptTarget, PlannedWrite } from "./types.js";

/** What's cached locally for the active account — the keychain-backup view the verdict compares against. */
export interface LocalSigningView {
  /** Serial of the distribution certificate whose `.p12` is backed up locally, or null when none is. */
  certSerial: string | null;
  /** Bundle ids with a provisioning profile installed/backed up locally. */
  bundleIds: string[];
}

/** Inputs to {@link planCertReports}: the live ASC certs/profiles plus the local keychain view. */
export interface CertPlanInput {
  certs: CertificateResource[];
  profiles: ProfileResource[];
  local: LocalSigningView;
  bundleId: string;
}

/** One detect-only report write (no mutation) — its `change.home` is always `keychain`. */
function report(description: string, note?: string): PlannedWrite {
  return { description, fidelity: "detect", ...(note ? { note } : {}), change: { home: "keychain" } };
}

/** The delegation hint shown when a usable local key/profile is missing — keeps signing single-sourced. */
const DELEGATE_HINT =
  "Apple never returns the private key — run `launch creds setup` to issue or reuse a usable cert + profile";

/**
 * Build the detect-only report for one app's signing assets. Pure and deterministic: it reports every
 * distribution certificate (flagging which one's key is local), every profile for the bundle id (flagging
 * which is installed locally), and an actionable line when nothing usable is present locally.
 */
export function planCertReports(input: CertPlanInput): PlannedWrite[] {
  const writes: PlannedWrite[] = [];

  if (input.certs.length === 0) {
    writes.push(report("certs: no distribution certificates on this account", DELEGATE_HINT));
  }
  for (const cert of input.certs) {
    const local = cert.serialNumber === input.local.certSerial;
    const expiry = cert.expirationDate ? ` (expires ${cert.expirationDate.slice(0, 10)})` : "";
    const verdict = local ? "private key present in this keychain" : "private key not in this keychain";
    writes.push(
      report(
        `certs: distribution certificate ${cert.serialNumber}${expiry} — ${verdict}`,
        local ? undefined : DELEGATE_HINT,
      ),
    );
  }

  const localBundle = input.local.bundleIds.includes(input.bundleId);
  for (const profile of input.profiles) {
    const verdict = localBundle ? "installed locally" : "not installed locally";
    writes.push(
      report(
        `certs: profile "${profile.name}" (${profile.uuid}) — ${verdict}`,
        localBundle ? undefined : DELEGATE_HINT,
      ),
    );
  }

  return writes;
}

/** Read an app's certs/profiles and the local keychain index, and plan detect-only reports. */
export const certsAdopter: Adopter = {
  domain: "certs",
  fidelity: "detect",
  async read(asc: AdoptCatalogApi, target: AdoptTarget): Promise<PlannedWrite[]> {
    const bundle = await asc.findBundleId(target.bundleId);
    const [certs, profiles] = await Promise.all([
      asc.listDistributionCertificates(),
      bundle ? asc.listProfilesForBundleId(bundle.id) : Promise.resolve<ProfileResource[]>([]),
    ]);
    const stored = describeStoredCredentials(target.keyId);
    return planCertReports({
      certs,
      profiles,
      local: { certSerial: stored.certSerial, bundleIds: stored.bundleIds },
      bundleId: target.bundleId,
    });
  },
};
