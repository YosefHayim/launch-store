import type { Command } from 'commander';
import {
  type OffersDeactivateInput,
  type OffersGenerateCodesInput,
  type OffersListInput,
  type OffersReconcileInput,
  offersCommandProgram,
} from '@core/store/offersCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type OffersOptions = Readonly<{
  readonly app?: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

type AppScopedOptions = Readonly<{
  readonly app?: string;
}>;

type GenerateCodesOptions = AppScopedOptions &
  Readonly<{
    readonly count: string;
    readonly expires?: string;
    readonly custom?: string;
  }>;

/** Map the default offers command without explicit undefined properties. */
const toOffersReconcileInput = (commandOptions: OffersOptions): OffersReconcileInput => {
  let offersInput: OffersReconcileInput = {
    operation: 'reconcile',
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };
  if (commandOptions.app !== undefined) offersInput = { ...offersInput, app: commandOptions.app };
  return offersInput;
};

/** Map code-generation arguments without explicit undefined properties. */
const toGenerateCodesInput = (
  productId: string,
  offerName: string,
  commandOptions: GenerateCodesOptions,
): OffersGenerateCodesInput => {
  let generateCodesInput: OffersGenerateCodesInput = {
    operation: 'generate-codes',
    productId,
    offerName,
    count: commandOptions.count,
  };
  if (commandOptions.app !== undefined) {
    generateCodesInput = { ...generateCodesInput, app: commandOptions.app };
  }
  if (commandOptions.expires !== undefined) {
    generateCodesInput = { ...generateCodesInput, expires: commandOptions.expires };
  }
  if (commandOptions.custom !== undefined) {
    generateCodesInput = { ...generateCodesInput, custom: commandOptions.custom };
  }
  return generateCodesInput;
};

/** Map a list request without an explicit undefined app. */
const toOffersListInput = (
  productId: string,
  commandOptions: AppScopedOptions,
): OffersListInput => {
  let listInput: OffersListInput = { operation: 'list', productId };
  if (commandOptions.app !== undefined) listInput = { ...listInput, app: commandOptions.app };
  return listInput;
};

/** Map a deactivate request without an explicit undefined app. */
const toOffersDeactivateInput = (
  productId: string,
  offerName: string,
  commandOptions: AppScopedOptions,
): OffersDeactivateInput => {
  let deactivateInput: OffersDeactivateInput = { operation: 'deactivate', productId, offerName };
  if (commandOptions.app !== undefined) {
    deactivateInput = { ...deactivateInput, app: commandOptions.app };
  }
  return deactivateInput;
};

/** Attach offers reconciliation and offer-code operations. */
export const registerOffersCommand = (program: Command): void => {
  const offersCommand = program
    .command('offers')
    .description(
      'reconcile subscription offers (codes, promo/intro/win-back) and promoted-purchase order from config',
    )
    .option(
      '-a, --app <names>',
      'comma-separated app handles (default: all apps with offers declared)',
    )
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: OffersOptions) => {
      return runCliProgram(offersCommandProgram(toOffersReconcileInput(commandOptions)));
    });
  offersCommand
    .command('generate-codes <productId> <offerName>')
    .description('generate redeemable codes under an existing offer-code campaign')
    .option('-a, --app <name>', 'app handle (default: the only app)')
    .option('-n, --count <number>', 'how many codes to generate', '100')
    .option('-e, --expires <date>', 'expiration date (YYYY-MM-DD); required for one-time-use codes')
    .option(
      '--custom <code>',
      'create one shareable custom code with this value instead of one-time-use codes',
    )
    .action((productId: string, offerName: string, commandOptions: GenerateCodesOptions) => {
      return runCliProgram(
        offersCommandProgram(toGenerateCodesInput(productId, offerName, commandOptions)),
      );
    });
  offersCommand
    .command('list <productId>')
    .description("list a subscription's offer-code campaigns and their states")
    .option('-a, --app <name>', 'app handle (default: the only app)')
    .action((productId: string, commandOptions: AppScopedOptions) => {
      return runCliProgram(offersCommandProgram(toOffersListInput(productId, commandOptions)));
    });
  offersCommand
    .command('deactivate <productId> <offerName>')
    .description("deactivate an offer-code campaign (its terms can't be edited, only switched off)")
    .option('-a, --app <name>', 'app handle (default: the only app)')
    .action((productId: string, offerName: string, commandOptions: AppScopedOptions) => {
      return runCliProgram(
        offersCommandProgram(toOffersDeactivateInput(productId, offerName, commandOptions)),
      );
    });
};
