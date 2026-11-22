import { hasMessage } from '../../services/platform/error-message.ts';
import { createLogger } from '../../services/platform/logger.ts';
import type { ConvertedPrices, PlayMoneyUnits } from '../../types/play-pricing.ts';
import {
  loadActiveGoogleStore,
  resolveGoogleStoreApp,
} from '../../cli/commands/store/google/google-store-command.ts';

export type PlayPricingCommandInput = {
  amount: string;
  app?: string;
  currency: string;
  json: boolean;
};

/** Invalid price input supplied at the command boundary. */
type PlayPricingInputError = Readonly<{
  readonly _tag: 'PlayPricingInputError';
  readonly field: 'amount' | 'currency';
  readonly receivedValue: string;
  readonly message: string;
}>;

function makePlayPricingInputError(fields: {
  field: 'amount' | 'currency';
  receivedValue: string;
  message: string;
}): PlayPricingInputError {
  return { _tag: 'PlayPricingInputError', ...fields };
}

/** Configuration, credentials, conversion, or output failed. */
type PlayPricingExecutionError = Readonly<{
  readonly _tag: 'PlayPricingExecutionError';
  readonly stage: 'decode' | 'app' | 'credentials' | 'conversion' | 'output';
  readonly message: string;
  readonly cause?: unknown;
}>;

function makePlayPricingExecutionError(fields: {
  stage: PlayPricingExecutionError['stage'];
  message: string;
  cause?: unknown;
}): PlayPricingExecutionError {
  return { _tag: 'PlayPricingExecutionError', ...fields };
}

function failureMessage(cause: unknown, fallbackMessage: string): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause == 'string') {
    const isBlank = cause.length == 0;

    if (isBlank == false) {
      return cause;
    }
  }

  if (hasMessage(cause)) {
    return cause.message;
  }

  return fallbackMessage;
}

function pricingFailure(
  stage: PlayPricingExecutionError['stage'],
  fallbackMessage: string,
  cause: unknown,
): PlayPricingExecutionError {
  return makePlayPricingExecutionError({
    stage,
    message: failureMessage(cause, fallbackMessage),
    cause,
  });
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  return true;
}

function readRequiredString(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return field;
}

function readRequiredBoolean(record: Record<string, unknown>, fieldName: string): boolean {
  const field = record[fieldName];

  if (typeof field != 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return field;
}

function readExactOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
): string | null {
  if (fieldName in record == false) {
    return null;
  }

  const field = record[fieldName];

  if (typeof field != 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  return field;
}

function decodePlayPricingCommandInput(rawCommandInput: unknown): PlayPricingCommandInput {
  if (isRecord(rawCommandInput) == false) {
    throw new Error('Play pricing command input must be an object.');
  }

  const commandInput: PlayPricingCommandInput = {
    amount: readRequiredString(rawCommandInput, 'amount'),
    currency: readRequiredString(rawCommandInput, 'currency'),
    json: readRequiredBoolean(rawCommandInput, 'json'),
  };
  const appName = readExactOptionalString(rawCommandInput, 'app');

  if (appName != null) {
    commandInput.app = appName;
  }

  return commandInput;
}

export const PlayPricingCommandInputSchema = decodePlayPricingCommandInput;

function isZeroPlayAmount(units: string, nanos: number): boolean {
  if (units != '0') {
    return false;
  }

  return nanos == 0;
}

/** Parse a positive decimal amount and ISO currency into Play money units. */
export function parsePlayPrice(amountText: string, currencyText: string): PlayMoneyUnits {
  const currencyCode = currencyText.trim().toUpperCase();
  const currencyIsValid = /^[A-Za-z]{3}$/.test(currencyCode);

  if (currencyIsValid == false) {
    throw makePlayPricingInputError({
      field: 'currency',
      receivedValue: currencyText,
      message: `--currency must be a 3-letter ISO code (got "${currencyText}").`,
    });
  }

  const decimalAmount = amountText.trim();
  const amountIsValid = /^\d+(\.\d{1,9})?$/.test(decimalAmount);

  if (amountIsValid == false) {
    throw makePlayPricingInputError({
      field: 'amount',
      receivedValue: amountText,
      message: `<amount> must be a non-negative decimal with up to 9 places (got "${amountText}").`,
    });
  }

  const decimalSegments = decimalAmount.split('.');
  let wholeDigits = '0';
  let fractionalDigits = '';
  const declaredWholeDigits = decimalSegments[0];
  const declaredFractionalDigits = decimalSegments[1];

  if (declaredWholeDigits != null) {
    wholeDigits = declaredWholeDigits;
  }

  if (declaredFractionalDigits != null) {
    fractionalDigits = declaredFractionalDigits;
  }

  const units = BigInt(wholeDigits).toString();
  const nanos = Number(fractionalDigits.padEnd(9, '0'));
  const isZeroMoney = isZeroPlayAmount(units, nanos);

  if (isZeroMoney) {
    throw makePlayPricingInputError({
      field: 'amount',
      receivedValue: amountText,
      message: '<amount> must be greater than zero.',
    });
  }

  return { currencyCode, units, nanos };
}

/** Render Play money without trailing fractional zeroes. */
export function formatPlayMoney(playMoney: PlayMoneyUnits): string {
  if (playMoney.nanos == 0) {
    return `${playMoney.currencyCode} ${playMoney.units}`;
  }

  // Drop trailing zeroes, then keep at least two fractional digits.
  let fractionalDigits = String(playMoney.nanos).padStart(9, '0').replace(/0+$/, '');
  const needsTwoDigits = fractionalDigits.length < 2;

  if (needsTwoDigits) {
    fractionalDigits = fractionalDigits.padEnd(2, '0');
  }

  return `${playMoney.currencyCode} ${playMoney.units}.${fractionalDigits}`;
}

/** Render the human table for one regional conversion. */
export function renderRecommendedPrices(
  basePrice: PlayMoneyUnits,
  convertedPrices: ConvertedPrices,
): string {
  const basePriceText = formatPlayMoney(basePrice);
  const heading = `\nRecommended prices for base ${basePriceText}  (${convertedPrices.regions.length} regions)`;
  const hasNoRegions = convertedPrices.regions.length == 0;

  if (hasNoRegions) {
    return `${heading}\n  (Play returned no regional prices)`;
  }

  const priceLines: string[] = [];

  for (const regionPrice of convertedPrices.regions) {
    const priceText = formatPlayMoney(regionPrice.price);
    priceLines.push(`  ${regionPrice.regionCode.padEnd(4)}${priceText}`);
  }

  const fallbackLines: string[] = [];

  if (convertedPrices.otherRegions != null) {
    const usdPriceText = formatPlayMoney(convertedPrices.otherRegions.usdPrice);
    const eurPriceText = formatPlayMoney(convertedPrices.otherRegions.eurPrice);
    fallbackLines.push(
      '\n  Other regions (no local currency):',
      `    ${usdPriceText}`,
      `    ${eurPriceText}`,
    );
  }

  return [heading, ...priceLines, ...fallbackLines].join('\n');
}

/** Decode, convert, and render one Play pricing request. */
export async function playPricingCommandProgram(rawCommandInput: unknown): Promise<void> {
  let commandInput: PlayPricingCommandInput;

  try {
    commandInput = decodePlayPricingCommandInput(rawCommandInput);
  } catch (cause) {
    throw pricingFailure('decode', 'Could not decode the Play pricing command input.', cause);
  }

  const basePrice = parsePlayPrice(commandInput.amount, commandInput.currency);
  let packageName = '';
  let appName = '';

  try {
    const selectedApp = await resolveGoogleStoreApp(commandInput.app);
    packageName = selectedApp.packageName;
    appName = selectedApp.appName;
  } catch (cause) {
    throw pricingFailure('app', 'Could not select an app.', cause);
  }

  let googleStore: Awaited<ReturnType<typeof loadActiveGoogleStore>>;

  try {
    googleStore = await loadActiveGoogleStore(packageName, appName);
  } catch (cause) {
    throw pricingFailure(
      'credentials',
      failureMessage(cause, 'Could not load Play credentials.'),
      cause,
    );
  }

  let convertedPrices: ConvertedPrices;

  try {
    convertedPrices = await googleStore.convertRegionPrices(packageName, basePrice);
  } catch (cause) {
    throw pricingFailure('conversion', 'Google Play could not convert the base price.', cause);
  }

  const logger = createLogger(false);

  if (commandInput.json) {
    logger.line(JSON.stringify(convertedPrices, null, 2));
    return;
  }

  logger.line(renderRecommendedPrices(basePrice, convertedPrices));
}
