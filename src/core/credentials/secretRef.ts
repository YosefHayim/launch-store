import { Data, Effect, Redacted } from 'effect';
import { LaunchEnvironment, type LaunchEnvironmentService } from '../services/environment.js';
import { LaunchSecretStore, type LaunchSecretStoreService } from '../services/secretStore.js';
const ENV_PREFIX = 'env:';
const KEYCHAIN_PREFIX = 'keychain:';
/**
 * Resolve `value` to a concrete secret. `label` names the field in error messages (e.g.
 * `demoAccountPassword`) so a missing reference points the developer at what to fix.
 */
export type SecretReferenceFailure = Readonly<{
  readonly _tag: 'SecretReferenceFailure';
  readonly message: string;
}>;
export const makeSecretReferenceFailure =
  Data.tagged<SecretReferenceFailure>('SecretReferenceFailure');
export const resolveSecretRef = (
  secretReference: string,
  label = 'secret',
  secretStore?: LaunchSecretStoreService,
): Effect.Effect<string, unknown, LaunchEnvironmentService | LaunchSecretStoreService> =>
  Effect.gen(function* () {
    if (secretReference.startsWith(ENV_PREFIX)) {
      const name = secretReference.slice(ENV_PREFIX.length);
      if (name === '')
        return yield* Effect.fail(
          makeSecretReferenceFailure({
            message: `${label}: an \`env:\` reference needs a variable name (e.g. \`env:DEMO_PW\`).`,
          }),
        );
      const environment = yield* LaunchEnvironment;
      const resolvedSecret = yield* environment.readSecret(name);
      if (resolvedSecret === undefined) {
        return yield* Effect.fail(
          makeSecretReferenceFailure({
            message: `${label} references \`env:${name}\`, but the environment variable ${name} is not set.`,
          }),
        );
      }
      return Redacted.value(resolvedSecret);
    }
    if (secretReference.startsWith(KEYCHAIN_PREFIX)) {
      const account = secretReference.slice(KEYCHAIN_PREFIX.length);
      if (account === '') {
        return yield* Effect.fail(
          makeSecretReferenceFailure({
            message: `${label}: a \`keychain:\` reference needs an account name (e.g. \`keychain:my-app-review\`).`,
          }),
        );
      }
      let selectedSecretStore = secretStore;
      if (selectedSecretStore === undefined) selectedSecretStore = yield* LaunchSecretStore;
      const resolvedSecret = yield* selectedSecretStore.readSecret(account);
      if (resolvedSecret === null) {
        return yield* Effect.fail(
          makeSecretReferenceFailure({
            message:
              `${label} references \`keychain:${account}\`, but no secret is stored under that account ` +
              `(store one with \`launch creds\`).`,
          }),
        );
      }
      if (resolvedSecret === '') {
        return yield* Effect.fail(
          makeSecretReferenceFailure({
            message:
              `${label} references \`keychain:${account}\`, but no secret is stored under that account ` +
              `(store one with \`launch creds\`).`,
          }),
        );
      }
      return resolvedSecret;
    }
    return secretReference;
  });
