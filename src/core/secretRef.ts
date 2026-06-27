/**
 * Resolve a configured secret that may be an *indirection* instead of a literal value.
 *
 * Some config fields carry a genuinely sensitive value — e.g. the App Review `demoAccountPassword` — that
 * Launch's "secrets never touch the repo" rule says shouldn't sit in plaintext inside a repo-committed
 * `release.config.json` / `launch.config.ts`. This lets such a field name an indirection that's resolved
 * **at submit/apply time**, so a plan pass never reads, holds, or renders the secret:
 *
 * - `env:VAR_NAME`     → the value of `process.env.VAR_NAME` (errors if unset/empty).
 * - `keychain:ACCOUNT` → the OS-keychain secret stored under `ACCOUNT` via {@link getSecretStore} (errors if absent).
 * - any other string   → returned verbatim as a literal, so a plain password keeps working unchanged.
 *
 * The `secretStore` parameter is injectable purely so the keychain branch is unit-testable without
 * touching the real OS keychain; production callers omit it and get the host's store.
 */

import type { SecretStore } from './types.js';
import { getSecretStore } from './secretStore.js';

const ENV_PREFIX = 'env:';
const KEYCHAIN_PREFIX = 'keychain:';

/**
 * Resolve `value` to a concrete secret. `label` names the field in error messages (e.g.
 * `demoAccountPassword`) so a missing reference points the developer at what to fix.
 */
export async function resolveSecretRef(
  value: string,
  label = 'secret',
  secretStore?: SecretStore,
): Promise<string> {
  if (value.startsWith(ENV_PREFIX)) {
    const name = value.slice(ENV_PREFIX.length);
    if (name === '')
      throw new Error(
        `${label}: an \`env:\` reference needs a variable name (e.g. \`env:DEMO_PW\`).`,
      );
    const resolved = process.env[name];
    if (resolved === undefined || resolved === '') {
      throw new Error(
        `${label} references \`env:${name}\`, but the environment variable ${name} is not set.`,
      );
    }
    return resolved;
  }
  if (value.startsWith(KEYCHAIN_PREFIX)) {
    const account = value.slice(KEYCHAIN_PREFIX.length);
    if (account === '') {
      throw new Error(
        `${label}: a \`keychain:\` reference needs an account name (e.g. \`keychain:my-app-review\`).`,
      );
    }
    const resolved = await (secretStore ?? getSecretStore()).get(account);
    if (resolved === null || resolved === '') {
      throw new Error(
        `${label} references \`keychain:${account}\`, but no secret is stored under that account ` +
          `(store one with \`launch creds\`).`,
      );
    }
    return resolved;
  }
  return value;
}
