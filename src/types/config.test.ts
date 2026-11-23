import { describe, expect, it } from 'vitest';
import { parseLaunchConfig, validateLaunchConfig } from '../config/schema.ts';
import {
  DEFAULT_BUILD_ENGINE,
  DEFAULT_CREDENTIALS_PROVIDER,
  DEFAULT_STORAGE_PROVIDER,
  DEFAULT_SUBMITTER,
} from './config.ts';

function describeLaunchPieceParseBoundary() {
  function fillsTheFourProviderDefaultsOnParseSoAMinimalPieceOnlyDeclaresProfiles() {
    const parsed = parseLaunchConfig({ profiles: {} });

    expect(parsed).toMatchObject({
      credentials: DEFAULT_CREDENTIALS_PROVIDER,
      storage: DEFAULT_STORAGE_PROVIDER,
      buildEngine: DEFAULT_BUILD_ENGINE,
      submit: DEFAULT_SUBMITTER,
    });
  }

  it(
    'fills the four provider defaults on parse, so a minimal config only declares profiles',
    fillsTheFourProviderDefaultsOnParseSoAMinimalPieceOnlyDeclaresProfiles,
  );

  function keepsACallerSetProviderNameOverTheDefault() {
    const parsed = parseLaunchConfig({ profiles: {}, storage: 's3' });
    expect(parsed.storage).toBe('s3');
  }

  it(
    'keeps a caller-set provider name over the default',
    keepsACallerSetProviderNameOverTheDefault,
  );

  function rejectsAnUnknownTopLevelKeyStrictRootThe197Gate() {
    const validateLaunch = validateLaunchConfig({ profiles: {}, nope: 1 });
    expect(validateLaunch.length).toBeGreaterThan(0);
  }

  it(
    'rejects an unknown top-level key (strict root - the #197 gate)',
    rejectsAnUnknownTopLevelKeyStrictRootThe197Gate,
  );

  function acceptsThePerPlatformSubmitFormForASubsetOfPlatforms() {
    const parsed = parseLaunchConfig({
      profiles: {},
      submit: { android: ['google-play', 'amazon-appstore'] },
    });

    expect(parsed.submit).toEqual({ android: ['google-play', 'amazon-appstore'] });
  }

  it(
    'accepts the per-platform submit form for a subset of platforms',
    acceptsThePerPlatformSubmitFormForASubsetOfPlatforms,
  );
}

describe('LaunchConfig parse boundary', describeLaunchPieceParseBoundary);

function describeSubmitByPlatformValidationViaLaunchPieceSchema() {
  function acceptsASinglePlatformKeyAndRejectsUnknownPlatformKeys() {
    const validateLaunch = validateLaunchConfig({
      profiles: {},
      submit: { ios: ['app-store-connect'] },
    });

    expect(validateLaunch).toEqual([]);
    expect(validateLaunchConfig({ profiles: {}, submit: {} })).toEqual([]);
    expect(
      validateLaunchConfig({
        profiles: {},
        submit: { windows: ['x'] },
      }).length,
    ).toBeGreaterThan(0);
  }

  it(
    'accepts a single platform key and rejects unknown platform keys',
    acceptsASinglePlatformKeyAndRejectsUnknownPlatformKeys,
  );
}

describe(
  'SubmitByPlatform validation via LaunchConfig schema',
  describeSubmitByPlatformValidationViaLaunchPieceSchema,
);
