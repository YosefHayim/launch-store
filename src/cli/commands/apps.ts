import type { Command } from 'commander';
import { appsListProgram, appsTagProgram } from '@core/portfolio/appsCommand.js';
import { runCliProgram } from '../runCliProgram.js';

export const registerAppsCommand = (program: Command): void => {
  const apps = program
    .command('apps')
    .description('list the apps of every saved store account and tag them as yours or a client');
  apps
    .command('list')
    .description('list the apps of every saved App Store Connect account and the Play account')
    .option('--platform <platform>', 'only ios or android apps')
    .option('--owner <owner>', 'only apps tagged mine or client')
    .option('--json', 'output machine-readable JSON', false)
    .action((flags: { platform?: string; owner?: string; json?: boolean }) => {
      return runCliProgram(
        appsListProgram({
          platform: flags.platform,
          owner: flags.owner,
          isJson: flags.json === true,
        }),
      );
    });
  apps
    .command('tag')
    .description('tag apps as mine or client, and link their GA4 property')
    .option('--app <name>', 'the app name, bundle id or package name (part of it is enough)')
    .option('--account <label>', 'tag every app of this account')
    .option('--owner <owner>', 'mine or client')
    .option('--ga4-property <id>', 'the numeric GA4 property id')
    .option('--json', 'output machine-readable JSON', false)
    .action(
      (flags: {
        app?: string;
        account?: string;
        owner?: string;
        ga4Property?: string;
        json?: boolean;
      }) => {
        return runCliProgram(
          appsTagProgram({
            app: flags.app,
            account: flags.account,
            owner: flags.owner,
            ga4Property: flags.ga4Property,
            isJson: flags.json === true,
          }),
        );
      },
    );
};
