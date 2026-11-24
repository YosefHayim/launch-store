// Turns an environment or keychain secret reference into the stored secret text.

import { LaunchSecretStore } from '../services/credentials/secret-store.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';

const ENV_PREFIX = 'env:';
const KEYCHAIN_PREFIX = 'keychain:';

/** Resolve `secretReference` to a concrete secret. */
export async function resolveSecretRef(secretReference: string, label = 'secret'): Promise<string> {
  const isEnvironmentReference = secretReference.startsWith(ENV_PREFIX);

  if (isEnvironmentReference) {
    return readEnvironmentSecret(secretReference, label);
  }

  const isKeychainReference = secretReference.startsWith(KEYCHAIN_PREFIX);

  if (isKeychainReference) {
    return readKeychainSecret(secretReference, label);
  }

  return secretReference;
}

async function readEnvironmentSecret(secretReference: string, label: string): Promise<string> {
  const name = secretReference.slice(ENV_PREFIX.length);

  const isNameMissing = name == '';

  if (isNameMissing) {
    throw new Error(
      `${label}: an \`env:\` reference needs a variable name (e.g. \`env:DEMO_PW\`).`,
    );
  }

  const resolvedSecret = readLaunchEnvironment().readSecret(name);

  const isUnset = resolvedSecret == null;

  if (isUnset) {
    throw new Error(
      `${label} references \`env:${name}\`, but the environment variable ${name} is not set.`,
    );
  }

  return resolvedSecret;
}

async function readKeychainSecret(secretReference: string, label: string): Promise<string> {
  const account = secretReference.slice(KEYCHAIN_PREFIX.length);

  const isAccountMissing = account == '';

  if (isAccountMissing) {
    throw new Error(
      `${label}: a \`keychain:\` reference needs an account name (e.g. \`keychain:my-app-review\`).`,
    );
  }

  const resolvedSecret = await new LaunchSecretStore().readSecret(account);

  const isMissing = resolvedSecret == null;

  if (isMissing) {
    return missingKeychainSecret(label, account);
  }

  const isEmpty = resolvedSecret == '';

  if (isEmpty) {
    return missingKeychainSecret(label, account);
  }

  return resolvedSecret;
}

function missingKeychainSecret(label: string, account: string): never {
  throw new Error(
    `${label} references \`keychain:${account}\`, but no secret is stored under that account ` +
      `(store one with \`launch-store creds\`).`,
  );
}
