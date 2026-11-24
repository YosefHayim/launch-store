import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { LaunchConfig } from '../types/config.ts';
import {
  parseListingTargets,
  readAiListingInput,
  readListingLocales,
  runAiListing,
} from './ai-listing-command.ts';

let selectedApp: AppDescriptor;
let selectedLaunch: LaunchConfig;

vi.mock('../config/config.ts', function mockPiece() {
  return {
    loadConfig: function loadConfig() {
      return Promise.resolve({
        config: selectedLaunch,
        apps: [selectedApp],
        directory: null,
      });
    },
    launchConfigForApp: function launchConfigForApp(fallbackConfig: LaunchConfig) {
      return Promise.resolve(fallbackConfig);
    },
    readAppConfig: function readAppConfig() {
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

  function prepareAiListingCommand() {
    const systemTemporaryDirectory = tmpdir();
    const launchAiListingPath = join(systemTemporaryDirectory, 'launch-ai-listing-');

    workingDirectory = mkdtempSync(launchAiListingPath);
    useLoggerSink(function discardLine() {});
    selectedLaunch = {
      profiles: {},
      credentials: 'local',
      storage: 'local',
      buildEngine: 'xcode',
      submit: 'app-store-connect',
    };
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

  async function printsGeneratedGooglePlayCopyWhenAndroidIsSelected() {
    const terminalWrites = captureLogs();

    await runAiListing(
      {
        platform: 'android',
        dryRun: false,
        yes: true,
      },
      listingGenerator,
    );

    function startsWithObject(text: string) {
      return text.trimStart().startsWith('{');
    }

    const listingText = terminalWrites.find(startsWithObject);

    if (listingText == null) {
      throw new Error('expected a printed listing');
    }

    const listingDocument = JSON.parse(listingText) as {
      'com.acme.focus': {
        android: {
          info: Record<
            string,
            { title: string; shortDescription: string; fullDescription: string }
          >;
        };
      };
    };
    const focusListing = listingDocument['com.acme.focus'];
    const storeConfigPath = join(workingDirectory, 'store.config.json');

    expect(focusListing.android.info['en-US']).toEqual({
      title: 'Focus App',
      shortDescription: 'Stay focused',
      fullDescription: 'A calm focus timer.',
    });
    expect(existsSync(storeConfigPath)).toBe(false);
    expect(terminalWrites.join('')).toContain('listing in launch.config.ts');
  }

  it(
    'prints generated Google Play copy when Android is selected',
    printsGeneratedGooglePlayCopyWhenAndroidIsSelected,
  );

  async function previewsWithoutCreatingAFileDuringADryRun() {
    await runAiListing(
      {
        platform: 'ios',
        dryRun: true,
        yes: false,
      },
      listingGenerator,
    );

    const storeConfigPath = join(workingDirectory, 'store.config.json');

    expect(existsSync(storeConfigPath)).toBe(false);
  }

  it(
    'previews without creating a file during a dry run',
    previewsWithoutCreatingAFileDuringADryRun,
  );

  async function rejectsUnknownPlatformSelectors() {
    async function rejectUnknownPlatform(): Promise<void> {
      parseListingTargets('windows');
    }

    const pendingRejection = rejectUnknownPlatform();

    await expect(pendingRejection).rejects.toBeInstanceOf(Error);
    await expect(pendingRejection).rejects.toMatchObject({
      message: expect.stringMatching(/Use ios, android, or all/),
    });
  }

  it('rejects unknown platform selectors', rejectsUnknownPlatformSelectors);

  async function usesExplicitLocalesAndRejectsAnEmptyLocaleSelector() {
    const listingLocales = readListingLocales('en-US, fr-FR', {});

    expect(listingLocales).toEqual(['en-US', 'fr-FR']);

    async function rejectEmptyLocales(): Promise<void> {
      readListingLocales(' , ', {});
    }

    const pendingRejection = rejectEmptyLocales();

    await expect(pendingRejection).rejects.toBeInstanceOf(Error);
    await expect(pendingRejection).rejects.toMatchObject({
      message: expect.stringMatching(/--locale was empty/),
    });
  }

  it(
    'uses explicit locales and rejects an empty locale selector',
    usesExplicitLocalesAndRejectsAnEmptyLocaleSelector,
  );
}

describe('ai listing command', describeAiListingCommand);
