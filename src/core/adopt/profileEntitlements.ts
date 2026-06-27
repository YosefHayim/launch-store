/**
 * Extract the embedded `Entitlements` dict from a provisioning profile's bytes — the source of a
 * shipping app's real capability *values* for `launch adopt`.
 *
 * Apple's App Store Connect API has no `appGroups`/`cloudContainers` endpoint and a capability carries
 * only toggle settings, never identifier values (see `docs/adr/0002`). The concrete app-group ids,
 * iCloud container ids, merchant ids, `aps-environment`, and associated-domains live in the
 * CMS-signed `.mobileprovision`'s entitlements plist. We decode it with `security cms -D` and pull the
 * `Entitlements` key as JSON with `plutil` — the same `security` toolchain `apple/credentials.ts`
 * already uses to read a profile's UUID/Team ID, here lifted to the whole entitlements dict.
 *
 * Mac-only: `security`/`plutil` ship with macOS, so off-Mac this returns `null` and the capabilities
 * adopter degrades every value to {@link NEEDS_VALUE} (the Apple flow is Mac-centric anyway). Any
 * decode/parse failure also returns `null` rather than throwing — a profile we can't read must not abort
 * the adopt run.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture } from '../exec.js';
import { isMac } from '../os.js';
import { asRecord } from '../json.js';
import type { EntitlementValue } from './types.js';

/**
 * Decode `profileContent` (a base64 `.mobileprovision`) and return its `Entitlements` dict, or `null`
 * when not on a Mac or the profile can't be decoded/parsed. The returned record is keyed by entitlement
 * key (e.g. `com.apple.security.application-groups`) with the concrete value Apple provisioned.
 */
export async function extractProfileEntitlements(
  profileContent: string,
): Promise<Record<string, EntitlementValue> | null> {
  if (!isMac()) return null;
  const work = mkdtempSync(join(tmpdir(), 'launch-adopt-'));
  try {
    const profilePath = join(work, 'profile.mobileprovision');
    writeFileSync(profilePath, Buffer.from(profileContent, 'base64'));
    // `security cms -D` verifies the CMS signature and prints the decoded plist; `plutil` then lifts the
    // Entitlements sub-dict out as JSON we can parse (regex over nested plist arrays/dicts would be fragile).
    const decodedPlist = await capture('security', ['cms', '-D', '-i', profilePath]);
    const plistPath = join(work, 'decoded.plist');
    writeFileSync(plistPath, decodedPlist);
    const entitlementsJson = await capture('plutil', [
      '-extract',
      'Entitlements',
      'json',
      '-o',
      '-',
      plistPath,
    ]);
    const parsed: unknown = JSON.parse(entitlementsJson);
    return asRecord(parsed) as Record<string, EntitlementValue> | null;
  } catch {
    return null;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
