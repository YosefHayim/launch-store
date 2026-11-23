import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import type { AppDescriptor } from '../types/app.ts';
import {
  parseListingTargets,
  readAiListingInput,
  resolveListingLocales,
  runAiListing,
} from './ai-listing-command.ts';

let selectedApp: AppDescriptor;

vi.mock('../config/config.ts', function mockPiece() {
  return {
    loadConfig: function loadConfig() {
      return Promise.resolve({ config: {}, apps: [selectedApp] });
    },
    readResolvedConfig: function readResolvedConfig() {
      return Promise.resolve({ expo: { name: 'Focus App' } });
    },
  };
});

const listingGenerator = {
  name: 'test-generator',
  generate: function generate() {
    return Promise.resolve({
      title: 'Focus App',
      subtitle: 'Stay focused',
      description: 'A calm focus timer.',
    });
  },
};
function describeAiListingCommand() {
  let workingDirectory: string;
  let configPath: string;
  function prepareAiListingCommand() {
    const systemTemporaryDirectory = tmpdir();
    const launchAiListingPath = join(systemTemporaryDirectory, 'launch-ai-listing-');
    workingDirectory = mkdtempSync(launchAiListingPath);
    configPath = join(workingDirectory, 'store.config.json');
    useLoggerSink(function discardLine() {});
    selectedApp = {
      name: 'focus',
      dir: workingDirectory,
      configPath: join(workingDirectory, 'app.json'),
      packageName: 'com.acme.focus',
    };
  }

  beforeEach(prepareAiListingCommand);

  afterEach(function resetListingCommandTest() {
    resetLogger();
    rmSync(workingDirectory, { recursive: true, force: true });
  });

  function captureLogs(): string[] {
    const lines: string[] = [];

    useLoggerSink(function writeLine(text: string) {
      lines.push(text);
    });

    return lines;
  }
  function decodesStableCommandDefaults() {
    const readAiListing = readAiListingInput({});
    expect(readAiListing).toEqual({ platform: 'ios', dryRun: false, yes: false });
  }

  it('decodes stable command defaults', decodesStableCommandDefaults);
  async function writesGeneratedGooglePlayCopyWhenAndroidIsSelected() {
    const terminalWrites = captureLogs();

    await runAiListing(
      {
        platform: 'android',
        config: configPath,
        dryRun: false,
        yes: true,
      },
      listingGenerator,
    );

    const loadedFile = readFileSync(configPath, 'utf8');
    const writtenStoreConfig = JSON.parse(loadedFile);
    expect(writtenStoreConfig.android.info['en-US']).toEqual({
      title: 'Focus App',
      shortDescription: 'Stay focused',
      fullDescription: 'A calm focus timer.',
    });
    expect(terminalWrites.join('')).toContain('[OK] ai listing - wrote 1 locale draft');
  }

  it(
    'writes generated Google Play copy when Android is selected',
    writesGeneratedGooglePlayCopyWhenAndroidIsSelected,
  );
  async function previewsWithoutCreatingAFileDuringADryRun() {
    await runAiListing(
      {
        platform: 'ios',
        config: configPath,
        dryRun: true,
        yes: false,
      },
      listingGenerator,
    );
    const pathExists = existsSync(configPath);
    expect(pathExists).toBe(false);
  }

  it(
    'previews without creating a file during a dry run',
    previewsWithoutCreatingAFileDuringADryRun,
  );
  async function rejectsUnknownPlatformSelectors() {
    async function rejectUnknownPlatform(): Promise<void> {
      parseListingTargets('windows');
    }

    await expect(rejectUnknownPlatform()).rejects.toMatchObject({
      _tag: 'AiListingFailure',
      message: expect.stringMatching(/Use ios, android, or all/),
    });
  }

  it('rejects unknown platform selectors', rejectsUnknownPlatformSelectors);
  async function usesExplicitLocalesAndRejectsAnEmptyLocaleSelector() {
    const listingLocales = resolveListingLocales('en-US, fr-FR', {});
    expect(listingLocales).toEqual(['en-US', 'fr-FR']);

    async function rejectEmptyLocales(): Promise<void> {
      resolveListingLocales(' , ', {});
    }

    await expect(rejectEmptyLocales()).rejects.toMatchObject({
      _tag: 'AiListingFailure',
      message: expect.stringMatching(/--locale was empty/),
    });
  }

  it(
    'uses explicit locales and rejects an empty locale selector',
    usesExplicitLocalesAndRejectsAnEmptyLocaleSelector,
  );
}

describe('ai listing command', describeAiListingCommand);
