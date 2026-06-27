/**
 * `launch secret [list|set|rm]` — manage keychain-backed build secrets, the secure alternative to
 * putting real secrets in a plaintext `.env`.
 *
 * Values are stored in the OS secret store (the same place the App Store Connect `.p8` lives), keyed
 * by app and optional profile; only their names + scope are recorded on disk. At build time the
 * pipeline injects them into the build env, where they win over `.env` (see `core/buildSecrets.ts`).
 * `set` accepts `--value` (or prompts, masked) and runs non-interactively from flags for CI/agents.
 */

import type { Command } from 'commander';
import { cancel, isCancel, password } from '@clack/prompts';
import { loadConfig } from '../../core/config.js';
import { selectApp } from '../../core/pipeline.js';
import {
  listSecretRefs,
  removeBuildSecret,
  setBuildSecret,
  type SecretRef,
} from '../../core/buildSecrets.js';

/** Options for the `secret` subcommands, from flags and/or env. */
interface SecretOptions {
  /** App handle to scope the secret to (else the sole discovered app, or a prompt). */
  app?: string;
  /** Profile to scope the secret to. Omitted = app-wide (injected into every profile's build). */
  profile?: string;
  /** The secret value for `set` (else a masked prompt; required when non-interactive). */
  value?: string;
  /** Non-interactive: fail (with the flag to set) instead of prompting. For CI, remote, agents. */
  yes?: boolean;
}

/** A valid environment variable name: a letter/underscore, then letters, digits, or underscores. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Resolve the app handle to scope a secret to: an explicit `--app`, the sole app, or a prompt. */
async function resolveApp(options: SecretOptions): Promise<string> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, options.app);
  return app.name;
}

/** Prompt for a required secret (masked, never trimmed), exiting cleanly if the user cancels. */
async function askValue(name: string): Promise<string> {
  const value = await password({
    message: `Value for ${name}`,
    validate: (v) => (v === '' ? 'Required.' : undefined),
  });
  if (isCancel(value)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  return value;
}

/** Store (or overwrite) a build secret, scoped to the resolved app and optional profile. */
async function setSecretValue(name: string | undefined, options: SecretOptions): Promise<void> {
  if (!name)
    throw new Error(
      'Usage: launch secret set <NAME> [--value <v>] [--app <app>] [--profile <profile>].',
    );
  if (!ENV_NAME.test(name))
    throw new Error(`"${name}" is not a valid env var name (letters, digits, underscores).`);
  const app = await resolveApp(options);
  const canPrompt = options.yes !== true && process.stdin.isTTY;
  let value = options.value;
  if (value === undefined) {
    if (!canPrompt)
      throw new Error('A value is required. Pass --value <v> (or run in an interactive terminal).');
    value = await askValue(name);
  }
  const ref: SecretRef = { app, profile: options.profile ?? null, name };
  await setBuildSecret(ref, value);
  console.log(
    `Stored ${name} for ${app}${ref.profile ? ` · profile ${ref.profile}` : ' (all profiles)'} in the keychain.`,
  );
}

/** Remove a build secret by name, scoped to the resolved app and optional profile. */
async function removeSecretValue(name: string | undefined, options: SecretOptions): Promise<void> {
  if (!name) throw new Error('Usage: launch secret rm <NAME> [--app <app>] [--profile <profile>].');
  const app = await resolveApp(options);
  const ref: SecretRef = { app, profile: options.profile ?? null, name };
  const existed = await removeBuildSecret(ref);
  console.log(
    existed
      ? `Removed ${name} for ${app}${ref.profile ? ` · profile ${ref.profile}` : ' (all profiles)'}.`
      : `No secret ${name} for ${app}${ref.profile ? ` · profile ${ref.profile}` : ' (all profiles)'}.`,
  );
}

/** The scope label for one secret in the listing: app-wide, or a specific profile. */
function scopeLabel(ref: SecretRef): string {
  return ref.profile ? `profile ${ref.profile}` : 'all profiles';
}

/** List recorded build secrets (names + scope only; values are never printed), optionally for one app. */
function listSecrets(options: SecretOptions): void {
  const refs = listSecretRefs(options.app);
  if (refs.length === 0) {
    console.log(
      options.app
        ? `No build secrets for ${options.app}. Add one with: launch secret set <NAME> --app ${options.app}`
        : 'No build secrets stored. Add one with: launch secret set <NAME>',
    );
    return;
  }
  for (const ref of refs) {
    console.log(`• ${ref.app} · ${ref.name}  ••••••  (${scopeLabel(ref)})`);
  }
}

/** Attach the `secret` command to the program. */
export function registerSecretCommand(program: Command): void {
  program
    .command('secret')
    .alias('env')
    .description('manage keychain-backed build secrets (set/list/rm) instead of plaintext .env')
    .argument('[action]', 'list (default) | set | rm', 'list')
    .argument('[name]', "the secret's env var name (set/rm)")
    .option('-a, --app <name>', 'app to scope the secret to (default: the sole app, or prompt)')
    .option('-p, --profile <name>', 'profile to scope to (default: all profiles)')
    .option(
      '--value <value>',
      'set: the secret value (else prompted; required when non-interactive)',
    )
    .option('--yes', 'non-interactive: fail instead of prompting (CI, remote, agents)')
    .action(async (action: string, name: string | undefined, options: SecretOptions) => {
      switch (action) {
        case 'list':
        case 'status':
          listSecrets(options);
          return;
        case 'set':
          await setSecretValue(name, options);
          return;
        case 'rm':
        case 'remove':
          await removeSecretValue(name, options);
          return;
        default:
          throw new Error(`Unknown action "${action}". Use list, set, or rm.`);
      }
    });
}
