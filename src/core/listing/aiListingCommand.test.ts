import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { makeLaunchPromptTest } from '../services/prompt.js';
import type { AppDescriptor } from '../types/app.js';
import type { ListingGenerator } from '../types/listing.js';

let selectedApp: AppDescriptor;

vi.mock('../config/config.js', () => ({
  loadConfig: () => Effect.succeed({ config: {}, apps: [selectedApp] }),
  readResolvedConfig: () => Effect.succeed({ expo: { name: 'Focus App' } }),
}));

const { AiListingInputSchema, parseListingTargets, resolveListingLocales, runAiListing } =
  await import('./aiListingCommand.js');

const generatedListingSchema = Schema.Struct({
  android: Schema.Struct({
    info: Schema.Record({
      key: Schema.String,
      value: Schema.Struct({
        title: Schema.String,
        shortDescription: Schema.String,
        fullDescription: Schema.String,
      }),
    }),
  }),
});

const listingGenerator: ListingGenerator = {
  name: 'test-generator',
  generate: () =>
    Effect.succeed({
      title: 'Focus App',
      subtitle: 'Stay focused',
      description: 'A calm focus timer.',
    }),
};

describe('ai listing command', () => {
  let workingDirectory: string;
  let configPath: string;

  beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), 'launch-ai-listing-'));
    configPath = join(workingDirectory, 'store.config.json');
    selectedApp = {
      name: 'focus',
      dir: workingDirectory,
      configPath: join(workingDirectory, 'app.json'),
      packageName: 'com.acme.focus',
    };
  });

  afterEach(() => {
    rmSync(workingDirectory, { recursive: true, force: true });
  });

  const runListing = (
    commandInput: Parameters<typeof runAiListing>[0],
    terminalWrites: string[] = [],
  ) =>
    Effect.runPromise(
      runAiListing(commandInput, listingGenerator).pipe(
        Effect.provide(makeLaunchPromptTest()),
        Effect.provide(makeLaunchPathsTest(workingDirectory, workingDirectory)),
        Effect.provide(makeLaunchLoggerTest(terminalWrites)),
        Effect.provide(NodeContext.layer),
      ),
    );

  it('decodes stable command defaults', async () => {
    const commandInput = await Effect.runPromise(Schema.decodeUnknown(AiListingInputSchema)({}));
    expect(commandInput).toEqual({ platform: 'ios', dryRun: false, yes: false });
  });

  it('writes generated Google Play copy when Android is selected', async () => {
    const terminalWrites: string[] = [];
    await runListing(
      {
        platform: 'android',
        config: configPath,
        dryRun: false,
        yes: true,
      },
      terminalWrites,
    );
    const writtenStoreConfig = Schema.decodeUnknownSync(generatedListingSchema)(
      JSON.parse(readFileSync(configPath, 'utf8')),
    );
    expect(writtenStoreConfig.android.info['en-US']).toEqual({
      title: 'Focus App',
      shortDescription: 'Stay focused',
      fullDescription: 'A calm focus timer.',
    });
    expect(terminalWrites.join('')).toContain('[OK] ai listing - wrote 1 locale draft');
  });

  it('previews without creating a file during a dry run', async () => {
    await runListing({
      platform: 'ios',
      config: configPath,
      dryRun: true,
      yes: false,
    });
    expect(existsSync(configPath)).toBe(false);
  });

  it('rejects unknown platform selectors', async () => {
    await expect(Effect.runPromise(parseListingTargets('windows'))).rejects.toThrow(
      /Use ios, android, or all/,
    );
  });

  it('uses explicit locales and rejects an empty locale selector', async () => {
    expect(await Effect.runPromise(resolveListingLocales('en-US, fr-FR', {}))).toEqual([
      'en-US',
      'fr-FR',
    ]);
    await expect(Effect.runPromise(resolveListingLocales(' , ', {}))).rejects.toThrow(
      /--locale was empty/,
    );
  });
});
