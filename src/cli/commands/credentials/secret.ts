// Registers the commands that keep build secrets in the keychain instead of a plaintext file.

import type { Command } from '../../command.ts';
import { secretCommandProgram } from '../../../build/secret-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type SecretOptions = Readonly<{
  app?: string;
  profile?: string;
  value?: string;
  yes?: boolean;
}>;

/** Attach keychain-backed build-secret operations to Commander. */
export function registerSecretCommand(program: Command): void {
  function runSecret(action: string, name: string | undefined, commandOptions: SecretOptions) {
    if (action == 'set') {
      const secretProgram = secretCommandProgram({
        action,
        name,
        value: commandOptions.value,
        app: commandOptions.app,
        profile: commandOptions.profile,
        yes: commandOptions.yes == true,
      });

      return runCliProgram(secretProgram);
    }

    const secretProgram = secretCommandProgram({
      action,
      name,
      app: commandOptions.app,
      profile: commandOptions.profile,
    });

    return runCliProgram(secretProgram);
  }

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
    .action(runSecret);
}
