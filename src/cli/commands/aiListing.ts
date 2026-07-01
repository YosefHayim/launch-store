/**
 * `launch ai listing` — draft App Store / Play listing copy with a model and write it into the app's
 * `store.config.json`. It never touches a store: the draft lands in the same versioned file
 * `launch metadata` reads, so the user reviews the diff with `launch plan` and applies it with
 * `launch sync` / `launch metadata push`. That existing plan→confirm→apply loop is the safety rail —
 * this command only fills the file, gated by one local confirmation.
 *
 * Thin glue: the prompt/parse live in `core/listing/generator.ts`, the clamp/merge/preview in
 * `core/listing/apply.ts`. This file resolves the app, drives the generator per locale, prints the
 * preview, and writes on confirmation.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { aiGroup, confirmWrite } from './ai.js';
import { asRecord } from '../../core/json.js';
import { loadConfig, readResolvedConfig } from '../../core/config.js';
import { selectApp } from '../../core/pipeline.js';
import { createLogger } from '../../core/logger.js';
import { loadStoreConfig, serializeStoreConfig, type StoreConfig } from '../../core/storeConfig.js';
import { applyDraft, briefFor, clampDraft, renderDraftPreview } from '../../core/listing/apply.js';
import { createAnthropicListingGenerator } from '../../core/listing/generator.js';
import type { AppDescriptor } from '../../core/types.js';
import type { ListingGenerator, LocaleDraft } from '../../core/listing/types.js';

/** Options for `launch ai listing`. */
export interface AiListingInput {
  /** App handle; auto-selected when the repo has a single app. */
  app?: string;
  /** Comma-separated locales; defaults to the existing App Store locales, else `en-US`. */
  locale?: string;
  /** A short description of the app to seed the copy, overriding the existing listing as the seed. */
  about?: string;
  /** Which store(s) to draft for: `ios` (default), `android`, or `all`. */
  platform?: string;
  /** Anthropic model id override. */
  model?: string;
  /** Path to `store.config.json`; defaults to the file in the app directory. */
  config?: string;
  /** Generate and preview only, writing nothing. */
  dryRun?: boolean;
  /** Skip the confirmation prompt (for CI). */
  yes?: boolean;
}

/** Resolve `--platform` into the two stores it targets. */
function parsePlatforms(platform: string | undefined): { ios: boolean; android: boolean } {
  switch (platform ?? 'ios') {
    case 'ios':
      return { ios: true, android: false };
    case 'android':
      return { ios: false, android: true };
    case 'all':
      return { ios: true, android: true };
    default:
      throw new Error(`Unknown platform "${platform}". Use ios, android, or all.`);
  }
}

/** Locales to draft: an explicit `--locale` CSV, else the existing App Store locales, else `en-US`. */
function resolveLocales(csv: string | undefined, config: StoreConfig): string[] {
  if (csv !== undefined) {
    const locales = csv
      .split(',')
      .map((locale) => locale.trim())
      .filter(Boolean);
    if (locales.length === 0)
      throw new Error('--locale was empty. Pass locales like --locale en-US,fr-FR.');
    return locales;
  }
  const existing = config.apple ? Object.keys(config.apple.info) : [];
  return existing.length > 0 ? existing : ['en-US'];
}

/** The app's display name (Expo `name`) for use in the prompt, falling back to the lowercase handle. */
async function resolveDisplayName(app: AppDescriptor): Promise<string> {
  const resolved = await readResolvedConfig(app.dir);
  const expo = asRecord(resolved?.['expo']) ?? resolved;
  const name = expo && typeof expo['name'] === 'string' ? expo['name'] : undefined;
  return name ?? app.name;
}

/**
 * Generate listing drafts for the selected app and locales, preview them, and (on confirmation) write
 * them into `store.config.json`. The generator is injectable so tests drive it without a network; in
 * normal use it defaults to the Anthropic-backed one.
 */
export async function runAiListing(
  input: AiListingInput,
  generator?: ListingGenerator,
): Promise<void> {
  const log = createLogger(false);
  const targets = parsePlatforms(input.platform);

  const { apps } = await loadConfig();
  const app = await selectApp(apps, input.app);
  const appName = await resolveDisplayName(app);
  const configPath = input.config ?? join(app.dir, 'store.config.json');
  const config: StoreConfig = existsSync(configPath) ? loadStoreConfig(configPath) : {};

  const locales = resolveLocales(input.locale, config);
  const gen =
    generator ?? createAnthropicListingGenerator(input.model ? { model: input.model } : {});
  log.info(`Drafting ${locales.length} locale(s) for ${appName} with ${gen.name}…`);

  const drafts: LocaleDraft[] = [];
  for (const locale of locales) {
    const current = config.apple?.info[locale];
    // biome-ignore lint/performance/noAwaitInLoops: sequential — one AI draft per locale; serial bounds LLM API concurrency and keeps drafts in locale order.
    const generated = await gen.generate(briefFor(locale, appName, current, input.about));
    const { draft, warnings } = clampDraft(generated);
    drafts.push({ locale, draft, warnings });
  }

  console.log(renderDraftPreview(drafts, targets));

  if (input.dryRun) {
    log.info('Dry run — nothing written. Drop --dry-run to save into store.config.json.');
    return;
  }
  if (!(await confirmWrite(`Write these draft(s) into ${configPath}?`, input.yes))) return;

  let next = config;
  for (const { locale, draft } of drafts) next = applyDraft(next, locale, draft, targets);
  writeFileSync(configPath, serializeStoreConfig(next));

  log.step('ai listing', `wrote ${drafts.length} locale draft(s) → ${configPath}`);
  log.info('Review with `launch plan`, then apply with `launch sync` (or `launch metadata push`).');
}

/** Attach the `ai listing` subcommand to the shared `ai` group. */
export function registerAiListingCommand(program: Command): void {
  const ai = aiGroup(program);

  ai.command('listing')
    .description(
      'draft App Store / Play listing copy with AI into store.config.json (review with `launch plan`)',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option(
      '--locale <list>',
      'comma-separated locales (default: existing App Store locales, else en-US)',
    )
    .option('--about <text>', 'a short description of the app to seed the copy')
    .option('--platform <p>', 'ios (default), android, or all', 'ios')
    .option('--model <id>', 'Anthropic model id (default: claude-sonnet-4-6 or $LAUNCH_AI_MODEL)')
    .option('--config <path>', 'path to store.config.json (default: <app>/store.config.json)')
    .option('--dry-run', 'generate and preview, but write nothing', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(async (options: AiListingInput) => {
      await runAiListing(options);
    });
}
