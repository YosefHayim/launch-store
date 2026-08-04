import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { buildDashboardState, RECENT_ARTIFACT_LIMIT, type DashboardInputs } from './state.js';
import type { AppDescriptor } from '../types/app.js';
import type { BuildArtifact } from '../types/artifacts.js';
import type { LaunchConfig } from '../types/config.js';
import type { AccountRecord } from '../types/credentials.js';
import type { HostHandle } from '../types/remote.js';
const NOW = new Date('2026-06-18T12:00:00.000Z');
const TEST_LAUNCH_HOME = '/home/test/.launch';
/** A minimal config; tests override only what they exercise. */
const config = (overrides: Partial<LaunchConfig> = {}): LaunchConfig => {
  return {
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    profiles: { production: { name: 'production' }, preview: { name: 'preview' } },
    ...overrides,
  };
};
const app = (overrides: Partial<AppDescriptor> = {}): AppDescriptor => {
  return {
    name: 'sampleapp',
    dir: '/apps/sampleapp',
    configPath: '/apps/sampleapp/app.json',
    ...overrides,
  };
};
const account = (overrides: Partial<AccountRecord> = {}): AccountRecord => {
  return {
    keyId: 'KEY1',
    issuerId: 'ISS',
    label: 'Personal',
    addedAt: NOW.toISOString(),
    ...overrides,
  };
};
const artifact = (overrides: Partial<BuildArtifact> = {}): BuildArtifact => {
  return {
    path: '/store/sampleapp.ipa',
    platform: 'ios',
    appName: 'sampleapp',
    profile: 'production',
    version: '1.0.0',
    buildNumber: 1,
    sizeReport: { artifactBytes: 30 * 1024 * 1024, entries: [] },
    clean: true,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
};
/** Assemble inputs with sensible empties; each test overrides the slice it cares about. */
const inputs = (overrides: Partial<DashboardInputs> = {}): DashboardInputs => {
  return {
    now: NOW,
    launchHome: TEST_LAUNCH_HOME,
    config: config(),
    apps: [],
    accounts: [],
    activeKeyId: null,
    artifacts: [],
    secrets: [],
    cloudHost: null,
    ...overrides,
  };
};
describe('buildDashboardState', () => {
  const projectDashboardState = (dashboardInputs: DashboardInputs) =>
    Effect.runSync(buildDashboardState(dashboardInputs));
  it('stamps the snapshot time and the local state home', () => {
    const dashboardState = projectDashboardState(inputs());
    expect(dashboardState.generatedAt).toBe(NOW.toISOString());
    expect(dashboardState.launchHome).toBe(TEST_LAUNCH_HOME);
  });
  it('projects the provider wiring and profile names from the config', () => {
    const dashboardState = projectDashboardState(inputs({ config: config({ storage: 's3' }) }));
    expect(dashboardState.project.providers).toEqual({
      credentials: 'local',
      storage: 's3',
      buildEngine: 'fastlane',
      submit: 'app-store-connect',
    });
    expect(dashboardState.project.profiles).toEqual(['production', 'preview']);
  });
  it('collapses absent app optionals to null', () => {
    const dashboardState = projectDashboardState(
      inputs({ apps: [app({ version: '2.1.0', bundleId: 'com.x.y' })] }),
    );
    expect(dashboardState.project.apps[0]).toEqual({
      name: 'sampleapp',
      version: '2.1.0',
      bundleId: 'com.x.y',
      packageName: null,
    });
  });
  it('flags the active account and counts its visible apps', () => {
    const dashboardState = projectDashboardState(
      inputs({
        accounts: [
          account({ keyId: 'KEY1', apps: ['a', 'b'] }),
          account({ keyId: 'KEY2', label: 'Client' }),
        ],
        activeKeyId: 'KEY2',
      }),
    );
    expect(dashboardState.accounts[0]).toMatchObject({ keyId: 'KEY1', appCount: 2, active: false });
    expect(dashboardState.accounts[1]).toMatchObject({ keyId: 'KEY2', appCount: 0, active: true });
  });
  it('caps recent artifacts at the limit while preserving newest-first order', () => {
    const many = Array.from({ length: RECENT_ARTIFACT_LIMIT + 5 }, (_, i) =>
      artifact({ buildNumber: i + 1 }),
    );
    const dashboardState = projectDashboardState(inputs({ artifacts: many }));
    expect(dashboardState.artifacts).toHaveLength(RECENT_ARTIFACT_LIMIT);
    expect(dashboardState.artifacts[0]?.buildNumber).toBe(1);
  });
  it('rounds artifact size to MB and marks pruned binaries', () => {
    const dashboardState = projectDashboardState(
      inputs({
        artifacts: [
          artifact({ sizeReport: { artifactBytes: 31457280, entries: [] } }), // 30 MB exactly
          artifact({ sizeReport: { artifactBytes: 0, entries: [] }, prunedAt: NOW.toISOString() }),
        ],
      }),
    );
    expect(dashboardState.artifacts[0]).toMatchObject({ sizeMB: 30, pruned: false });
    expect(dashboardState.artifacts[1]).toMatchObject({ sizeMB: null, pruned: true });
  });
  it('carries only the non-secret coordinates of each build secret', () => {
    const dashboardState = projectDashboardState(
      inputs({ secrets: [{ app: 'sampleapp', profile: null, name: 'SENTRY_AUTH_TOKEN' }] }),
    );
    expect(dashboardState.secrets).toEqual([
      { app: 'sampleapp', profile: null, name: 'SENTRY_AUTH_TOKEN' },
    ]);
  });
  it('projects the live cloud host, or null when none is allocated', () => {
    expect(projectDashboardState(inputs()).cloudHost).toBeNull();
    const host: HostHandle = {
      provider: 'aws-ec2-mac',
      ssh: { host: '1.2.3.4', user: 'ec2-user', port: 22 },
      allocatedAt: NOW.toISOString(),
      region: 'us-east-1',
      instanceType: 'mac2.metal',
      instanceId: 'i-abc',
    };
    const dashboardState = projectDashboardState(inputs({ cloudHost: host }));
    expect(dashboardState.cloudHost).toEqual({
      provider: 'aws-ec2-mac',
      region: 'us-east-1',
      instanceType: 'mac2.metal',
      instanceId: 'i-abc',
      allocatedAt: NOW.toISOString(),
    });
  });
});
