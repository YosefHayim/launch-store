import { describe, expect, it } from 'vitest';
import { buildDashboardState, RECENT_ARTIFACT_LIMIT, type DashboardInputs } from './state.js';
import { LAUNCH_HOME } from '../paths.js';
import type {
  AccountRecord,
  AppDescriptor,
  BuildArtifact,
  HostHandle,
  LaunchConfig,
} from '../types.js';

const NOW = new Date('2026-06-18T12:00:00.000Z');

/** A minimal config; tests override only what they exercise. */
function config(overrides: Partial<LaunchConfig> = {}): LaunchConfig {
  return {
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    profiles: { production: { name: 'production' }, preview: { name: 'preview' } },
    ...overrides,
  };
}

function app(overrides: Partial<AppDescriptor> = {}): AppDescriptor {
  return {
    name: 'pomedero',
    dir: '/apps/pomedero',
    configPath: '/apps/pomedero/app.json',
    ...overrides,
  };
}

function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    keyId: 'KEY1',
    issuerId: 'ISS',
    label: 'Personal',
    addedAt: NOW.toISOString(),
    ...overrides,
  };
}

function artifact(overrides: Partial<BuildArtifact> = {}): BuildArtifact {
  return {
    path: '/store/pomedero.ipa',
    platform: 'ios',
    appName: 'pomedero',
    profile: 'production',
    version: '1.0.0',
    buildNumber: 1,
    sizeReport: { artifactBytes: 30 * 1024 * 1024, entries: [] },
    clean: true,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

/** Assemble inputs with sensible empties; each test overrides the slice it cares about. */
function inputs(overrides: Partial<DashboardInputs> = {}): DashboardInputs {
  return {
    now: NOW,
    config: config(),
    apps: [],
    accounts: [],
    activeKeyId: null,
    artifacts: [],
    secrets: [],
    cloudHost: null,
    ...overrides,
  };
}

describe('buildDashboardState', () => {
  it('stamps the snapshot time and the local state home', () => {
    const state = buildDashboardState(inputs());
    expect(state.generatedAt).toBe(NOW.toISOString());
    expect(state.launchHome).toBe(LAUNCH_HOME);
  });

  it('projects the provider wiring and profile names from the config', () => {
    const state = buildDashboardState(inputs({ config: config({ storage: 's3' }) }));
    expect(state.project.providers).toEqual({
      credentials: 'local',
      storage: 's3',
      buildEngine: 'fastlane',
      submit: 'app-store-connect',
    });
    expect(state.project.profiles).toEqual(['production', 'preview']);
  });

  it('collapses absent app optionals to null', () => {
    const state = buildDashboardState(
      inputs({ apps: [app({ version: '2.1.0', bundleId: 'com.x.y' })] }),
    );
    expect(state.project.apps[0]).toEqual({
      name: 'pomedero',
      version: '2.1.0',
      bundleId: 'com.x.y',
      packageName: null,
    });
  });

  it('flags the active account and counts its visible apps', () => {
    const state = buildDashboardState(
      inputs({
        accounts: [
          account({ keyId: 'KEY1', apps: ['a', 'b'] }),
          account({ keyId: 'KEY2', label: 'Client' }),
        ],
        activeKeyId: 'KEY2',
      }),
    );
    expect(state.accounts[0]).toMatchObject({ keyId: 'KEY1', appCount: 2, active: false });
    expect(state.accounts[1]).toMatchObject({ keyId: 'KEY2', appCount: 0, active: true });
  });

  it('caps recent artifacts at the limit while preserving newest-first order', () => {
    const many = Array.from({ length: RECENT_ARTIFACT_LIMIT + 5 }, (_, i) =>
      artifact({ buildNumber: i + 1 }),
    );
    const state = buildDashboardState(inputs({ artifacts: many }));
    expect(state.artifacts).toHaveLength(RECENT_ARTIFACT_LIMIT);
    expect(state.artifacts[0]?.buildNumber).toBe(1);
  });

  it('rounds artifact size to MB and marks pruned binaries', () => {
    const state = buildDashboardState(
      inputs({
        artifacts: [
          artifact({ sizeReport: { artifactBytes: 31_457_280, entries: [] } }), // 30 MB exactly
          artifact({ sizeReport: { artifactBytes: 0, entries: [] }, prunedAt: NOW.toISOString() }),
        ],
      }),
    );
    expect(state.artifacts[0]).toMatchObject({ sizeMB: 30, pruned: false });
    expect(state.artifacts[1]).toMatchObject({ sizeMB: null, pruned: true });
  });

  it('carries only the non-secret coordinates of each build secret', () => {
    const state = buildDashboardState(
      inputs({ secrets: [{ app: 'pomedero', profile: null, name: 'SENTRY_AUTH_TOKEN' }] }),
    );
    expect(state.secrets).toEqual([{ app: 'pomedero', profile: null, name: 'SENTRY_AUTH_TOKEN' }]);
  });

  it('projects the live cloud host, or null when none is allocated', () => {
    expect(buildDashboardState(inputs()).cloudHost).toBeNull();
    const host: HostHandle = {
      provider: 'aws-ec2-mac',
      ssh: { host: '1.2.3.4', user: 'ec2-user', port: 22 },
      allocatedAt: NOW.toISOString(),
      region: 'us-east-1',
      instanceType: 'mac2.metal',
      instanceId: 'i-abc',
    };
    const state = buildDashboardState(inputs({ cloudHost: host }));
    expect(state.cloudHost).toEqual({
      provider: 'aws-ec2-mac',
      region: 'us-east-1',
      instanceType: 'mac2.metal',
      instanceId: 'i-abc',
      allocatedAt: NOW.toISOString(),
    });
  });
});
