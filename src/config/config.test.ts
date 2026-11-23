import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '../define-launch-file.ts';
import {
  findLaunchConfig,
  launchConfigForApp,
  loadConfig,
  writeAppEntitlements,
  writeAppVersion,
} from './config.ts';
import { validateConfig } from './config-schema.ts';
import type { AppDescriptor } from '../types/app.ts';
import { expectArrayElement, expectDefined } from '../testkit/assertions-testkit.ts';
const tempDirs: string[] = [];

async function runConfigEffect<Success>(configWork: Promise<Success>): Promise<Success> {
  return configWork;
}

function makeRepo(): string {
  const systemTemporaryDirectory = tmpdir();
  const joinedPath = join(systemTemporaryDirectory, 'launch-config-');
  const dir = mkdtempSync(joinedPath);

  tempDirs.push(dir);

  return dir;
}

/** Write an app.json (Expo `{ expo: {...} }` wrapper) into a (possibly nested) app directory. */
function writeApp(repo: string, relDir: string, expo: Record<string, unknown>): void {
  const dir = join(repo, relDir);

  mkdirSync(dir, { recursive: true });

  const appPath = join(dir, 'app.json');
  const serialized = JSON.stringify({ expo });

  writeFileSync(appPath, serialized);
}

/** Write an arbitrary config file (e.g. app.config.ts) into a (possibly nested) app directory. */
function writeConfigFile(repo: string, relDir: string, filename: string, contents: string): void {
  const dir = join(repo, relDir);
  mkdirSync(dir, { recursive: true });
  const joinedPath = join(dir, filename);
  writeFileSync(joinedPath, contents);
}

function cleanup() {
  while (tempDirs.length > 0) {
    rmSync(expectDefined(tempDirs.pop(), 'temp dir'), { recursive: true, force: true });
  }
}

afterEach(cleanup);

function describeDefinePiece() {
  function fillsTheV1DefaultsSoAMinimalPieceOnlyDeclaresProfiles() {
    const config = defineConfig({ profiles: { production: { name: 'production' } } });

    expect(config.credentials).toBe('local');
    expect(config.storage).toBe('local');
    expect(config.buildEngine).toBe('xcode');
    expect(config.submit).toBe('app-store-connect');
    expect(config.appRoots).toBeUndefined();
    expect(config.aws).toBeUndefined();
    expect(config.release).toBeUndefined();
  }

  it(
    'fills the v1 defaults so a minimal config only declares profiles',
    fillsTheV1DefaultsSoAMinimalPieceOnlyDeclaresProfiles,
  );

  function preservesExplicitOverridesAndAppRoots() {
    const config = defineConfig({
      credentials: 'team',
      storage: 'archive',
      appRoots: ['./apps'],
      profiles: { preview: { name: 'preview' } },
    });

    expect(config.credentials).toBe('team');
    expect(config.storage).toBe('archive');
    expect(config.appRoots).toEqual(['./apps']);
  }

  it('preserves explicit overrides and appRoots', preservesExplicitOverridesAndAppRoots);

  function carriesAnExplicitReleasePolicyThroughUnchanged() {
    const config = defineConfig({
      profiles: { production: { name: 'production' } },
      release: { releaseType: 'MANUAL', phasedRelease: true, releaseNotes: 'Bug fixes.' },
    });

    expect(config.release).toEqual({
      releaseType: 'MANUAL',
      phasedRelease: true,
      releaseNotes: 'Bug fixes.',
    });
  }

  it(
    'carries an explicit release policy through unchanged',
    carriesAnExplicitReleasePolicyThroughUnchanged,
  );

  function carriesTheFoldedAppStoreConnectSectionsThroughIssue101() {
    const config = defineConfig({
      profiles: { production: { name: 'production' } },
      gameCenter: { 'com.acme.app': { achievements: [] } },
      appClips: { 'com.acme.app': { clips: {} } },
      releaseAttributes: { 'com.acme.app': { pricing: { customerPrice: 0 } } },
      wallet: { merchantIds: [{ identifier: 'merchant.com.acme.app', name: 'Acme' }] },
      euDistribution: { domains: [{ domain: 'downloads.acme.com', referenceName: 'Acme' }] },
    });

    expect(config.gameCenter).toEqual({ 'com.acme.app': { achievements: [] } });
    expect(config.appClips).toEqual({ 'com.acme.app': { clips: {} } });
    expect(config.releaseAttributes).toEqual({ 'com.acme.app': { pricing: { customerPrice: 0 } } });
    expect(config.wallet).toEqual({
      merchantIds: [{ identifier: 'merchant.com.acme.app', name: 'Acme' }],
    });
    expect(config.euDistribution).toEqual({
      domains: [{ domain: 'downloads.acme.com', referenceName: 'Acme' }],
    });
  }

  it(
    'carries the folded App Store Connect sections through (issue #101)',
    carriesTheFoldedAppStoreConnectSectionsThroughIssue101,
  );

  function omitsTheFoldedSectionsWhenTheyArenTDeclared() {
    const config = defineConfig({ profiles: { production: { name: 'production' } } });

    expect(config.gameCenter).toBeUndefined();
    expect(config.appClips).toBeUndefined();
    expect(config.releaseAttributes).toBeUndefined();
    expect(config.wallet).toBeUndefined();
    expect(config.euDistribution).toBeUndefined();
  }

  it(
    "omits the folded sections when they aren't declared",
    omitsTheFoldedSectionsWhenTheyArenTDeclared,
  );

  function passesAnUnknownTopLevelKeyThroughSoTheSchemaValidatorCanFlagItIssue197() {
    // A real config can't be statically typed (it's loaded un-compiled), so a typo like `profile:` for
    // `profiles:` reaches `defineConfig` as an extra key. It must survive onto the resolved object -
    // not be silently dropped - for `launch-store config validate` to catch it on the `.ts` path.
    const input = { profiles: { production: { name: 'production' } }, profile: 'oops' };
    const define = defineConfig(input);
    const violations = validateConfig(define);

    function isUnknownProfileProperty(violation: { path: string; message: string }) {
      return violation.path == 'profile' && violation.message.includes('unknown property');
    }

    expect(violations.some(isUnknownProfileProperty)).toBe(true);
  }

  it(
    'passes an unknown top-level key through so the schema validator can flag it (issue #197)',
    passesAnUnknownTopLevelKeyThroughSoTheSchemaValidatorCanFlagItIssue197,
  );
}

describe('defineConfig', describeDefinePiece);

function describeFindLaunchConfigNearestFile() {
  function writeLaunchFile(directory: string, sizeBudgetMB: number): void {
    const launchPath = join(directory, 'launch.config.ts');
    const launchSource =
      `import { defineConfig } from "launch-store";\n` +
      `export default defineConfig({ profiles: { production: { name: "production", sizeBudgetMB: ${sizeBudgetMB} } } });\n`;

    writeFileSync(launchPath, launchSource);
  }

  async function walksUpToTheParentFileWhenTheWorkingDirectoryHasNone() {
    const repo = makeRepo();
    const appDirectory = join(repo, 'apps', 'mobile');

    mkdirSync(appDirectory, { recursive: true });
    writeLaunchFile(repo, 111);

    const foundConfig = await findLaunchConfig(appDirectory);

    expect(foundConfig?.config.profiles['production']?.sizeBudgetMB).toBe(111);
    expect(foundConfig?.path).toBe(join(repo, 'launch.config.ts'));
  }

  it(
    'walks up to the parent file when the working directory has none',
    walksUpToTheParentFileWhenTheWorkingDirectoryHasNone,
  );

  async function anAppDirectoryFileWinsOverTheParent() {
    const repo = makeRepo();
    const appDirectory = join(repo, 'apps', 'mobile');

    mkdirSync(appDirectory, { recursive: true });
    writeLaunchFile(repo, 111);
    writeLaunchFile(appDirectory, 222);

    const foundConfig = await findLaunchConfig(appDirectory);

    expect(foundConfig?.config.profiles['production']?.sizeBudgetMB).toBe(222);
    expect(foundConfig?.path).toBe(join(appDirectory, 'launch.config.ts'));
  }

  it('an app directory file wins over the parent', anAppDirectoryFileWinsOverTheParent);

  async function anAppDirectoryWithoutAFileKeepsTheFallback() {
    const repo = makeRepo();
    const appDirectory = join(repo, 'apps', 'mobile');
    const fallbackConfig = defineConfig({
      profiles: { production: { name: 'production', sizeBudgetMB: 111 } },
      artifactRetentionDays: 9,
    });

    mkdirSync(appDirectory, { recursive: true });

    const appLaunch = await launchConfigForApp(fallbackConfig, appDirectory);

    expect(Object.is(appLaunch, fallbackConfig)).toBe(true);
  }

  it(
    'an app directory without a file keeps the fallback',
    anAppDirectoryWithoutAFileKeepsTheFallback,
  );

  async function anAppDirectoryFileReplacesTheFallback() {
    const repo = makeRepo();
    const appDirectory = join(repo, 'apps', 'mobile');
    const fallbackConfig = defineConfig({
      profiles: { production: { name: 'production', sizeBudgetMB: 111 } },
      artifactRetentionDays: 9,
    });

    mkdirSync(appDirectory, { recursive: true });
    writeLaunchFile(appDirectory, 222);

    const appLaunch = await launchConfigForApp(fallbackConfig, appDirectory);

    expect(appLaunch.profiles['production']?.sizeBudgetMB).toBe(222);
    expect(appLaunch.artifactRetentionDays).toBeUndefined();
  }

  it('an app directory file replaces the fallback', anAppDirectoryFileReplacesTheFallback);
}

describe(
  'findLaunchConfig - the nearest launch.config.ts wins',
  describeFindLaunchConfigNearestFile,
);

describe('loadConfig - auto-discovers apps, app.json stays the source of truth', () => {
  async function fallsBackToDefaultsAndDiscoversASingleAppSFactsFromAppPiece() {
    const repo = makeRepo();

    writeApp(repo, '.', {
      name: 'Hello World',
      slug: 'hello-world',
      version: '1.2.3',
      ios: { bundleIdentifier: 'com.example.hello' },
    });

    const { config, apps } = await runConfigEffect(loadConfig(repo));

    expect(config.buildEngine).toBe('xcode');
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      name: 'hello-world',
      bundleId: 'com.example.hello',
      version: '1.2.3',
    });
    expect(apps[0]?.usesNonExemptEncryption).toBeUndefined();
  }

  it(
    "falls back to defaults and discovers a single app's facts from app.json",
    fallsBackToDefaultsAndDiscoversASingleAppSFactsFromAppPiece,
  );

  async function readsTheExpoExportComplianceAnswerIosPieceUsesNonExemptEncryption() {
    const repo = makeRepo();

    writeApp(repo, '.', {
      slug: 'secure-app',
      ios: { bundleIdentifier: 'com.example.secure', config: { usesNonExemptEncryption: false } },
    });

    const { apps } = await runConfigEffect(loadConfig(repo));

    expect(apps[0]?.usesNonExemptEncryption).toBe(false);
  }

  it(
    'reads the Expo export-compliance answer (ios.config.usesNonExemptEncryption)',
    readsTheExpoExportComplianceAnswerIosPieceUsesNonExemptEncryption,
  );

  async function readsEmbeddedAppExtensionBundleIdsIosExtensionsDroppingNonStringEntries() {
    const repo = makeRepo();

    writeApp(repo, '.', {
      slug: 'with-widget',
      ios: { bundleIdentifier: 'com.example.app', extensions: ['com.example.app.widget', '', 42] },
    });

    const { apps } = await runConfigEffect(loadConfig(repo));

    expect(apps[0]?.iosExtensions).toEqual(['com.example.app.widget']);
  }

  it(
    'reads embedded app-extension bundle ids (ios.extensions), dropping non-string entries',
    readsEmbeddedAppExtensionBundleIdsIosExtensionsDroppingNonStringEntries,
  );

  async function leavesIosExtensionsUndefinedWhenIosExtensionsIsAbsent() {
    const repo = makeRepo();
    writeApp(repo, '.', { slug: 'no-ext', ios: { bundleIdentifier: 'com.example.plain' } });
    const { apps } = await runConfigEffect(loadConfig(repo));
    expect(apps[0]?.iosExtensions).toBeUndefined();
  }

  it(
    'leaves iosExtensions undefined when ios.extensions is absent',
    leavesIosExtensionsUndefinedWhenIosExtensionsIsAbsent,
  );
  it('scans nested directories but skips heavy/generated folders', async () => {
    const repo = makeRepo();

    writeApp(repo, 'apps/alpha', { slug: 'alpha', ios: { bundleIdentifier: 'com.example.alpha' } });
    writeApp(repo, 'apps/beta', { slug: 'beta' });
    // An app.json buried in a skipped directory must NOT be discovered.
    writeApp(repo, 'node_modules/pkg', { slug: 'ghost' });

    const { apps } = await runConfigEffect(loadConfig(repo));
    const names = apps.map((app) => app.name).sort();

    expect(names).toEqual(['alpha', 'beta']);
  });

  async function derivesTheHandleFromSlugOrNameAndToleratesAFlatUnwrappedPiece() {
    const repo = makeRepo();
    const dir = join(repo, 'flat');

    mkdirSync(dir, { recursive: true });

    const appPath = join(dir, 'app.json');
    const serialized = JSON.stringify({ name: 'Flat App' });

    writeFileSync(appPath, serialized);

    const { apps } = await runConfigEffect(loadConfig(repo));

    expect(apps).toHaveLength(1);
    expect(apps[0]?.name).toBe('flat app');
    expect(apps[0]?.bundleId).toBeUndefined();
  }

  it(
    'derives the handle from slug or name and tolerates a flat (unwrapped) config',
    derivesTheHandleFromSlugOrNameAndToleratesAFlatUnwrappedPiece,
  );

  async function ignoresAnAppPieceWithNeitherSlugNorName() {
    const repo = makeRepo();
    const dir = join(repo, 'broken');

    mkdirSync(dir, { recursive: true });

    const appPath = join(dir, 'app.json');
    const serialized = JSON.stringify({ expo: { version: '1.0.0' } });

    writeFileSync(appPath, serialized);

    const { apps } = await runConfigEffect(loadConfig(repo));

    expect(apps).toHaveLength(0);
  }

  it('ignores an app.json with neither slug nor name', ignoresAnAppPieceWithNeitherSlugNorName);
});

function describeLoadPieceReadsDynamicExpoPieceAppPieceTsJsAndBareReactNative() {
  async function discoversAnAppFromAnObjectExportAppPieceTs() {
    const repo = makeRepo();

    writeConfigFile(
      repo,
      'ts-app',
      'app.config.ts',
      `export default { expo: { name: "TS App", slug: "ts-app", version: "2.0.0", ios: { bundleIdentifier: "com.example.ts" } } };`,
    );

    const { apps } = await runConfigEffect(loadConfig(repo));

    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ name: 'ts-app', bundleId: 'com.example.ts', version: '2.0.0' });
  }

  it(
    'discovers an app from an object-export app.config.ts',
    discoversAnAppFromAnObjectExportAppPieceTs,
  );

  async function evaluatesAFunctionFormAppPieceJsHandingItTheStaticPieceToExtend() {
    const repo = makeRepo();

    writeApp(repo, 'dyn', { slug: 'static-slug', ios: { bundleIdentifier: 'com.example.dyn' } });
    writeConfigFile(
      repo,
      'dyn',
      'app.config.js',
      `export default ({ config }) => ({ expo: { ...config.expo, slug: "dynamic-slug", version: "9.9.9" } });`,
    );

    const { apps } = await runConfigEffect(loadConfig(repo));

    // The dynamic config wins over app.json, but kept the bundle id it received from it.
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      name: 'dynamic-slug',
      bundleId: 'com.example.dyn',
      version: '9.9.9',
    });
  }

  it(
    'evaluates a function-form app.config.js, handing it the static config to extend',
    evaluatesAFunctionFormAppPieceJsHandingItTheStaticPieceToExtend,
  );

  async function discoversABareReactNativeAppPieceNameOnlyNoExpoWrapperOrBundleId() {
    const repo = makeRepo();
    const dir = join(repo, 'bare');

    mkdirSync(dir, { recursive: true });

    const appPath = join(dir, 'app.json');
    const serialized = JSON.stringify({ name: 'BareRN', displayName: 'Bare RN' });

    writeFileSync(appPath, serialized);

    const { apps } = await runConfigEffect(loadConfig(repo));

    expect(apps).toHaveLength(1);
    expect(apps[0]?.name).toBe('barern');
    expect(apps[0]?.bundleId).toBeUndefined();
  }

  it(
    'discovers a bare React Native app.json (name only, no expo wrapper or bundle id)',
    discoversABareReactNativeAppPieceNameOnlyNoExpoWrapperOrBundleId,
  );

  async function fallsBackToTheStaticAppPieceWhenADynamicPieceThrowsOnEvaluation() {
    const repo = makeRepo();

    writeApp(repo, 'broken-dyn', { slug: 'fallback', ios: { bundleIdentifier: 'com.example.fb' } });
    writeConfigFile(repo, 'broken-dyn', 'app.config.ts', `throw new Error("boom");`);

    const { apps } = await runConfigEffect(loadConfig(repo));

    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ name: 'fallback', bundleId: 'com.example.fb' });
  }

  it(
    'falls back to the static app.json when a dynamic config throws on evaluation',
    fallsBackToTheStaticAppPieceWhenADynamicPieceThrowsOnEvaluation,
  );
}

describe(
  'loadConfig - reads dynamic Expo config (app.config.{ts,js}) and bare React Native',
  describeLoadPieceReadsDynamicExpoPieceAppPieceTsJsAndBareReactNative,
);

function describeLoadPieceResolvesTheLaunchStoreImportWithoutALocalDependencyIssue8() {
  async function loadsAPieceThatImportsDefinePieceFromLaunchStoreInAProjectWithNoNodeModules() {
    const repo = makeRepo();
    // This temp repo has no node_modules, so `import "launch-store"` can only resolve via the loader's
    // self-alias. Before the alias a globally-installed CLI threw "Cannot find package 'launch-store'".
    const launchPath = join(repo, 'launch.config.ts');

    writeFileSync(
      launchPath,
      `import { defineConfig } from "launch-store";\n` +
        `export default defineConfig({ profiles: { staging: { name: "staging", sizeBudgetMB: 123 } } });\n`,
    );
    writeApp(repo, '.', {
      name: 'Hello',
      slug: 'hello',
      ios: { bundleIdentifier: 'com.example.hello' },
    });

    const { config } = await runConfigEffect(loadConfig(repo));

    // The custom profile proves OUR file loaded; the filled-in default proves it ran through defineConfig.
    expect(config.profiles['staging']?.sizeBudgetMB).toBe(123);
    expect(config.buildEngine).toBe('xcode');
  }

  it(
    'loads a config that imports defineConfig from launch-store in a project with no node_modules',
    loadsAPieceThatImportsDefinePieceFromLaunchStoreInAProjectWithNoNodeModules,
  );
}

describe(
  'loadConfig - resolves the launch-store import without a local dependency (issue #8)',
  describeLoadPieceResolvesTheLaunchStoreImportWithoutALocalDependencyIssue8,
);

function describeWriteAppVersionPersistTheBumpBackToAStaticAppPiece() {
  async function updatesExpoVersionOnADiscoveredAppLeavingSiblingsIntact() {
    const repo = makeRepo();

    writeApp(repo, '.', {
      name: 'Hello',
      slug: 'hello',
      version: '1.0.0',
      ios: { bundleIdentifier: 'com.x' },
    });

    const loadedConfig = await runConfigEffect(loadConfig(repo));
    const app = expectArrayElement(loadedConfig.apps, 0, 'apps');
    const appVersion = writeAppVersion(app, '1.0.1');
    const runEffect = await runConfigEffect(appVersion);

    expect(runEffect).toBe(true);

    const appPath = join(repo, 'app.json');
    const loadedFile = readFileSync(appPath, 'utf8');
    const written = JSON.parse(loadedFile);

    expect(written.expo.version).toBe('1.0.1');
    expect(written.expo.ios.bundleIdentifier).toBe('com.x');
  }

  it(
    'updates expo.version on a discovered app, leaving siblings intact',
    updatesExpoVersionOnADiscoveredAppLeavingSiblingsIntact,
  );

  async function writesAFlatVersionWhenThereSNoExpoWrapper() {
    const repo = makeRepo();
    const appPath = join(repo, 'app.json');
    const serialized = JSON.stringify({ name: 'Bare', slug: 'bare', version: '0.1.0' });

    writeFileSync(appPath, serialized);

    const app: AppDescriptor = {
      name: 'bare',
      dir: repo,
      configPath: join(repo, 'app.json'),
      version: '0.1.0',
    };
    const appVersion = writeAppVersion(app, '0.2.0');
    const runEffect = await runConfigEffect(appVersion);

    expect(runEffect).toBe(true);

    const joinedPath = join(repo, 'app.json');
    const loadedFile = readFileSync(joinedPath, 'utf8');
    const parsed = JSON.parse(loadedFile);

    expect(parsed.version).toBe('0.2.0');
  }

  it(
    "writes a flat version when there's no expo wrapper",
    writesAFlatVersionWhenThereSNoExpoWrapper,
  );

  async function refusesADynamicPieceAppPieceTsTheCallerStampsTheNativeProjectInstead() {
    const app: AppDescriptor = {
      name: 'dyn',
      dir: '/tmp/does-not-matter',
      configPath: '/tmp/does-not-matter/app.config.ts',
      version: '1.0.0',
    };
    const appVersion = writeAppVersion(app, '1.1.0');
    const runEffect = await runConfigEffect(appVersion);

    expect(runEffect).toBe(false);
  }

  it(
    'refuses a dynamic config (app.config.ts) - the caller stamps the native project instead',
    refusesADynamicPieceAppPieceTsTheCallerStampsTheNativeProjectInstead,
  );
}

describe(
  'writeAppVersion - persist the bump back to a static app.json',
  describeWriteAppVersionPersistTheBumpBackToAStaticAppPiece,
);

function describeWriteAppEntitlements() {
  /** Build an AppDescriptor pointing at a freshly-written app.json in a temp repo. */
  function appWith(expo: Record<string, unknown>): AppDescriptor {
    const repo = makeRepo();
    writeApp(repo, 'app', expo);
    return { name: 'app', dir: join(repo, 'app'), configPath: join(repo, 'app', 'app.json') };
  }

  function runWriteAppEntitlements(
    app: AppDescriptor,
    entitlements: Parameters<typeof writeAppEntitlements>[1],
  ) {
    return writeAppEntitlements(app, entitlements);
  }

  async function addsEntitlementsUnderExpoIosEntitlementsAndReturnsTheKeysItWrote() {
    const app = appWith({ ios: { bundleIdentifier: 'com.acme.app' } });
    const added = await runWriteAppEntitlements(app, {
      'aps-environment': 'production',
      'com.apple.developer.healthkit': true,
    });

    expect(added.sort()).toEqual(['aps-environment', 'com.apple.developer.healthkit']);

    const loadedFile = readFileSync(app.configPath, 'utf8');
    const raw = JSON.parse(loadedFile);

    expect(raw.expo.ios.entitlements).toEqual({
      'aps-environment': 'production',
      'com.apple.developer.healthkit': true,
    });
  }

  it(
    'adds entitlements under expo.ios.entitlements and returns the keys it wrote',
    addsEntitlementsUnderExpoIosEntitlementsAndReturnsTheKeysItWrote,
  );

  async function neverOverwritesAnEntitlementTheAppPieceAlreadyDeclares() {
    const app = appWith({ ios: { entitlements: { 'aps-environment': 'development' } } });
    const added = await runWriteAppEntitlements(app, {
      'aps-environment': 'production',
      'com.apple.security.application-groups': ['group.x'],
    });

    expect(added).toEqual(['com.apple.security.application-groups']);

    const loadedFile = readFileSync(app.configPath, 'utf8');
    const raw = JSON.parse(loadedFile);

    expect(raw.expo.ios.entitlements['aps-environment']).toBe('development');
  }

  it(
    'never overwrites an entitlement the app.json already declares',
    neverOverwritesAnEntitlementTheAppPieceAlreadyDeclares,
  );

  async function returnsWithoutWritingForADynamicPiece() {
    const app: AppDescriptor = { name: 'dyn', dir: '/tmp/x', configPath: '/tmp/x/app.config.js' };
    expect(await runWriteAppEntitlements(app, { 'aps-environment': 'production' })).toEqual([]);
  }

  it('returns [] without writing for a dynamic config', returnsWithoutWritingForADynamicPiece);
}

describe('writeAppEntitlements', describeWriteAppEntitlements);
