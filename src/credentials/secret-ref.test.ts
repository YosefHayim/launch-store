import { afterEach, describe, expect, it } from 'vitest';
import { resetSecretStore, useSecretStore } from '../services/credentials/secret-store.ts';
import { resetLaunchEnvironment, useLaunchEnvironment } from '../services/platform/environment.ts';
import { readSecretRef } from './secret-ref.ts';

afterEach(function resetSecretFixtures() {
  resetLaunchEnvironment();
  resetSecretStore();
});

/** Read one test reference with explicit environment and secret-store capabilities. */
async function readTestReference(
  secretReference: string,
  environmentVariables: Readonly<Record<string, string | undefined>> = {},
  storedSecrets: Map<string, string> = new Map<string, string>(),
): Promise<string> {
  useLaunchEnvironment(environmentVariables);
  useSecretStore(storedSecrets);

  return readSecretRef(secretReference, 'demoAccountPassword');
}

function describeResolveSecretRef() {
  const environmentVariableName = 'LAUNCH_TEST_DEMO_PW';

  async function returnsALiteralPieceVerbatim() {
    const literalSecret = ['plain', 'demo', 'pw'].join('-');

    const testReference = await readTestReference(literalSecret);
    expect(testReference).toBe(literalSecret);
  }

  it('returns a literal value verbatim', returnsALiteralPieceVerbatim);

  async function resolvesAnEnvironmentReferenceFromTheEnvironmentService() {
    const environmentSecret = ['env', 'demo', 'pw'].join('-');

    const testReference = await readTestReference(`env:${environmentVariableName}`, {
      [environmentVariableName]: environmentSecret,
    });

    expect(testReference).toBe(environmentSecret);
  }

  it(
    'resolves an environment reference from the environment service',
    resolvesAnEnvironmentReferenceFromTheEnvironmentService,
  );

  async function failsWhenAnEnvironmentReferenceNamesAnUnsetVariable() {
    const testReference = readTestReference(`env:${environmentVariableName}`);

    await expect(testReference).rejects.toThrow(
      /environment variable LAUNCH_TEST_DEMO_PW is not set/,
    );
  }

  it(
    'fails when an environment reference names an unset variable',
    failsWhenAnEnvironmentReferenceNamesAnUnsetVariable,
  );

  async function failsWhenAnEnvironmentReferenceHasNoVariableName() {
    const testReference = readTestReference('env:');
    await expect(testReference).rejects.toMatchObject({
      message: expect.stringMatching(/needs a variable name/),
    });
  }

  it(
    'fails when an environment reference has no variable name',
    failsWhenAnEnvironmentReferenceHasNoVariableName,
  );

  async function resolvesAKeychainReferenceThroughTheSecretStoreService() {
    const keychainSecret = ['kc', 'demo', 'pw'].join('-');

    const testReference = await readTestReference(
      'keychain:my-app-review',
      {},
      new Map([['my-app-review', keychainSecret]]),
    );

    expect(testReference).toBe(keychainSecret);
  }

  it(
    'resolves a keychain reference through the secret-store service',
    resolvesAKeychainReferenceThroughTheSecretStoreService,
  );

  async function failsWhenAKeychainReferenceHasNoStoredSecret() {
    const testReference = readTestReference('keychain:absent');
    await expect(testReference).rejects.toMatchObject({
      message: expect.stringMatching(/no secret is stored under that account/),
    });
  }

  it(
    'fails when a keychain reference has no stored secret',
    failsWhenAKeychainReferenceHasNoStoredSecret,
  );
}

describe('readSecretRef', describeResolveSecretRef);
