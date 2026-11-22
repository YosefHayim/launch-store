import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetLaunchDirectories,
  resolveProvisioningProfilesDirectory,
  useLaunchDirectories,
} from '../services/platform/paths.ts';
import { createLogger } from '../services/platform/logger.ts';
import {
  ensureAdHocSigningCredentials,
  loadCachedSigningAssets,
  profileStaleAgainstCapabilities,
  staleCachedSigningTargets,
} from './apple-signing-assets.ts';
import { extractProfileEntitlements } from '../adopt/profile-entitlements.ts';
import type { AscKey, SigningAssets } from '../types/credentials.ts';
import type { BundleIdCapabilityResource, ProfileResource } from '../types/apple-catalog.ts';
import type { AppleCredentialsClient } from '../services/stores/apple-credentials-client.ts';

const home = { dir: mkdtempSync(join(tmpdir(), 'launch-credentials-test-')) };

vi.mock('../adopt/profile-entitlements.ts', () => ({
  extractProfileEntitlements: vi.fn(),
}));

const KEY_ID = 'ABC123';
const MAIN = 'com.example.sampleapp';
const WIDGET = 'com.example.sampleapp.widget';
const dummyKey: AscKey = { keyId: KEY_ID, issuerId: 'issuer-uuid', p8: 'not-a-real-key' };

function profileRecord(bundleId: string, uuid: string) {
  return {
    id: `prof-${uuid}`,
    uuid,
    name: `Launch_${bundleId}_AppStore`,
    path: '',
    teamId: 'TEAM01',
  };
}

function seedCredentials(
  profiles: Record<string, { uuid: string }>,
  installedUuids: readonly string[],
): void {
  const dir = join(home.dir, '.launch', 'credentials', KEY_ID);

  mkdirSync(dir, { recursive: true });

  const p12Path = join(dir, 'dist-SERIAL.p12');

  writeFileSync(p12Path, 'p12-bytes');
  writeFileSync(
    join(dir, 'index.json'),
    JSON.stringify({
      certificate: { id: 'cert-1', serial: 'SERIAL', p12Path },
      profiles: Object.fromEntries(
        Object.entries(profiles).map(function profileEntry([bundleId, { uuid }]) {
          return [bundleId, profileRecord(bundleId, uuid)];
        }),
      ),
    }),
  );

  const provisioningProfilesDirectory = resolveProvisioningProfilesDirectory();

  mkdirSync(provisioningProfilesDirectory, { recursive: true });

  for (const uuid of installedUuids) {
    writeFileSync(join(provisioningProfilesDirectory, `${uuid}.mobileprovision`), 'profile-bytes');
  }
}

beforeEach(() => {
  useLaunchDirectories({ homeDirectory: home.dir, workingDirectory: home.dir });
  rmSync(home.dir, { recursive: true, force: true });
});

afterAll(() => {
  resetLaunchDirectories();
  rmSync(home.dir, { recursive: true, force: true });
});

describe('loadCachedSigningAssets - multi-bundle (app + extensions) fast path (#221)', () => {
  it("returns the main app's assets with no extensionProfiles when no extensions are requested", async () => {
    seedCredentials({ [MAIN]: { uuid: 'uuid-main' } }, ['uuid-main']);

    const assets = await loadCachedSigningAssets(KEY_ID, MAIN);

    expect(assets?.profileName).toBe(`Launch_${MAIN}_AppStore`);
    expect(assets?.extensionProfiles).toBeUndefined();
  });

  it("folds each extension's bundle id -> profile name in when every extension profile is cached", async () => {
    seedCredentials({ [MAIN]: { uuid: 'uuid-main' }, [WIDGET]: { uuid: 'uuid-widget' } }, [
      'uuid-main',
      'uuid-widget',
    ]);

    const assets = await loadCachedSigningAssets(KEY_ID, MAIN, [WIDGET]);

    expect(assets?.extensionProfiles).toEqual({ [WIDGET]: `Launch_${WIDGET}_AppStore` });
  });

  it('returns null when a requested extension has no profile in the index', async () => {
    seedCredentials({ [MAIN]: { uuid: 'uuid-main' } }, ['uuid-main']);

    expect(await loadCachedSigningAssets(KEY_ID, MAIN, [WIDGET])).toBeNull();
  });

  it("returns null when an extension's profile is in the index but not installed on disk", async () => {
    seedCredentials({ [MAIN]: { uuid: 'uuid-main' }, [WIDGET]: { uuid: 'uuid-widget' } }, [
      'uuid-main',
    ]);

    expect(await loadCachedSigningAssets(KEY_ID, MAIN, [WIDGET])).toBeNull();
  });
});

describe('ensureAdHocSigningCredentials - macOS has no ad-hoc distribution', () => {
  it('rejects macOS up front (even in dry-run) before touching the network or keychain', async () => {
    await expect(
      ensureAdHocSigningCredentials({
        platform: 'macos',
        bundleId: MAIN,
        appName: 'Mapleleaf',
        ascKey: dummyKey,
        log: createLogger(false),
        dryRun: true,
        confirmCreate: function confirmCreate() {
          return Promise.resolve(true);
        },
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/macOS has no ad-hoc/i),
    });
  });
});

describe('profileStaleAgainstCapabilities - regenerate-vs-reuse decision (#261)', () => {
  const PROFILE: ProfileResource = {
    id: 'prof-1',
    name: `Launch_${MAIN}_AppStore`,
    uuid: 'uuid-main',
    profileContent: 'base64-bytes',
  };

  function clientWithCapabilities(types: readonly string[]) {
    return {
      listBundleIdCapabilities: vi.fn(function listCapabilities() {
        return Promise.resolve(
          types.map(
            function capability(capabilityType, capabilityIndex): BundleIdCapabilityResource {
              return { id: `c${capabilityIndex}`, capabilityType };
            },
          ),
        );
      }),
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

describe('staleCachedSigningTargets - build-path reuse guard (#292)', () => {
  const MAIN_ONLY: SigningAssets = {
    bundleId: MAIN,
    teamId: 'TEAM01',
    certName: 'Apple Distribution',
    certSerial: 'SERIAL',
    profileName: `Launch_${MAIN}_AppStore`,
    profileUuid: 'uuid-main',
    profilePath: join(home.dir, 'main.mobileprovision'),
  };
  const SIGNING: SigningAssets = {
    ...MAIN_ONLY,
    extensionProfiles: { [WIDGET]: `Launch_${WIDGET}_AppStore` },
  };

  type Guarded = Pick<
    AppleCredentialsClient,
    'findBundleId' | 'findProfileByName' | 'listBundleIdCapabilities'
  >;

  function stubClient(
    capsByResource: Record<string, string[]>,
    overrides: Partial<Guarded> = {},
  ): Guarded {
    const client: Guarded = {
      findBundleId: vi.fn(function findBundle(identifier: string) {
        return Promise.resolve({ id: `${identifier}-res`, identifier, seedId: 'TEAM01' });
      }),
      findProfileByName: vi.fn(function findProfile(name: string) {
        return Promise.resolve({
          id: `prof-${name}`,
          name,
          uuid: `uuid-${name}`,
          profileContent: 'bytes',
        });
      }),
      listBundleIdCapabilities: vi.fn(function listCapabilities(resourceId: string) {
        let capabilities = capsByResource[resourceId];

        if (capabilities == null) {
          capabilities = [];
        }

        return Promise.resolve(
          capabilities.map(function capability(capabilityType, capabilityIndex) {
            return { id: `c${capabilityIndex}`, capabilityType };
          }),
        );
      }),
    };

    return { ...client, ...overrides };
  }

  it('flags every target whose profile predates an enabled capability (App Groups)', async () => {
    vi.mocked(extractProfileEntitlements).mockResolvedValue({ 'aps-environment': 'production' });

    const stale = await staleCachedSigningTargets(
      stubClient({ [`${MAIN}-res`]: ['APP_GROUPS'], [`${WIDGET}-res`]: ['APP_GROUPS'] }),
      SIGNING,
    );

    expect(stale).toEqual([
      { bundleId: MAIN, missing: ['APP_GROUPS'] },
      { bundleId: WIDGET, missing: ['APP_GROUPS'] },
    ]);
  });

  it('returns [] when every cached profile already covers the enabled capabilities', async () => {
    vi.mocked(extractProfileEntitlements).mockResolvedValue({
      'com.apple.security.application-groups': ['group.com.example.sampleapp'],
    });

    const stale = await staleCachedSigningTargets(
      stubClient({ [`${MAIN}-res`]: ['APP_GROUPS'], [`${WIDGET}-res`]: ['APP_GROUPS'] }),
      SIGNING,
    );

    expect(stale).toEqual([]);
  });

  it('treats an unreadable profile as current - best-effort, never a needless regenerate', async () => {
    vi.mocked(extractProfileEntitlements).mockResolvedValue(null);

    const stale = await staleCachedSigningTargets(
      stubClient({ [`${MAIN}-res`]: ['APP_GROUPS'], [`${WIDGET}-res`]: ['APP_GROUPS'] }),
      SIGNING,
    );

    expect(stale).toEqual([]);
  });

  it('grades the main bundle alone when the app has no extension profiles', async () => {
    vi.mocked(extractProfileEntitlements).mockResolvedValue({ 'aps-environment': 'production' });

    const stale = await staleCachedSigningTargets(
      stubClient({ [`${MAIN}-res`]: ['APP_GROUPS'] }),
      MAIN_ONLY,
    );

    expect(stale).toEqual([{ bundleId: MAIN, missing: ['APP_GROUPS'] }]);
  });

  it('skips an unregistered target (findBundleId -> null)', async () => {
    vi.mocked(extractProfileEntitlements).mockResolvedValue({ 'aps-environment': 'production' });

    const stale = await staleCachedSigningTargets(
      stubClient(
        { [`${MAIN}-res`]: ['APP_GROUPS'] },
        {
          findBundleId: vi.fn(function missingBundle() {
            return Promise.resolve(null);
          }),
        },
      ),
      MAIN_ONLY,
    );

    expect(stale).toEqual([]);
  });
});
