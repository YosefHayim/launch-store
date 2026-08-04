import type { Command } from 'commander';
import { secretCommandProgram } from '@core/build/secretCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type SecretOptions = Readonly<{
  app?: string;
  profile?: string;
  value?: string;
  yes?: boolean;
}>;

/** Attach keychain-backed build-secret operations to Commander. */
export const registerSecretCommand = (program: Command): void => {
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
    .action((action: string, name: string | undefined, commandOptions: SecretOptions) => {
      if (action === 'set') {
        return runCliProgram(
          secretCommandProgram({
            action,
            name,
            value: commandOptions.value,
            app: commandOptions.app,
            profile: commandOptions.profile,
            yes: commandOptions.yes === true,
          }),
        );
      }
      return runCliProgram(
        secretCommandProgram({
          action,
          name,
          app: commandOptions.app,
          profile: commandOptions.profile,
        }),
      );
    });
};
