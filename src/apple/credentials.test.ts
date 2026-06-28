/**
 * Tests for {@link loadCachedSigningAssets} — the build's silent-reuse path. It's pure filesystem
 * (no network, no exec), so the home dir is redirected to a throwaway path (node `homedir()` honors
 * $HOME / %USERPROFILE%) and the real `paths` module resolves the per-account credentials dir and the
 * installed-profile dir there. The focus is the multi-bundle (app + extensions) gate added in #221:
 * the fast path applies only when EVERY bundle — the main app and each extension — has a cached,
 * installed profile; one missing profile returns null so the build re-provisions the whole set.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Redirect HOME before `core/paths.js` evaluates, so `~/.launch/credentials` and the installed-profile
// dir resolve under a throwaway path. Must run before the static imports below.
const home = vi.hoisted(() => {
  const dir = `${process.env['TMPDIR'] ?? '/tmp'}/launch-credentials-test-${process.pid}`;
  process.env['HOME'] = dir;
  process.env['USERPROFILE'] = dir;
  return { dir };
});

import { accountCredentialsDir, PROVISIONING_PROFILES_DIR } from '../core/paths.js';
import { createLogger } from '../core/logger.js';
import {
  ensureAdHocSigningCredentials,
  loadCachedSigningAssets,
  profileStaleAgainstCapabilities,
} from './credentials.js';
import { extractProfileEntitlements } from '../core/adopt/profileEntitlements.js';
import type { AscKey } from '../core/types.js';
import type { BundleIdCapabilityResource, ProfileResource } from './ascClient.js';

// The profile-entitlements reader shells out to `security cms`/`plutil` (Mac-only). Mock it so the
// stale-profile decision test stays a pure, in-process unit with no exec and no network.
vi.mock('../core/adopt/profileEntitlements.js', () => ({
  extractProfileEntitlements: vi.fn(),
}));

const KEY_ID = 'ABC123';
const MAIN = 'com.loopi.pomedero';
const WIDGET = 'com.loopi.pomedero.widget';
const DUMMY_KEY: AscKey = { keyId: KEY_ID, issuerId: 'issuer-uuid', p8: 'not-a-real-key' };

/** A profile record as written to `index.json`; `path` is the per-account backup, unused by the loader. */
function profileRecord(bundleId: string, uuid: string) {
  return {
    id: `prof-${uuid}`,
    uuid,
    name: `Launch_${bundleId}_AppStore`,
    path: '',
    teamId: 'TEAM01',
  };
}

/** Write `index.json` + back the cert `.p12` and the listed installed profiles with real files on disk. */
function seedCredentials(
  profiles: Record<string, { uuid: string }>,
  installedUuids: string[],
): void {
  const dir = accountCredentialsDir(KEY_ID);
  mkdirSync(dir, { recursive: true });
  const p12Path = join(dir, 'dist-SERIAL.p12');
  writeFileSync(p12Path, 'p12-bytes');
  writeFileSync(
    join(dir, 'index.json'),
    JSON.stringify({
      certificate: { id: 'cert-1', serial: 'SERIAL', p12Path },
      profiles: Object.fromEntries(
        Object.entries(profiles).map(([bundleId, { uuid }]) => [
          bundleId,
          profileRecord(bundleId, uuid),
        ]),
      ),
    }),
  );
  mkdirSync(PROVISIONING_PROFILES_DIR, { recursive: true });
  for (const uuid of installedUuids) {
    writeFileSync(join(PROVISIONING_PROFILES_DIR, `${uuid}.mobileprovision`), 'profile-bytes');
  }
}

describe('loadCachedSigningAssets — multi-bundle (app + extensions) fast path (#221)', () => {
  beforeEach(() => {
    rmSync(home.dir, { recursive: true, force: true });
  });
  afterAll(() => {
    rmSync(home.dir, { recursive: true, force: true });
  });

  it("returns the main app's assets with no extensionProfiles when no extensions are requested", () => {
    seedCredentials({ [MAIN]: { uuid: 'uuid-main' } }, ['uuid-main']);
    const assets = loadCachedSigningAssets(KEY_ID, MAIN);
    expect(assets?.profileName).toBe(`Launch_${MAIN}_AppStore`);
    expect(assets?.extensionProfiles).toBeUndefined();
  });

  it("folds each extension's bundle id → profile name in when every extension profile is cached", () => {
    seedCredentials({ [MAIN]: { uuid: 'uuid-main' }, [WIDGET]: { uuid: 'uuid-widget' } }, [
      'uuid-main',
      'uuid-widget',
    ]);
    const assets = loadCachedSigningAssets(KEY_ID, MAIN, [WIDGET]);
    expect(assets?.extensionProfiles).toEqual({ [WIDGET]: `Launch_${WIDGET}_AppStore` });
  });

  it('returns null when a requested extension has no profile in the index', () => {
    seedCredentials({ [MAIN]: { uuid: 'uuid-main' } }, ['uuid-main']);
    expect(loadCachedSigningAssets(KEY_ID, MAIN, [WIDGET])).toBeNull();
  });

  it("returns null when an extension's profile is in the index but not installed on disk", () => {
    // The widget is recorded but its `.mobileprovision` was never installed (uuid-widget omitted below).
    seedCredentials({ [MAIN]: { uuid: 'uuid-main' }, [WIDGET]: { uuid: 'uuid-widget' } }, [
      'uuid-main',
    ]);
    expect(loadCachedSigningAssets(KEY_ID, MAIN, [WIDGET])).toBeNull();
  });
});

describe('ensureAdHocSigningCredentials — macOS has no ad-hoc distribution', () => {
  it('rejects macOS up front (even in dry-run) before touching the network or keychain', async () => {
    await expect(
      ensureAdHocSigningCredentials({
        platform: 'macos',
        bundleId: MAIN,
        appName: 'Pomedero',
        ascKey: DUMMY_KEY,
        log: createLogger(false),
        dryRun: true,
        confirmCreate: () => Promise.resolve(true),
      }),
    ).rejects.toThrow(/macOS has no ad-hoc/i);
  });
});

describe('profileStaleAgainstCapabilities — regenerate-vs-reuse decision (#261)', () => {
  const PROFILE: ProfileResource = {
    id: 'prof-1',
    name: `Launch_${MAIN}_AppStore`,
    uuid: 'uuid-main',
    profileContent: 'base64-bytes',
  };
  /** A client stub exposing only the one read this decision makes — no network. */
  function clientWithCapabilities(types: string[]) {
    return {
      listBundleIdCapabilities: vi
        .fn<() => Promise<BundleIdCapabilityResource[]>>()
        .mockResolvedValue(types.map((capabilityType, i) => ({ id: `c${i}`, capabilityType }))),
    };
  }

  it('regenerates when App Groups was enabled after the profile was minted', async () => {
    vi.mocked(extractProfileEntitlements).mockResolvedValue({ 'aps-environment': 'production' });
    const stale = await profileStaleAgainstCapabilities(
      clientWithCapabilities(['PUSH_NOTIFICATIONS', 'APP_GROUPS']),
      'bundle-resource-id',
      PROFILE,
    );
    expect(stale).toEqual(['APP_GROUPS']);
  });

  it('reuses when the profile already covers every enabled capability', async () => {
    vi.mocked(extractProfileEntitlements).mockResolvedValue({
      'aps-environment': 'production',
      'com.apple.security.application-groups': ['group.com.acme'],
    });
    const stale = await profileStaleAgainstCapabilities(
      clientWithCapabilities(['PUSH_NOTIFICATIONS', 'APP_GROUPS']),
      'bundle-resource-id',
      PROFILE,
    );
    expect(stale).toEqual([]);
  });
});
