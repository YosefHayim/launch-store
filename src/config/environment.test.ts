import { describe, expect, it } from 'vitest';
import { decodeLaunchEnvironment } from './environment.ts';

function describeDecodeLaunchEnvironment() {
  function mapsEnvironmentNamesToDomainFacingProperties() {
    const environment = decodeLaunchEnvironment({
      ASC_ACCOUNT: 'personal',
      ANDROID_HOME: '/opt/android',
      ANTHROPIC_API_KEY: 'anthropic-secret',
    });

    expect(environment.appleAccount).toBe('personal');
    expect(environment.androidSdkHome).toBe('/opt/android');
    expect(environment.anthropicApiKey).toBe('anthropic-secret');
  }

  it(
    'maps environment names to domain-facing properties',
    mapsEnvironmentNamesToDomainFacingProperties,
  );
}

describe('decodeLaunchEnvironment', describeDecodeLaunchEnvironment);
