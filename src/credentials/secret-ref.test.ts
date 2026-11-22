import { afterEach, describe, expect, it } from 'vitest';
import { resetSecretStore, useSecretStore } from '../services/credentials/secret-store.ts';
import { resetLaunchEnvironment, useLaunchEnvironment } from '../services/platform/environment.ts';
import { resolveSecretRef } from './secret-ref.ts';

afterEach(function resetSecretFixtures() {
  resetLaunchEnvironment();
  resetSecretStore();
});

/** Resolve one test reference with explicit environment and secret-store capabilities. */
async function resolveTestReference(
  secretReference: string,
  environmentVariables: Readonly<Record<string, string | undefined>> = {},
  storedSecrets: Map<string, string> = new Map<string, string>(),
): Promise<string> {
  useLaunchEnvironment(environmentVariables);
  useSecretStore(storedSecrets);

  return resolveSecretRef(secretReference, 'demoAccountPassword');
}

describe('resolveSecretRef', () => {
  const environmentVariableName = 'LAUNCH_TEST_DEMO_PW';

  it('returns a literal value verbatim', async () => {
    const literalSecret = ['plain', 'demo', 'pw'].join('-');

    const testReference = await resolveTestReference(literalSecret);
    expect(testReference).toBe(literalSecret);
  });

  it('resolves an environment reference from the environment service', async () => {
    const environmentSecret = ['env', 'demo', 'pw'].join('-');

    const testReference = await resolveTestReference(`env:${environmentVariableName}`, {
      [environmentVariableName]: environmentSecret,
    });
    expect(testReference).toBe(environmentSecret);
  });

  it('fails when an environment reference names an unset variable', async () => {
    const testReference = resolveTestReference(`env:${environmentVariableName}`);
    await expect(testReference).rejects.toMatchObject({
      _tag: 'SecretReferenceFailure',
      message: expect.stringMatching(/environment variable LAUNCH_TEST_DEMO_PW is not set/),
    });
  });

  it('fails when an environment reference has no variable name', async () => {
    const testReference = resolveTestReference('env:');
    await expect(testReference).rejects.toMatchObject({
      message: expect.stringMatching(/needs a variable name/),
    });
  });

  it('resolves a keychain reference through the secret-store service', async () => {
    const keychainSecret = ['kc', 'demo', 'pw'].join('-');

    const testReference = await resolveTestReference(
      'keychain:my-app-review',
      {},
      new Map([['my-app-review', keychainSecret]]),
    );
    expect(testReference).toBe(keychainSecret);
  });

  it('fails when a keychain reference has no stored secret', async () => {
    const testReference = resolveTestReference('keychain:absent');
    await expect(testReference).rejects.toMatchObject({
      message: expect.stringMatching(/no secret is stored under that account/),
    });
  });
});
