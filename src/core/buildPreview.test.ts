import { describe, expect, it } from 'vitest';
import type { AppDescriptor, BuildProfile, LaunchConfig } from './types.js';
import { previewBuild } from './buildPreview.js';

/** A bare config with the fields the preview reads; the rest of LaunchConfig is irrelevant here. */
function config(overrides: Partial<LaunchConfig> = {}): LaunchConfig {
  const profiles: Record<string, BuildProfile> = {
    production: { name: 'production' },
    preview: { name: 'preview', track: 'closed', rollout: 0.5 },
  };
  return {
    profiles,
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
    ...overrides,
  };
}

/** A two-platform app descriptor; drop a field to model a single-platform app. */
function app(overrides: Partial<AppDescriptor> = {}): AppDescriptor {
  return {
    name: 'pomedero',
    dir: '/repo/pomedero',
    configPath: '/repo/pomedero/app.json',
    bundleId: 'com.loopi.pomedero',
    packageName: 'com.loopi.pomedero',
    ...overrides,
  };
}

describe('previewBuild', () => {
  it('resolves the iOS engine, submitter, and bundle id without track/rollout', () => {
    const preview = previewBuild({ config: config(), apps: [app()], platform: 'ios' });
    expect(preview.platform).toBe('ios');
    expect(preview.profile).toBe('production');
    expect(preview.distribution).toBe('store');
    expect(preview.apps).toEqual([
      {
        app: 'pomedero',
        identifier: 'com.loopi.pomedero',
        buildEngine: 'fastlane',
        submitter: 'app-store-connect',
      },
    ]);
  });

  it('swaps the iOS baseline engine and submitter for their Android twins', () => {
    const preview = previewBuild({ config: config(), apps: [app()], platform: 'android' });
    const [plan] = preview.apps;
    expect(plan?.buildEngine).toBe('gradle');
    expect(plan?.submitter).toBe('google-play');
    expect(plan?.identifier).toBe('com.loopi.pomedero');
  });

  it('defaults Android track/rollout to production/full for store distribution', () => {
    const preview = previewBuild({ config: config(), apps: [app()], platform: 'android' });
    expect(preview.apps[0]?.track).toBe('production');
    expect(preview.apps[0]?.rollout).toBe(1.0);
  });

  it('rehearses an internal upload as the internal testing track', () => {
    const preview = previewBuild({
      config: config(),
      apps: [app()],
      platform: 'android',
      distribution: 'internal',
    });
    expect(preview.distribution).toBe('internal');
    expect(preview.apps[0]?.track).toBe('internal');
  });

  it("honors a profile's track and rollout defaults", () => {
    const preview = previewBuild({
      config: config(),
      apps: [app()],
      platform: 'android',
      profile: 'preview',
    });
    expect(preview.profile).toBe('preview');
    expect(preview.apps[0]?.track).toBe('closed');
    expect(preview.apps[0]?.rollout).toBe(0.5);
  });

  it("reports an absent identifier for an app that omits the platform's id", () => {
    const iosOnly: AppDescriptor = {
      name: 'ios-only',
      dir: '/repo/ios-only',
      configPath: '/repo/ios-only/app.json',
      bundleId: 'com.loopi.iosonly',
    };
    const plan = previewBuild({ config: config(), apps: [iosOnly], platform: 'android' }).apps[0];
    expect(plan?.identifier).toBeUndefined();
    expect('identifier' in (plan ?? {})).toBe(false);
  });

  it('throws on an explicit unknown profile rather than silently defaulting', () => {
    expect(() =>
      previewBuild({ config: config(), apps: [app()], platform: 'ios', profile: 'ghost' }),
    ).toThrow('Unknown profile "ghost"');
  });

  it('falls back to production, then the first profile, when no profile is given', () => {
    expect(previewBuild({ config: config(), apps: [app()], platform: 'ios' }).profile).toBe(
      'production',
    );
    const noProd = config({ profiles: { staging: { name: 'staging' } } });
    expect(previewBuild({ config: noProd, apps: [app()], platform: 'ios' }).profile).toBe(
      'staging',
    );
  });
});
