/**
 * `launch play-pricing localize` — turn one base price into Google's **recommended local price for every
 * Play market**, via the Play Developer API's `monetization.convertRegionPrices` (today's exchange rate +
 * Google's per-country pricing patterns). The Android counterpart to the App Store price-point lookups
 * Launch already does, and a sibling of `launch play-reports vitals` (read-only, Play-service-account
 * only). Advisory: it computes a recommendation and changes nothing live — to apply the numbers, feed
 * them into `launch play-products` / `launch play-subscriptions`.
 *
 * Thin glue over {@link GooglePlayClient.convertRegionPrices}: this file parses the base price, resolves
 * the app + Play account, calls the client, and renders the table. The conversion + normalization live in
 * the client.
 */

import type { Command } from 'commander';
import { GooglePlayClient, parseServiceAccount } from '../../google/playClient.js';
import type { ConvertedPrices, PlayMoneyUnits } from '../../google/playClient.js';
import { loadServiceAccount } from '../../google/credentials.js';
import { loadConfig } from '../../core/config.js';
import { selectApp } from '../../core/pipeline.js';

/** Options for `play-pricing localize`. */
interface PricingOptions {
  app?: string;
  currency?: string;
  json?: boolean;
}

/** ISO-4217 currency code: exactly three ASCII letters. */
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
/** A non-negative decimal with at most 9 fractional digits (the `nanos` precision Money allows). */
const AMOUNT_PATTERN = /^\d+(\.\d{1,9})?$/;

/** Build a Play client bound to the stored service account, or fail with the onboarding hint. */
async function activeClient(): Promise<GooglePlayClient> {
  const json = await loadServiceAccount();
  if (!json)
    throw new Error(
      'No Play service account. Run `launch creds set-key --platform android` first.',
    );
  return new GooglePlayClient(parseServiceAccount(json));
}

/** Resolve the selected app's Play package name, erroring when the app has none. */
async function resolvePackageName(appSelector: string | undefined): Promise<string> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, appSelector);
  if (!app.packageName) {
    throw new Error(`No Android application id for ${app.name} (set android.package in app.json).`);
  }
  return app.packageName;
}

/**
 * Parse a human base price (`amount` + ISO `currency`) into Google's `Money` shape. The amount is a
 * decimal string (e.g. `4.99`); its fractional part becomes `nanos` (billionths), so at most 9 decimal
 * places are accepted. Rejects malformed, over-precise, or non-positive input at the CLI boundary —
 * `convertRegionPrices` needs a real positive price to convert. Exported for tests.
 */
export function parsePrice(amount: string, currency: string): PlayMoneyUnits {
  const code = currency.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(code)) {
    throw new Error(`--currency must be a 3-letter ISO code (got "${currency}").`);
  }
  const trimmed = amount.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) {
    throw new Error(
      `<amount> must be a non-negative decimal with up to 9 places (got "${amount}").`,
    );
  }
  const [whole = '0', fraction = ''] = trimmed.split('.'); // AMOUNT_PATTERN guarantees a whole part
  const units = BigInt(whole).toString(); // strips leading zeros: "007" → "7"
  const nanos = Number(fraction.padEnd(9, '0'));
  if (units === '0' && nanos === 0) {
    throw new Error('<amount> must be greater than zero.');
  }
  return { currencyCode: code, units, nanos };
}

/**
 * Render a `Money` as `CODE amount` (e.g. `USD 4.99`), dropping the fraction when it's zero (so
 * zero-decimal currencies read as `JPY 600`, not `JPY 600.00`). Exported for tests.
 */
export function formatMoney({ currencyCode, units, nanos }: PlayMoneyUnits): string {
  if (nanos === 0) return `${currencyCode} ${units}`;
  let fraction = String(nanos).padStart(9, '0').replace(/0+$/, '');
  if (fraction.length < 2) fraction = fraction.padEnd(2, '0'); // 5 → 50, so 4.5 reads as 4.50
  return `${currencyCode} ${units}.${fraction}`;
}

/** Render the converted prices as an aligned `region  price` table, with the USD/EUR fallback footer. */
function renderPrices(base: PlayMoneyUnits, converted: ConvertedPrices): string {
  const header = `\nRecommended prices for base ${formatMoney(base)}  (${converted.regions.length} regions)`;
  if (converted.regions.length === 0) {
    return `${header}\n  (Play returned no regional prices)`;
  }
  const lines = converted.regions.map(
    (region) => `  ${region.regionCode.padEnd(4)}${formatMoney(region.price)}`,
  );
  const footer = converted.otherRegions
    ? [
        '\n  Other regions (no local currency):',
        `    ${formatMoney(converted.otherRegions.usdPrice)}`,
        `    ${formatMoney(converted.otherRegions.eurPrice)}`,
      ]
    : [];
  return [header, ...lines, ...footer].join('\n');
}

/** Attach the `play-pricing` command (with the `localize` subcommand) to the program. */
export function registerPlayPricingCommand(program: Command): void {
  const pricing = program
    .command('play-pricing')
    .description('compute recommended Google Play prices for every region from one base price');

  pricing
    .command('localize <amount>')
    .description("show Google's recommended local price for every Play market, from one base price")
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('-c, --currency <code>', 'ISO-4217 currency of <amount>', 'USD')
    .option('--json', 'output machine-readable JSON', false)
    .action(async (amount: string, options: PricingOptions) => {
      const price = parsePrice(amount, options.currency ?? 'USD');
      const packageName = await resolvePackageName(options.app);
      const client = await activeClient();

      const converted = await client.convertRegionPrices(packageName, price);

      if (options.json) {
        console.log(JSON.stringify(converted, null, 2));
        return;
      }
      console.log(renderPrices(price, converted));
    });
}
