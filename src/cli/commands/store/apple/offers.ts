import type { Command } from '../../../command.ts';
import {
  type OffersDeactivateInput,
  type OffersGenerateCodesInput,
  type OffersListInput,
  type OffersReconcileInput,
  offersCommandProgram,
} from './offers-command.ts';
import { runCliProgram } from '../../../run-cli-program.ts';

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
function readOffersReconcile(commandOptions: OffersOptions): OffersReconcileInput {
  let offersInput: OffersReconcileInput = {
    operation: 'reconcile',
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) offersInput = { ...offersInput, app: commandOptions.app };

  return offersInput;
}

/** Map code-generation arguments without explicit undefined properties. */
function readOfferCodes(
  productId: string,
  offerName: string,
  commandOptions: GenerateCodesOptions,
): OffersGenerateCodesInput {
  let generateCodesInput: OffersGenerateCodesInput = {
    operation: 'generate-codes',
    productId,
    offerName,
    count: commandOptions.count,
  };

  if (commandOptions.app != null) {
    generateCodesInput = { ...generateCodesInput, app: commandOptions.app };
  }

  if (commandOptions.expires != null) {
    generateCodesInput = { ...generateCodesInput, expires: commandOptions.expires };
  }

  if (commandOptions.custom != null) {
    generateCodesInput = { ...generateCodesInput, custom: commandOptions.custom };
  }

  return generateCodesInput;
}

/** Map a list request without an explicit undefined app. */
function readOffersList(productId: string, commandOptions: AppScopedOptions): OffersListInput {
  let listInput: OffersListInput = { operation: 'list', productId };

  if (commandOptions.app != null) listInput = { ...listInput, app: commandOptions.app };

  return listInput;
}

/** Map a deactivate request without an explicit undefined app. */
function readOffersDeactivate(
  productId: string,
  offerName: string,
  commandOptions: AppScopedOptions,
): OffersDeactivateInput {
  let deactivateInput: OffersDeactivateInput = { operation: 'deactivate', productId, offerName };

  if (commandOptions.app != null) {
    deactivateInput = { ...deactivateInput, app: commandOptions.app };
  }

  return deactivateInput;
}

/** Attach offers reconciliation and offer-code operations. */
export function registerOffersCommand(program: Command): void {
  function runOffers(commandOptions: OffersOptions) {
    const offersReconcile = readOffersReconcile(commandOptions);
    const offersProgram = offersCommandProgram(offersReconcile);
    return runCliProgram(offersProgram);
  }

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
    .action(runOffers);

  function runGenerateCodesProductIdOfferName(
    productId: string,
    offerName: string,
    commandOptions: GenerateCodesOptions,
  ) {
    const generateCodes = readOfferCodes(productId, offerName, commandOptions);
    const offersProgram = offersCommandProgram(generateCodes);
    return runCliProgram(offersProgram);
  }

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
    .action(runGenerateCodesProductIdOfferName);

  function runListProductId(productId: string, commandOptions: AppScopedOptions) {
    const offersList = readOffersList(productId, commandOptions);
    const offersProgram = offersCommandProgram(offersList);
    return runCliProgram(offersProgram);
  }

  offersCommand
    .command('list <productId>')
    .description("list a subscription's offer-code campaigns and their states")
    .option('-a, --app <name>', 'app handle (default: the only app)')
    .action(runListProductId);

  function runDeactivateProductIdOfferName(
    productId: string,
    offerName: string,
    commandOptions: AppScopedOptions,
  ) {
    const offersDeactivate = readOffersDeactivate(productId, offerName, commandOptions);
    const offersProgram = offersCommandProgram(offersDeactivate);
    return runCliProgram(offersProgram);
  }

  offersCommand
    .command('deactivate <productId> <offerName>')
    .description("deactivate an offer-code campaign (its terms can't be edited, only switched off)")
    .option('-a, --app <name>', 'app handle (default: the only app)')
    .action(runDeactivateProductIdOfferName);
}
