import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { NodeContext } from '@effect/platform-node';
// Redirect HOME before `core/paths.js` evaluates, so `~/.launch/credentials` and the installed-profile
// dir resolve under a throwaway path. Must run before the static imports below.
const home = vi.hoisted(() => {
  let temporaryDirectory = process.env['TMPDIR'];
  if (temporaryDirectory === undefined) temporaryDirectory = '/tmp';
  const dir = `${temporaryDirectory}/launch-credentials-test-${process.pid}`;
  process.env['HOME'] = dir;
  process.env['USERPROFILE'] = dir;
  return { dir };
});
import {
  PROVISIONING_PROFILES_DIR,
  makeLaunchPathsTest,
  type LaunchPathsService,
} from '../services/paths.js';
import { LaunchEnvironmentTest, type LaunchEnvironmentService } from '../services/environment.js';
import { createLogger, makeLaunchLoggerTest } from '../services/logger.js';
import {
  ensureAdHocSigningCredentials,
  loadCachedSigningAssets,
  profileStaleAgainstCapabilities,
  staleCachedSigningTargets,
} from './appleSigning.js';
import { extractProfileEntitlements } from '../adopt/profileEntitlements.js';
import type { AscKey, SigningAssets } from '../types/credentials.js';
import type { BundleIdCapabilityResource, ProfileResource } from '../types/appleCatalog.js';
import {
  AppleCredentialsClientFactory,
  type AppleCredentialsClient,
} from '../services/appleCredentialsClient.js';
import {
  makeLaunchSecretStoreTest,
  type LaunchSecretStoreService,
} from '../services/secretStore.js';
// The profile-entitlements reader shells out to `security cms`/`plutil` (Mac-only). Mock it so the
// stale-profile decision test stays a pure, in-process unit with no exec and no network.
vi.mock('../adopt/profileEntitlements.js', () => ({
  extractProfileEntitlements: vi.fn(),
}));
const KEY_ID = 'ABC123';
const MAIN = 'com.example.sampleapp';
const WIDGET = 'com.example.sampleapp.widget';
const DUMMY_KEY: AscKey = { keyId: KEY_ID, issuerId: 'issuer-uuid', p8: 'not-a-real-key' };
const unavailableClient: AppleCredentialsClient = {
  findBundleId: () => Effect.dieMessage('Unused client method'),
  createBundleId: () => Effect.dieMessage('Unused client method'),
  listDistributionCertificates: () => Effect.dieMessage('Unused client method'),
  createCertificate: () => Effect.dieMessage('Unused client method'),
  findProfileByName: () => Effect.dieMessage('Unused client method'),
  createAppStoreProfile: () => Effect.dieMessage('Unused client method'),
  deleteProfile: () => Effect.dieMessage('Unused client method'),
  listDevices: () => Effect.dieMessage('Unused client method'),
  createAdHocProfile: () => Effect.dieMessage('Unused client method'),
  listBundleIdCapabilities: () => Effect.dieMessage('Unused client method'),
};
/** Run a signing program with an isolated secret-store capability. */
const runSigningEffect = <TValue, TError>(
  signingEffect: Effect.Effect<
    TValue,
    TError,
    | LaunchEnvironmentService
    | LaunchPathsService
    | LaunchSecretStoreService
    | NodeContext.NodeContext
  >,
): Promise<TValue> => {
  return Effect.runPromise(
    signingEffect.pipe(
      Effect.provide(NodeContext.layer),
      Effect.provide(LaunchEnvironmentTest),
      Effect.provide(makeLaunchPathsTest(home.dir, home.dir)),
      Effect.provide(makeLaunchSecretStoreTest()),
    ),
  );
};
/** A profile record as written to `index.json`; `path` is the per-account backup, unused by the loader. */
const profileRecord = (bundleId: string, uuid: string) => {
  return {
    id: `prof-${uuid}`,
    uuid,
    name: `Launch_${bundleId}_AppStore`,
    path: '',
    teamId: 'TEAM01',
  };
};
/** Write `index.json` + back the cert `.p12` and the listed installed profiles with real files on disk. */
const seedCredentials = (
  profiles: Record<
    string,
    {
      uuid: string;
    }
  >,
  installedUuids: string[],
): void => {
  const dir = join(home.dir, '.launch', 'credentials', KEY_ID);
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
};
describe('loadCachedSigningAssets - multi-bundle (app + extensions) fast path (#221)', () => {
  beforeEach(() => {
    rmSync(home.dir, { recursive: true, force: true });
  });
  afterAll(() => {
    rmSync(home.dir, { recursive: true, force: true });
  });
  it("returns the main app's assets with no extensionProfiles when no extensions are requested", async () => {
    seedCredentials({ [MAIN]: { uuid: 'uuid-main' } }, ['uuid-main']);
    const assets = await runSigningEffect(loadCachedSigningAssets(KEY_ID, MAIN));
    expect(assets?.profileName).toBe(`Launch_${MAIN}_AppStore`);
    expect(assets?.extensionProfiles).toBeUndefined();
  });
  it("folds each extension's bundle id -> profile name in when every extension profile is cached", async () => {
    seedCredentials({ [MAIN]: { uuid: 'uuid-main' }, [WIDGET]: { uuid: 'uuid-widget' } }, [
      'uuid-main',
      'uuid-widget',
    ]);
    const assets = await runSigningEffect(loadCachedSigningAssets(KEY_ID, MAIN, [WIDGET]));
    expect(assets?.extensionProfiles).toEqual({ [WIDGET]: `Launch_${WIDGET}_AppStore` });
  });
  it('returns null when a requested extension has no profile in the index', async () => {
    seedCredentials({ [MAIN]: { uuid: 'uuid-main' } }, ['uuid-main']);
    expect(await runSigningEffect(loadCachedSigningAssets(KEY_ID, MAIN, [WIDGET]))).toBeNull();
  });
  it("returns null when an extension's profile is in the index but not installed on disk", async () => {
    // The widget is recorded but its `.mobileprovision` was never installed (uuid-widget omitted below).
    seedCredentials({ [MAIN]: { uuid: 'uuid-main' }, [WIDGET]: { uuid: 'uuid-widget' } }, [
      'uuid-main',
    ]);
    expect(await runSigningEffect(loadCachedSigningAssets(KEY_ID, MAIN, [WIDGET]))).toBeNull();
  });
});
describe('ensureAdHocSigningCredentials - macOS has no ad-hoc distribution', () => {
  it('rejects macOS up front (even in dry-run) before touching the network or keychain', async () => {
    const signingProgram = Effect.gen(function* () {
      const logger = yield* createLogger(false);
      return yield* ensureAdHocSigningCredentials({
        platform: 'macos',
        bundleId: MAIN,
        appName: 'Mapleleaf',
        ascKey: DUMMY_KEY,
        log: logger,
        dryRun: true,
        confirmCreate: () => Effect.succeed(true),
      });
    }).pipe(
      Effect.provideService(AppleCredentialsClientFactory, {
        createClient: () => Effect.succeed(unavailableClient),
      }),
      Effect.provide(makeLaunchLoggerTest([])),
    );
    await expect(runSigningEffect(signingProgram)).rejects.toThrow(/macOS has no ad-hoc/i);
  });
});
describe('profileStaleAgainstCapabilities - regenerate-vs-reuse decision (#261)', () => {
  const PROFILE: ProfileResource = {
    id: 'prof-1',
    name: `Launch_${MAIN}_AppStore`,
    uuid: 'uuid-main',
    profileContent: 'base64-bytes',
  };
  /** A client stub exposing only the one read this decision makes - no network. */
  function clientWithCapabilities(types: string[]) {
    return {
      listBundleIdCapabilities: vi.fn(() =>
        Effect.succeed(
          types.map(
            (capabilityType, capabilityIndex): BundleIdCapabilityResource => ({
              id: `c${capabilityIndex}`,
              capabilityType,
            }),
          ),
        ),
      ),
    };
  }
  it('regenerates when App Groups was enabled after the profile was minted', async () => {
    vi.mocked(extractProfileEntitlements).mockReturnValue(
      Effect.succeed({ 'aps-environment': 'production' }),
    );
    const stale = await runSigningEffect(
      profileStaleAgainstCapabilities(
        clientWithCapabilities(['PUSH_NOTIFICATIONS', 'APP_GROUPS']),
        'bundle-resource-id',
        PROFILE,
      ),
    );
    expect(stale).toEqual(['APP_GROUPS']);
  });
  it('reuses when the profile already covers every enabled capability', async () => {
    vi.mocked(extractProfileEntitlements).mockReturnValue(
      Effect.succeed({
        'aps-environment': 'production',
        'com.apple.security.application-groups': ['group.com.acme'],
      }),
    );
    const stale = await runSigningEffect(
      profileStaleAgainstCapabilities(
        clientWithCapabilities(['PUSH_NOTIFICATIONS', 'APP_GROUPS']),
        'bundle-resource-id',
        PROFILE,
      ),
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
    profilePath: '/tmp/main.mobileprovision',
  };
  const SIGNING: SigningAssets = {
    ...MAIN_ONLY,
    extensionProfiles: { [WIDGET]: `Launch_${WIDGET}_AppStore` },
  };
  type Guarded = Pick<
    AppleCredentialsClient,
    'findBundleId' | 'findProfileByName' | 'listBundleIdCapabilities'
  >;
  /** A client stub over the three reads the guard makes; capabilities keyed by App ID resource id. */
  function stubClient(
    capsByResource: Record<string, string[]>,
    overrides: Partial<Guarded> = {},
  ): Guarded {
    return {
      findBundleId: vi.fn((identifier: string) =>
        Effect.succeed({ id: `${identifier}-res`, identifier, seedId: 'TEAM01' }),
      ),
      findProfileByName: vi.fn((name: string) =>
        Effect.succeed({
          id: `prof-${name}`,
          name,
          uuid: `uuid-${name}`,
          profileContent: 'bytes',
        }),
      ),
      listBundleIdCapabilities: vi.fn((resourceId: string) => {
        let capabilities = capsByResource[resourceId];
        if (capabilities === undefined) capabilities = [];
        return Effect.succeed(
          capabilities.map((capabilityType, i) => ({
            id: `c${i}`,
            capabilityType,
          })),
        );
      }),
      ...overrides,
    };
  }
  it('flags every target whose profile predates an enabled capability (App Groups)', async () => {
    // Both App IDs have APP_GROUPS enabled but neither profile carries the entitlement -> both stale.
    vi.mocked(extractProfileEntitlements).mockReturnValue(
      Effect.succeed({ 'aps-environment': 'production' }),
    );
    const stale = await runSigningEffect(
      staleCachedSigningTargets(
        stubClient({ [`${MAIN}-res`]: ['APP_GROUPS'], [`${WIDGET}-res`]: ['APP_GROUPS'] }),
        SIGNING,
      ),
    );
    expect(stale).toEqual([
      { bundleId: MAIN, missing: ['APP_GROUPS'] },
      { bundleId: WIDGET, missing: ['APP_GROUPS'] },
    ]);
  });
  it('returns [] when every cached profile already covers the enabled capabilities', async () => {
    vi.mocked(extractProfileEntitlements).mockReturnValue(
      Effect.succeed({
        'com.apple.security.application-groups': ['group.com.example.sampleapp'],
      }),
    );
    const stale = await runSigningEffect(
      staleCachedSigningTargets(
        stubClient({ [`${MAIN}-res`]: ['APP_GROUPS'], [`${WIDGET}-res`]: ['APP_GROUPS'] }),
        SIGNING,
      ),
    );
    expect(stale).toEqual([]);
  });
  it('treats an unreadable profile as current - best-effort, never a needless regenerate', async () => {
    // Off-Mac or a decode failure -> extractProfileEntitlements returns null -> graded current.
    vi.mocked(extractProfileEntitlements).mockReturnValue(Effect.succeed(null));
    const stale = await runSigningEffect(
      staleCachedSigningTargets(
        stubClient({ [`${MAIN}-res`]: ['APP_GROUPS'], [`${WIDGET}-res`]: ['APP_GROUPS'] }),
        SIGNING,
      ),
    );
    expect(stale).toEqual([]);
  });
  it('grades the main bundle alone when the app has no extension profiles', async () => {
    vi.mocked(extractProfileEntitlements).mockReturnValue(
      Effect.succeed({ 'aps-environment': 'production' }),
    );
    const stale = await runSigningEffect(
      staleCachedSigningTargets(stubClient({ [`${MAIN}-res`]: ['APP_GROUPS'] }), MAIN_ONLY),
    );
    expect(stale).toEqual([{ bundleId: MAIN, missing: ['APP_GROUPS'] }]);
  });
  it('skips an unregistered target (findBundleId -> null)', async () => {
    vi.mocked(extractProfileEntitlements).mockReturnValue(
      Effect.succeed({ 'aps-environment': 'production' }),
    );
    const stale = await runSigningEffect(
      staleCachedSigningTargets(
        stubClient(
          { [`${MAIN}-res`]: ['APP_GROUPS'] },
          { findBundleId: vi.fn(() => Effect.succeed(null)) },
        ),
        MAIN_ONLY,
      ),
    );
    expect(stale).toEqual([]);
  });
});
