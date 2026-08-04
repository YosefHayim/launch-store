import type { Command } from 'commander';
import { setupCommandProgram } from '@core/config/setupCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type SetupOptions = Readonly<{
  platform?: string;
  yes: boolean;
  rehearse: boolean;
}>;

type SetupIosOptions = Readonly<{
  account?: string;
  app?: string;
  provision: boolean;
  json: boolean;
  yes: boolean;
}>;

export const registerSetupCommand = (program: Command): void => {
  const setupCommand = program
    .command('setup')
    .description("set Launch up automatically and verify everything's ready to ship")
    .option('--platform <p>', 'ios (default), android, tvos, macos, or visionos')
    .option('--yes', 'non-interactive: install missing tools without asking (CI/agents)', false)
    .option('--no-rehearse', 'skip the dry-run pipeline rehearsal at the end')
    .action((commandOptions: SetupOptions) =>
      runCliProgram(
        setupCommandProgram({
          operation: 'auto',
          platform: commandOptions.platform,
          yes: commandOptions.yes,
          rehearse: commandOptions.rehearse,
        }),
      ),
    );

  setupCommand
    .command('ios')
    .description(
      'report iOS signing & provisioning status (account, App ID, capabilities, cert, profile, devices)',
    )
    .option('--account <name>', 'Apple account to inspect (label or Key ID; default: active)')
    .option('-a, --app <name>', 'which app to inspect (default: the only app, or prompt)')
    .option(
      '--provision',
      "also ensure the distribution cert + App Store profile (like 'launch creds setup')",
      false,
    )
    .option('--json', 'emit the report as JSON (for agents/scripts)', false)
    .option(
      '--yes',
      'non-interactive: auto-confirm Apple resource creation under --provision',
      false,
    )
    .action((commandOptions: SetupIosOptions) =>
      runCliProgram(
        setupCommandProgram({
          operation: 'ios',
          account: commandOptions.account,
          app: commandOptions.app,
          provision: commandOptions.provision,
          json: commandOptions.json,
          yes: commandOptions.yes,
        }),
      ),
    );
};
