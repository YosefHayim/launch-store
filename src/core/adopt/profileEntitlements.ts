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
 * On macOS 15+, `plutil -extract Entitlements json` fails on a full decoded profile because the top-level
 * plist carries `<data>` values (`DeveloperCertificates`, `DER-Encoded-Profile`) that JSON cannot
 * represent — `plutil` rejects the entire input against the destination format before honoring `-extract`.
 * The fix: extract `Entitlements` as `xml1` first (the sub-tree has no `<data>`, so this succeeds), then
 * convert that standalone sub-plist to JSON. Two `plutil` calls, no new dependency.
 *
 * Mac-only: `security`/`plutil` ship with macOS, so off-Mac this returns `null` and the capabilities
 * adopter degrades every value to {@link NEEDS_VALUE} (the Apple flow is Mac-centric anyway). Any
 * decode/parse failure also returns `null` rather than throwing — a profile we can't read must not abort
 * the adopt run.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { capture } from '../services/exec.js';
import { isMac } from '../services/os.js';
import { asRecord } from '../services/json.js';
import type { EntitlementValue } from '../types/index.js';

const profileEntitlementsWorkspace = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), 'launch-adopt-'))),
  (workspacePath) => Effect.sync(() => rmSync(workspacePath, { recursive: true, force: true })),
);

/**
 * Decode `profileContent` (a base64 `.mobileprovision`) and return its `Entitlements` dict, or `null`
 * when not on a Mac or the profile can't be decoded/parsed. The returned record is keyed by entitlement
 * key (e.g. `com.apple.security.application-groups`) with the concrete value Apple provisioned.
 *
 * @param profileContent - Base64-encoded `.mobileprovision` bytes from App Store Connect.
 * @returns An Effect that succeeds with the decoded entitlements record, or null when it cannot be read.
 */
export function extractProfileEntitlements(
  profileContent: string,
): Effect.Effect<Record<string, EntitlementValue> | null> {
  return Effect.gen(function* () {
    const runningOnMac = yield* Effect.sync(isMac);
    if (!runningOnMac) return null;

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const workspacePath = yield* profileEntitlementsWorkspace;
        const profilePath = join(workspacePath, 'profile.mobileprovision');
        yield* Effect.try({
          try: () => writeFileSync(profilePath, Buffer.from(profileContent, 'base64')),
          catch: (writeFailure) => writeFailure,
        });
        // `security cms -D` verifies the CMS signature and prints the decoded plist.
        const decodedPlist = yield* Effect.tryPromise({
          try: () => capture('security', ['cms', '-D', '-i', profilePath]),
          catch: (decodeFailure) => decodeFailure,
        });
        const plistPath = join(workspacePath, 'decoded.plist');
        yield* Effect.try({
          try: () => writeFileSync(plistPath, decodedPlist),
          catch: (writeFailure) => writeFailure,
        });

        // Two-step extraction: extract Entitlements as xml1 first (works even when the top-level plist has
        // <data> values that trip `plutil -extract ... json`), then convert the sub-plist to JSON.
        const entitlementsPlistPath = join(workspacePath, 'entitlements.plist');
        yield* Effect.tryPromise({
          try: () =>
            capture('plutil', [
              '-extract',
              'Entitlements',
              'xml1',
              '-o',
              entitlementsPlistPath,
              plistPath,
            ]),
          catch: (extractFailure) => extractFailure,
        });
        const entitlementsJson = yield* Effect.tryPromise({
          try: () => capture('plutil', ['-convert', 'json', '-o', '-', entitlementsPlistPath]),
          catch: (convertFailure) => convertFailure,
        });

        const parsed: unknown = yield* Effect.try({
          try: () => JSON.parse(entitlementsJson),
          catch: (parseFailure) => parseFailure,
        });
        return asRecord(parsed) as Record<string, EntitlementValue> | null;
      }).pipe(Effect.catchAll(() => Effect.succeed(null))),
    );
  });
}
