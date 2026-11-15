import { describe, expect, it } from 'vitest';
import { Effect, Redacted } from 'effect';
import {
  LaunchEnvironment,
  LaunchEnvironmentTest,
  makeLaunchEnvironmentTest,
} from './environment.js';

describe('LaunchEnvironment service', () => {
  it('provides an empty stable test layer', async () => {
    const environment = await Effect.runPromise(
      LaunchEnvironment.pipe(Effect.provide(LaunchEnvironmentTest)),
    );
    expect(environment.values).toEqual({});
  });

  it('reads dynamic environment references as redacted values', async () => {
    const environment = await Effect.runPromise(
      LaunchEnvironment.pipe(
        Effect.provide(makeLaunchEnvironmentTest({ DEMO_PASSWORD: 'review-secret' })),
      ),
    );
    const secret = await Effect.runPromise(environment.readSecret('DEMO_PASSWORD'));
    expect(secret).toBeDefined();
    if (secret === undefined) return;
    expect(Redacted.value(secret)).toBe('review-secret');
    expect(await Effect.runPromise(environment.readSecret('MISSING_PASSWORD'))).toBeUndefined();
  });
});
