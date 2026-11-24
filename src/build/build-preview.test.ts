import { describe, expect, it } from 'vitest';
import type { AppDescriptor, BuildProfile } from '../types/app.ts';
import type { LaunchConfig } from '../types/config.ts';
import { previewBuild } from './build-preview.ts';

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
    buildEngine: 'xcode',
    submit: 'app-store-connect',
    ...overrides,
  };
}

/** A two-platform app descriptor; drop a field to model a single-platform app. */
function app(overrides: Partial<AppDescriptor> = {}): AppDescriptor {
  return {
    name: 'sampleapp',
    dir: '/repo/sampleapp',
    configPath: '/repo/sampleapp/app.json',
    bundleId: 'com.example.sampleapp',
    packageName: 'com.example.sampleapp',
    ...overrides,
  };
}

function describePreviewBuild() {
  function resolvesTheIOSEngineSubmitterAndBundleIdWithoutTrackRollout() {
    const preview = previewBuild({ config: config(), apps: [app()], platform: 'ios' });

    expect(preview.platform).toBe('ios');
    expect(preview.profile).toBe('production');
    expect(preview.distribution).toBe('store');
    expect(preview.apps).toEqual([
      {
        app: 'sampleapp',
        identifier: 'com.example.sampleapp',
        buildEngine: 'xcode',
        submitter: 'app-store-connect',
      },
    ]);
  }

  it(
    'resolves the iOS engine, submitter, and bundle id without track/rollout',
    resolvesTheIOSEngineSubmitterAndBundleIdWithoutTrackRollout,
  );

  function swapsTheIOSBaselineEngineAndSubmitterForTheirAndroidTwins() {
    const preview = previewBuild({ config: config(), apps: [app()], platform: 'android' });
    const [plan] = preview.apps;

    expect(plan?.buildEngine).toBe('gradle');
    expect(plan?.submitter).toBe('google-play');
    expect(plan?.identifier).toBe('com.example.sampleapp');
  }

  it(
    'swaps the iOS baseline engine and submitter for their Android twins',
    swapsTheIOSBaselineEngineAndSubmitterForTheirAndroidTwins,
  );

  function buildsAndroidWithGradleWhenThePieceNamesAnIOSOnlyEngine() {
    for (const buildEngine of ['remote-mac', 'eas']) {
      const preview = previewBuild({
        config: config({ buildEngine }),
        apps: [app()],
        platform: 'android',
      });
      const [plan] = preview.apps;

      expect(plan?.buildEngine).toBe('gradle');
    }
  }

  it(
    'builds Android with Gradle when the config names an iOS-only engine',
    buildsAndroidWithGradleWhenThePieceNamesAnIOSOnlyEngine,
  );

  function defaultsAndroidTrackRolloutToInternalFullLikeTheRealBuild() {
    const preview = previewBuild({ config: config(), apps: [app()], platform: 'android' });
    expect(preview.apps[0]?.track).toBe('internal');
    expect(preview.apps[0]?.rollout).toBe(1.0);
  }

  it(
    'defaults Android track/rollout to internal/full like the real build',
    defaultsAndroidTrackRolloutToInternalFullLikeTheRealBuild,
  );

  function rehearsesAnInternalUploadAsTheInternalTestingTrack() {
    const preview = previewBuild({
      config: config(),
      apps: [app()],
      platform: 'android',
      distribution: 'internal',
    });

    expect(preview.distribution).toBe('internal');
    expect(preview.apps[0]?.track).toBe('internal');
  }

  it(
    'rehearses an internal upload as the internal testing track',
    rehearsesAnInternalUploadAsTheInternalTestingTrack,
  );

  function honorsAProfileSTrackAndRolloutDefaults() {
    const preview = previewBuild({
      config: config(),
      apps: [app()],
      platform: 'android',
      profile: 'preview',
    });

    expect(preview.profile).toBe('preview');
    expect(preview.apps[0]?.track).toBe('closed');
    expect(preview.apps[0]?.rollout).toBe(0.5);
  }

  it("honors a profile's track and rollout defaults", honorsAProfileSTrackAndRolloutDefaults);

  function reportsAnAbsentIdentifierForAnAppThatOmitsThePlatformSId() {
    const iosOnly: AppDescriptor = {
      name: 'ios-only',
      dir: '/repo/ios-only',
      configPath: '/repo/ios-only/app.json',
      bundleId: 'com.example.iosonly',
    };
    const plan = previewBuild({ config: config(), apps: [iosOnly], platform: 'android' }).apps[0];

    expect(plan?.identifier).toBeUndefined();
    expect(plan).toBeDefined();

    if (plan == null) return;

    expect('identifier' in plan).toBe(false);
  }

  it(
    "reports an absent identifier for an app that omits the platform's id",
    reportsAnAbsentIdentifierForAnAppThatOmitsThePlatformSId,
  );

  function failsOnAnExplicitUnknownProfileRatherThanSilentlyDefaulting() {
    try {
      previewBuild({ config: config(), apps: [app()], platform: 'ios', profile: 'ghost' });
      throw new Error('expected an unknown profile to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        message: 'Unknown profile "ghost". Declared profiles: production, preview.',
      });
    }
  }

  it(
    'fails on an explicit unknown profile rather than silently defaulting',
    failsOnAnExplicitUnknownProfileRatherThanSilentlyDefaulting,
  );

  function fallsBackToProductionThenTheFirstProfileWhenNoProfileIsGiven() {
    const buildProgram = previewBuild({ config: config(), apps: [app()], platform: 'ios' });

    expect(buildProgram.profile).toBe('production');

    const noProd = config({ profiles: { staging: { name: 'staging' } } });

    expect(previewBuild({ config: noProd, apps: [app()], platform: 'ios' }).profile).toBe(
      'staging',
    );
  }

  it(
    'falls back to production, then the first profile, when no profile is given',
    fallsBackToProductionThenTheFirstProfileWhenNoProfileIsGiven,
  );
}

describe('previewBuild', describePreviewBuild);
