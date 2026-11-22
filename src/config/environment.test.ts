import { describe, expect, it } from 'vitest';
import { decodeLaunchEnvironment } from './environment.ts';

describe('decodeLaunchEnvironment', () => {
  it('maps environment names to domain-facing properties', () => {
    const environment = decodeLaunchEnvironment({
      ASC_ACCOUNT: 'personal',
      ANDROID_HOME: '/opt/android',
      ANTHROPIC_API_KEY: 'anthropic-secret',
      LAUNCH_S3_SECRET_ACCESS_KEY: 'storage-secret',
    });

    expect(environment.appleAccount).toBe('personal');
    expect(environment.androidSdkHome).toBe('/opt/android');
    expect(environment.anthropicApiKey).toBe('anthropic-secret');
    expect(environment.s3SecretAccessKey).toBe('storage-secret');
  });
});
