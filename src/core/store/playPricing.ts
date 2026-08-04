import { Data, Effect, Schema } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import type { ConvertedPrices, PlayMoneyUnits } from '../types/playPricing.js';
import {
  loadActiveGoogleStore,
  type ActiveGoogleStoreRequirements,
  resolveGoogleStorePackageName,
} from './googleStoreCommand.js';
import type { StoreAppSelectionRequirements } from './selectStoreApp.js';

export const PlayPricingCommandInputSchema = Schema.Struct({
  amount: Schema.String,
  app: Schema.optionalWith(Schema.String, { exact: true }),
  currency: Schema.String,
  json: Schema.Boolean,
});

export type PlayPricingCommandInput = Schema.Schema.Type<typeof PlayPricingCommandInputSchema>;

/** Invalid price input supplied at the command boundary. */
export type PlayPricingInputError = Readonly<{
  readonly _tag: 'PlayPricingInputError';
  readonly field: 'amount' | 'currency';
  readonly receivedValue: string;
  readonly message: string;
}>;
export const makePlayPricingInputError =
  Data.tagged<PlayPricingInputError>('PlayPricingInputError');

/** Configuration, credentials, conversion, or output failed. */
export type PlayPricingExecutionError = Readonly<{
  readonly _tag: 'PlayPricingExecutionError';
  readonly stage: 'decode' | 'app' | 'credentials' | 'conversion' | 'output';
  readonly message: string;
  readonly cause?: unknown;
}>;
export const makePlayPricingExecutionError = Data.tagged<PlayPricingExecutionError>(
  'PlayPricingExecutionError',
);

type PlayPricingCommandRequirements =
  | ActiveGoogleStoreRequirements
  | Logger
  | StoreAppSelectionRequirements;

const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const AMOUNT_PATTERN = /^\d+(\.\d{1,9})?$/;

/** Convert an unknown failure into stable human-readable text. */
const failureMessage = (cause: unknown, fallbackMessage: string): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string' && cause.length > 0) return cause;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') return causeMessage;
  }
  return fallbackMessage;
};

/** Convert a command dependency failure into the pricing channel. */
const pricingFailure = (
  stage: PlayPricingExecutionError['stage'],
  fallbackMessage: string,
  cause: unknown,
): PlayPricingExecutionError =>
  makePlayPricingExecutionError({
    stage,
    message: failureMessage(cause, fallbackMessage),
    cause,
  });

/** Parse a positive decimal amount and ISO currency into Play money units. */
export const parsePlayPrice = (
  amountText: string,
  currencyText: string,
): Effect.Effect<PlayMoneyUnits, PlayPricingInputError> =>
  Effect.gen(function* () {
    const currencyCode = currencyText.trim().toUpperCase();
    if (!CURRENCY_PATTERN.test(currencyCode)) {
      return yield* Effect.fail(
        makePlayPricingInputError({
          field: 'currency',
          receivedValue: currencyText,
          message: `--currency must be a 3-letter ISO code (got "${currencyText}").`,
        }),
      );
    }
    const decimalAmount = amountText.trim();
    if (!AMOUNT_PATTERN.test(decimalAmount)) {
      return yield* Effect.fail(
        makePlayPricingInputError({
          field: 'amount',
          receivedValue: amountText,
          message: `<amount> must be a non-negative decimal with up to 9 places (got "${amountText}").`,
        }),
      );
    }
    const decimalSegments = decimalAmount.split('.');
    let wholeDigits = '0';
    let fractionalDigits = '';
    const declaredWholeDigits = decimalSegments[0];
    const declaredFractionalDigits = decimalSegments[1];
    if (declaredWholeDigits !== undefined) wholeDigits = declaredWholeDigits;
    if (declaredFractionalDigits !== undefined) fractionalDigits = declaredFractionalDigits;
    const units = BigInt(wholeDigits).toString();
    const nanos = Number(fractionalDigits.padEnd(9, '0'));
    if (units === '0' && nanos === 0) {
      return yield* Effect.fail(
        makePlayPricingInputError({
          field: 'amount',
          receivedValue: amountText,
          message: '<amount> must be greater than zero.',
        }),
      );
    }
    return { currencyCode, units, nanos };
  });

/** Render Play money without trailing fractional zeroes. */
export const formatPlayMoney = (playMoney: PlayMoneyUnits): Effect.Effect<string> =>
  Effect.sync(() => {
    if (playMoney.nanos === 0) return `${playMoney.currencyCode} ${playMoney.units}`;
    let fractionalDigits = String(playMoney.nanos).padStart(9, '0').replace(/0+$/, '');
    if (fractionalDigits.length < 2) fractionalDigits = fractionalDigits.padEnd(2, '0');
    return `${playMoney.currencyCode} ${playMoney.units}.${fractionalDigits}`;
  });

/** Render the human table for one regional conversion. */
export const renderRecommendedPrices = (
  basePrice: PlayMoneyUnits,
  convertedPrices: ConvertedPrices,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const basePriceText = yield* formatPlayMoney(basePrice);
    const heading = `\nRecommended prices for base ${basePriceText}  (${convertedPrices.regions.length} regions)`;
    if (convertedPrices.regions.length === 0) {
      return `${heading}\n  (Play returned no regional prices)`;
    }
    const priceLines: string[] = [];
    for (const regionPrice of convertedPrices.regions) {
      const priceText = yield* formatPlayMoney(regionPrice.price);
      priceLines.push(`  ${regionPrice.regionCode.padEnd(4)}${priceText}`);
    }
    const fallbackLines: string[] = [];
    if (convertedPrices.otherRegions !== undefined) {
      const usdPriceText = yield* formatPlayMoney(convertedPrices.otherRegions.usdPrice);
      const eurPriceText = yield* formatPlayMoney(convertedPrices.otherRegions.eurPrice);
      fallbackLines.push(
        '\n  Other regions (no local currency):',
        `    ${usdPriceText}`,
        `    ${eurPriceText}`,
      );
    }
    return [heading, ...priceLines, ...fallbackLines].join('\n');
  });

/** Decode, convert, and render one Play pricing request. */
export const playPricingCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<
  void,
  PlayPricingInputError | PlayPricingExecutionError,
  PlayPricingCommandRequirements
> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(PlayPricingCommandInputSchema)(
      rawCommandInput,
    ).pipe(
      Effect.mapError((cause) =>
        pricingFailure('decode', 'Could not decode the Play pricing command input.', cause),
      ),
    );
    const basePrice = yield* parsePlayPrice(commandInput.amount, commandInput.currency);
    const packageName = yield* resolveGoogleStorePackageName(commandInput.app).pipe(
      Effect.mapError((cause) => pricingFailure('app', 'Could not select an app.', cause)),
    );
    const googleStore = yield* loadActiveGoogleStore().pipe(
      Effect.mapError((cause) =>
        pricingFailure('credentials', 'Could not load the Play service account.', cause),
      ),
    );
    const convertedPrices = yield* googleStore
      .convertRegionPrices(packageName, basePrice)
      .pipe(
        Effect.mapError((cause) =>
          pricingFailure('conversion', 'Google Play could not convert the base price.', cause),
        ),
      );
    const logger = yield* createLogger(false);
    if (commandInput.json) {
      yield* logger
        .line(JSON.stringify(convertedPrices, null, 2))
        .pipe(
          Effect.mapError((cause) =>
            pricingFailure('output', 'Could not write pricing JSON.', cause),
          ),
        );
      return;
    }
    const priceTable = yield* renderRecommendedPrices(basePrice, convertedPrices);
    yield* logger
      .line(priceTable)
      .pipe(
        Effect.mapError((cause) =>
          pricingFailure('output', 'Could not write pricing output.', cause),
        ),
      );
  });
