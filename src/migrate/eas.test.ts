import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectDefined } from '../testkit/assertions-testkit.ts';
import type { AppDescriptor } from '../types/app.ts';
import type {
  EasJson,
  MigrationArtifact,
  MigrationNote,
  MigrationNoteLevel,
} from '../types/migrate.ts';
import {
  collectEnvironmentKeys,
  credentialsSummaryFromJson,
  describeRuntimeVersion,
  expoFactsFromResolvedConfig,
  launchProfilesFromEas,
  migrateEas,
  notesFromCredentialsSummary,
  notesFromEasConfiguration,
  notesFromExpoFacts,
  parseEasJson,
} from './eas.ts';

/** A realistic eas.json covering build profiles, env, submit credentials, and the cli block. */
const SAMPLE_EAS = JSON.stringify({
  cli: { appVersionSource: 'remote' },
  build: {
    development: {
      developmentClient: true,
      distribution: 'internal',
      channel: 'development',
      env: { API_URL: 'https://dev' },
    },
    production: {
      channel: 'production',
      env: { API_URL: 'https://prod', SENTRY_DSN: 'x' },
      autoIncrement: true,
    },
  },
  submit: {
    production: {
      ios: { appleId: 'you@example.com', ascAppId: '123', appleTeamId: 'ABCD' },
      android: { serviceAccountKeyPath: './play-key.json', track: 'internal' },
    },
  },
});

/** A minimal app descriptor, overridable per field. */
const app = (over: Partial<AppDescriptor> = {}): AppDescriptor => ({
  name: 'alpha',
  dir: '/tmp',
  configPath: '/tmp/app.json',
  bundleId: 'com.acme.alpha',
  ...over,
});

/** The artifact at `path`, asserting it was emitted. */
const artifact = (artifacts: readonly MigrationArtifact[], path: string): MigrationArtifact => {
  const found = artifacts.find((entry) => entry.path == path);
  expect(found, `expected artifact ${path}`).toBeDefined();
  return expectDefined(found, `artifact ${path}`);
};

/** Notes at a given level. */
const notesAt = (notes: readonly MigrationNote[], level: MigrationNoteLevel): MigrationNote[] =>
  notes.filter((note) => note.level == level);

function sampleEasConfiguration(): EasJson {
  return parseEasJson(SAMPLE_EAS);
}

describe('parseEasJson', () => {
  it('parses build, submit, and cli into the narrowed shape', () => {
    const eas = parseEasJson(SAMPLE_EAS);
    expect(Object.keys(eas.build).sort()).toEqual(['development', 'production']);
    expect(eas.build['production']?.env).toEqual({ API_URL: 'https://prod', SENTRY_DSN: 'x' });
    expect(eas.build['development']?.distribution).toBe('internal');
    expect(eas.submit['production']?.android?.track).toBe('internal');
    expect(eas.cli?.appVersionSource).toBe('remote');
  });
  it('defaults missing sections rather than failing', () => {
    const eas = parseEasJson('{}');
    expect(eas).toEqual({ build: {}, submit: {} });
  });
  it('drops non-string env values and empty halves', () => {
    const serialized = JSON.stringify({
      build: { p: { env: { A: '1', B: 2 } } },
      submit: { p: { ios: {} } },
    });
    const eas = parseEasJson(serialized);
    expect(eas.build['p']?.env).toEqual({ A: '1' });
    expect(eas.submit['p']?.ios).toBeUndefined();
  });
  it('returns a tagged failure for invalid JSON', () => {
    let parsingFailure: unknown = null;

    try {
      parseEasJson('{ not json');
    } catch (error) {
      parsingFailure = error;
    }

    expect(parsingFailure).toMatchObject({ reason: 'InvalidEasJson' });
  });
  it('returns a tagged failure for a non-object document', () => {
    let parsingFailure: unknown = null;

    try {
      parseEasJson('"a string"');
    } catch (error) {
      parsingFailure = error;
    }

    expect(parsingFailure).toMatchObject({ reason: 'InvalidEasJson' });
  });
});

describe('launchProfilesFromEas', () => {
  it('lifts a valid Play track from the matching submit profile', () => {
    const launchProfiles = launchProfilesFromEas(sampleEasConfiguration());
    expect(launchProfiles['production']?.track).toBe('internal');
    expect(launchProfiles['development']?.name).toBe('development');
    expect(launchProfiles['development']?.track).toBeUndefined();
  });

  it('falls back to a single production profile when eas.json declares none', () => {
    const launchProfiles = launchProfilesFromEas({ build: {}, submit: {} });
    const ownKeys = Object.keys(launchProfiles);
    expect(ownKeys).toEqual(['production']);
    expect(launchProfiles['production']).toEqual({ name: 'production', sizeBudgetMB: 200 });
  });

  it('ignores unrecognized Play tracks instead of writing them onto Launch profiles', () => {
    const launchProfiles = launchProfilesFromEas({
      build: { beta: {} },
      submit: { beta: { android: { track: 'alpha-track' } } },
    });
    expect(launchProfiles['beta']?.track).toBeUndefined();
  });
});

describe('collectEnvironmentKeys', () => {
  it('unions profile env keys and sorts them', () => {
    const environmentKeys = collectEnvironmentKeys(sampleEasConfiguration());
    expect(environmentKeys).toEqual(['API_URL', 'SENTRY_DSN']);
  });

  it('returns an empty list when no profile declares env', () => {
    const environmentKeys = collectEnvironmentKeys({ build: { production: {} }, submit: {} });
    expect(environmentKeys).toEqual([]);
  });
});

describe('notesFromEasConfiguration', () => {
  it('maps profiles and flags channels, internal distribution, and submit credentials as manual', () => {
    const notes = notesFromEasConfiguration(sampleEasConfiguration(), [
      app({ packageName: 'com.acme.alpha' }),
    ]);
    const mapped = notesAt(notes, 'mapped').map((note) => note.message);
    const manual = notesAt(notes, 'manual').map((note) => note.message);
    const informational = notesAt(notes, 'info').map((note) => note.message);
    expect(mapped.some((message) => message.includes('Build profile "production"'))).toBe(true);
    expect(mapped.some((message) => message.includes('appVersionSource'))).toBe(true);
    expect(manual.some((message) => message.includes('channel'))).toBe(true);
    expect(manual.some((message) => message.includes('internal (ad-hoc) distribution'))).toBe(true);
    expect(manual.some((message) => message.includes('Apple account details'))).toBe(true);
    expect(manual.some((message) => message.includes('Play service account'))).toBe(true);
    expect(
      informational.some(
        (message) => message.includes('com.acme.alpha') && message.includes('package'),
      ),
    ).toBe(true);
  });

  it('flags an unrecognized Play track as manual without mapping it', () => {
    const notes = notesFromEasConfiguration(
      {
        build: { beta: {} },
        submit: { beta: { android: { track: 'canary' } } },
      },
      [],
    );
    expect(
      notesAt(notes, 'manual').some((note) => note.message.includes('unrecognized Play track')),
    ).toBe(true);
  });
});

describe('credentialsSummaryFromJson / notesFromCredentialsSummary', () => {
  it('keeps path and alias facts while dropping password fields', () => {
    const serialized = JSON.stringify({
      ios: {
        provisioningProfilePath: 'ios/certs/profile.mobileprovision',
        distributionCertificate: { path: 'ios/certs/dist.p12', password: 'SUPER_SECRET_PW' },
      },
      android: {
        keystore: {
          keystorePath: 'android/release.keystore',
          keyAlias: 'upload',
          keystorePassword: 'KS_SECRET',
          keyPassword: 'KEY_SECRET',
        },
      },
    });
    const credentialsSummary = credentialsSummaryFromJson(serialized);
    expect(credentialsSummary).toEqual({
      ios: {
        distributionCertificatePath: 'ios/certs/dist.p12',
        provisioningProfilePath: 'ios/certs/profile.mobileprovision',
      },
      android: {
        keystorePath: 'android/release.keystore',
        keyAlias: 'upload',
      },
    });
    const summaryJson = JSON.stringify(credentialsSummary);
    expect(summaryJson).not.toContain('SUPER_SECRET_PW');
    expect(summaryJson).not.toContain('KS_SECRET');
    expect(summaryJson).not.toContain('KEY_SECRET');
  });

  it('returns null for empty or unusable credentials documents', () => {
    const credentialsSummaryFrom = credentialsSummaryFromJson('{}');
    expect(credentialsSummaryFrom).toBeNull();
    expect(credentialsSummaryFromJson('{ not json')).toBeNull();
    const serialized = JSON.stringify({ ios: {} });
    expect(credentialsSummaryFromJson(serialized)).toBeNull();
  });

  it('emits manual creds follow-ups that point at launch-store creds for path facts only', () => {
    const notes = notesFromCredentialsSummary({
      ios: { distributionCertificatePath: 'ios/certs/dist.p12' },
      android: { keystorePath: 'android/release.keystore', keyAlias: 'upload' },
    });
    const messages = notes.map((note) => note.message);
    expect(messages.some((message) => message.includes('ios/certs/dist.p12'))).toBe(true);
    expect(messages.some((message) => message.includes('android/release.keystore'))).toBe(true);
    expect(messages.some((message) => message.includes('"upload"'))).toBe(true);
    const serialized = JSON.stringify(notes);
    expect(serialized).not.toContain('SUPER_SECRET');
  });
});

describe('expoFactsFromResolvedConfig / notesFromExpoFacts', () => {
  it('reads wrapped expo facts and describes policy runtime versions', () => {
    const expoFacts = expoFactsFromResolvedConfig({
      expo: {
        owner: 'acme-org',
        runtimeVersion: { policy: 'sdkVersion' },
        updates: { url: 'https://u.expo.dev/abc' },
        extra: { eas: { projectId: '11111111-2222-3333-4444-555555555555' } },
      },
    });
    expect(expoFacts).not.toBeNull();
    if (expoFacts == null) return;
    expect(expoFacts.runtimeVersion).toEqual({ policy: 'sdkVersion' });
    if (expoFacts.runtimeVersion == null) return;
    expect(describeRuntimeVersion(expoFacts.runtimeVersion)).toBe('policy "sdkVersion"');
    const informational = notesFromExpoFacts('alpha', expoFacts).map((note) => note.message);
    expect(
      informational.some((message) => message.includes('11111111-2222-3333-4444-555555555555')),
    ).toBe(true);
    expect(informational.some((message) => message.includes('acme-org'))).toBe(true);
    expect(informational.some((message) => message.includes('sdkVersion'))).toBe(true);
    expect(informational.some((message) => message.includes('expo.updates'))).toBe(true);
  });

  it('accepts a bare expo document and a string runtimeVersion', () => {
    const expoFacts = expoFactsFromResolvedConfig({
      owner: 'solo',
      runtimeVersion: '1.2.3',
    });
    expect(expoFacts).not.toBeNull();
    if (expoFacts == null) return;
    expect(expoFacts.runtimeVersion).toBe('1.2.3');
    if (expoFacts.runtimeVersion == null) return;
    expect(describeRuntimeVersion(expoFacts.runtimeVersion)).toBe('1.2.3');
  });
});

describe('migrateEas', () => {
  let dir: string;
  beforeEach(() => {
    const systemTemporaryDirectory = tmpdir();
    const launchMigratePath = join(systemTemporaryDirectory, 'launch-migrate-');
    dir = mkdtempSync(launchMigratePath);
    const easPath = join(dir, 'eas.json');
    writeFileSync(easPath, SAMPLE_EAS);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  function runMigrateEas(workingDirectory: string, apps: AppDescriptor[]) {
    return migrateEas(workingDirectory, apps);
  }
  it('returns a tagged failure when there is no eas.json', async () => {
    const easPath = join(dir, 'eas.json');
    rmSync(easPath);
    await expect(migrateEas(dir, [app()])).rejects.toMatchObject({
      _tag: 'EasMigrationFailure',
      reason: 'MissingEasConfig',
    });
  });
  it('emits launch.config.ts carrying every EAS build profile', async () => {
    const migration = await runMigrateEas(dir, [app()]);
    const config = artifact(migration.artifacts, 'launch.config.ts').contents;
    expect(config).toContain('"development"');
    expect(config).toContain('"production"');
    expect(config).toContain('defineConfig');
  });
  it('lifts the Play track from the matching submit profile onto the build profile', async () => {
    const config = artifact(
      (await runMigrateEas(dir, [app()])).artifacts,
      'launch.config.ts',
    ).contents;
    expect(config).toContain('"track": "internal"');
  });
  it('collects env keys (sorted, values blanked) into .env.example', async () => {
    const env = artifact((await runMigrateEas(dir, [app()])).artifacts, '.env.example').contents;
    expect(env).toContain('API_URL=');
    expect(env).toContain('SENTRY_DSN=');
    expect(env).not.toContain('https://prod');
  });
  it('emits a .env.<profile> file (keys only) for each profile that carries its own env', async () => {
    const migration = await runMigrateEas(dir, [app()]);
    const dev = artifact(migration.artifacts, '.env.development').contents;
    const prod = artifact(migration.artifacts, '.env.production').contents;
    expect(dev).toContain('API_URL=');
    expect(dev).not.toContain('https://dev');
    expect(prod).toContain('API_URL=');
    expect(prod).toContain('SENTRY_DSN=');
    expect(prod).not.toContain('https://prod');
    expect(
      notesAt(migration.notes, 'mapped').some((note) => note.message.includes('.env.production')),
    ).toBe(true);
  });
  it('scaffolds store.config.json when absent and notes it as manual', async () => {
    const migration = await runMigrateEas(dir, [app()]);
    expect(migration.artifacts.map((migrationArtifact) => migrationArtifact.path)).toContain(
      'store.config.json',
    );
    const manual = notesAt(migration.notes, 'manual').map((note) => note.message);
    expect(manual.some((message) => message.includes('store.config.json'))).toBe(true);
  });
  it('skips store.config.json when one already exists', async () => {
    const storePath = join(dir, 'store.config.json');
    writeFileSync(storePath, '{}');
    const migration = await runMigrateEas(dir, [app()]);
    expect(migration.artifacts.map((migrationArtifact) => migrationArtifact.path)).not.toContain(
      'store.config.json',
    );
    expect(
      notesAt(migration.notes, 'skipped').some((note) =>
        note.message.includes('store.config.json'),
      ),
    ).toBe(true);
  });
  it('reports EAS Update channels, internal distribution, and submit credentials as manual', async () => {
    const manual = notesAt((await runMigrateEas(dir, [app()])).notes, 'manual').map(
      (note) => note.message,
    );
    expect(manual.some((message) => message.includes('channel'))).toBe(true);
    expect(manual.some((message) => message.includes('internal (ad-hoc) distribution'))).toBe(true);
    expect(manual.some((message) => message.includes('Apple account details'))).toBe(true);
    expect(manual.some((message) => message.includes('Play service account'))).toBe(true);
  });
  it('imports local credentials.json as manual notes without ever surfacing a password', async () => {
    const credentialsPath = join(dir, 'credentials.json');
    const serialized = JSON.stringify({
      ios: {
        provisioningProfilePath: 'ios/certs/profile.mobileprovision',
        distributionCertificate: { path: 'ios/certs/dist.p12', password: 'SUPER_SECRET_PW' },
      },
      android: {
        keystore: {
          keystorePath: 'android/release.keystore',
          keyAlias: 'upload',
          keystorePassword: 'KS_SECRET',
          keyPassword: 'KEY_SECRET',
        },
      },
    });
    writeFileSync(credentialsPath, serialized);
    const migration = await runMigrateEas(dir, [app()]);
    const manual = notesAt(migration.notes, 'manual').map((note) => note.message);
    expect(
      manual.some(
        (message) =>
          message.includes('ios/certs/dist.p12') && message.includes('launch-store creds'),
      ),
    ).toBe(true);
    expect(
      manual.some(
        (message) => message.includes('android/release.keystore') && message.includes('"upload"'),
      ),
    ).toBe(true);
    const migrationJson = JSON.stringify(migration);
    expect(migrationJson).not.toContain('SUPER_SECRET_PW');
    expect(migrationJson).not.toContain('KS_SECRET');
    expect(migrationJson).not.toContain('KEY_SECRET');
  });
  it('reports remote appVersionSource and detected ids as non-manual', async () => {
    const migration = await runMigrateEas(dir, [app({ packageName: 'com.acme.alpha' })]);
    expect(
      notesAt(migration.notes, 'mapped').some((note) => note.message.includes('appVersionSource')),
    ).toBe(true);
    const informationalNotes = notesAt(migration.notes, 'info').map((note) => note.message);
    expect(
      informationalNotes.some(
        (message) => message.includes('com.acme.alpha') && message.includes('bundle id'),
      ),
    ).toBe(true);
    expect(
      informationalNotes.some(
        (message) => message.includes('com.acme.alpha') && message.includes('package'),
      ),
    ).toBe(true);
  });
  it('surfaces EAS app facts (projectId, owner, runtimeVersion, updates) from app.json as info notes', async () => {
    const systemTemporaryDirectory = tmpdir();
    const launchMigrateAppPath = join(systemTemporaryDirectory, 'launch-migrate-app-');
    const appDir = mkdtempSync(launchMigrateAppPath);
    const easPath = join(appDir, 'eas.json');
    writeFileSync(easPath, SAMPLE_EAS);
    const appPath = join(appDir, 'app.json');
    const serialized = JSON.stringify({
      expo: {
        name: 'alpha',
        slug: 'alpha',
        owner: 'acme-org',
        runtimeVersion: { policy: 'sdkVersion' },
        updates: { url: 'https://u.expo.dev/abc' },
        extra: { eas: { projectId: '11111111-2222-3333-4444-555555555555' } },
      },
    });
    writeFileSync(appPath, serialized);
    try {
      const appPath = join(appDir, 'app.json');
      const migration = await runMigrateEas(appDir, [app({ dir: appDir, configPath: appPath })]);
      const informationalNotes = notesAt(migration.notes, 'info').map((note) => note.message);
      expect(
        informationalNotes.some((message) =>
          message.includes('11111111-2222-3333-4444-555555555555'),
        ),
      ).toBe(true);
      expect(informationalNotes.some((message) => message.includes('acme-org'))).toBe(true);
      expect(informationalNotes.some((message) => message.includes('sdkVersion'))).toBe(true);
      expect(informationalNotes.some((message) => message.includes('expo.updates'))).toBe(true);
    } finally {
      rmSync(appDir, { recursive: true, force: true });
    }
  });
  it('falls back to a single production profile when eas.json declares none', async () => {
    const easPath = join(dir, 'eas.json');
    const serialized = JSON.stringify({ submit: {} });
    writeFileSync(easPath, serialized);
    const config = artifact(
      (await runMigrateEas(dir, [app()])).artifacts,
      'launch.config.ts',
    ).contents;
    expect(config).toContain('"production"');
  });
});
