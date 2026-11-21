import { describe, expect, it } from 'vitest';
import { Redacted, Schema } from 'effect';
import { LaunchEnvironmentSchema } from './environment.js';
describe('LaunchEnvironmentSchema', () => {
  it('maps environment names to domain-facing properties and redacts secrets', () => {
    const environment = Schema.decodeUnknownSync(LaunchEnvironmentSchema)({
      ASC_ACCOUNT: 'personal',
      ANDROID_HOME: '/opt/android',
      ANTHROPIC_API_KEY: 'anthropic-secret',
      LAUNCH_S3_SECRET_ACCESS_KEY: 'storage-secret',
    });
    expect(environment.appleAccount).toBe('personal');
    expect(environment.androidSdkHome).toBe('/opt/android');
    expect(environment.anthropicApiKey).toBeDefined();
    expect(environment.s3SecretAccessKey).toBeDefined();
    if (environment.anthropicApiKey === undefined) return;
    if (environment.s3SecretAccessKey === undefined) return;
    expect(Redacted.value(environment.anthropicApiKey)).toBe('anthropic-secret');
    expect(Redacted.value(environment.s3SecretAccessKey)).toBe('storage-secret');
    expect(String(environment.anthropicApiKey)).toBe('<redacted>');
  });
});
