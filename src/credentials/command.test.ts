import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
  writeLaunchHomeFile,
} from '../testkit/temporary-launch-home.ts';
import { resetSecretStore, useSecretStore } from '../services/credentials/secret-store.ts';
import { resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { CredentialsCommandInputSchema, credentialsCommandProgram } from './command.ts';
import { credentialSearchDirectories, isCredentialDiscoveryFile } from './credential-discovery.ts';

function discoveryMatches(filePath: string): boolean {
  const searchDirectories = credentialSearchDirectories('/Users/example', '/workspace/app');

  return isCredentialDiscoveryFile(filePath, searchDirectories);
}

async function runCredentialsFailure(commandInput: unknown): Promise<Error> {
  try {
    await credentialsCommandProgram(commandInput);
  } catch (cause) {
    const isAlreadyError = cause instanceof Error;

    if (isAlreadyError) {
      return cause;
    }

    throw new Error('Expected the credentials command to fail.', { cause });
  }

  throw new Error('Expected the credentials command to fail.');
}

function describeCredentialDiscoveryDirectories() {
  function matchesAKeyDirectlyInsideDownloads() {
    expect(discoveryMatches('/Users/example/Downloads/AuthKey_ABC123.p8')).toBe(true);
  }

  it('matches a key directly inside Downloads', matchesAKeyDirectlyInsideDownloads);

  function matchesAServiceAccountKeyDirectlyInsideTheWorkingDirectory() {
    expect(discoveryMatches('/workspace/app/service-account.json')).toBe(true);
  }

  it(
    'matches a service-account key directly inside the working directory',
    matchesAServiceAccountKeyDirectlyInsideTheWorkingDirectory,
  );

  function leavesADeliberatelyPlacedKeyOutsideDiscoveryDirectoriesUntouched() {
    expect(discoveryMatches('/Users/example/vault/AuthKey_ABC123.p8')).toBe(false);
  }

  it(
    'leaves a deliberately placed key outside discovery directories untouched',
    leavesADeliberatelyPlacedKeyOutsideDiscoveryDirectoriesUntouched,
  );

  function doesNotPieceAKeyNestedBelowADiscoveryDirectory() {
    expect(discoveryMatches('/Users/example/Downloads/keys/AuthKey_ABC123.p8')).toBe(false);
  }

  it(
    'does not match a key nested below a discovery directory',
    doesNotPieceAKeyNestedBelowADiscoveryDirectory,
  );
}

describe('credential discovery directories', describeCredentialDiscoveryDirectories);

function describeCredentialsCommandPieceSchema() {
  function decodesTheCommanderBoundaryIntoAKnownCredentialAction() {
    const credentialsCommandSchema = CredentialsCommandInputSchema({
      action: 'setup',
      options: { platform: 'android', yes: true },
    });

    expect(credentialsCommandSchema).toEqual({
      action: 'setup',
      options: { platform: 'android', yes: true },
    });
  }

  it(
    'decodes the Commander boundary into a known credential action',
    decodesTheCommanderBoundaryIntoAKnownCredentialAction,
  );

  function rejectsAnUnknownCredentialActionBeforeOrchestration() {
    function callCredentialsCommandPieceSchema() {
      return CredentialsCommandInputSchema({
        action: 'erase-everything',
        options: {},
      });
    }

    expect(callCredentialsCommandPieceSchema).toThrow();
  }

  it(
    'rejects an unknown credential action before orchestration',
    rejectsAnUnknownCredentialActionBeforeOrchestration,
  );

  function acceptsLogoutAsARemoveAliasAtTheSchemaBoundary() {
    const credentialsCommandSchema = CredentialsCommandInputSchema({
      action: 'logout',
      firstArgument: 'acme',
      options: { yes: true },
    });

    expect(credentialsCommandSchema).toEqual({
      action: 'logout',
      firstArgument: 'acme',
      options: { yes: true },
    });
  }

  it(
    'accepts logout as a remove alias at the schema boundary',
    acceptsLogoutAsARemoveAliasAtTheSchemaBoundary,
  );
}

describe('CredentialsCommandInputSchema', describeCredentialsCommandPieceSchema);

function describeCredentialsCommandProgramValidation() {
  async function failsWithTheRenameUsageWhenArgumentsAreMissing() {
    const failure = await runCredentialsFailure({
      action: 'rename',
      options: { yes: true },
    });

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('launch-store creds rename');
  }

  it(
    'fails with the rename usage when arguments are missing',
    failsWithTheRenameUsageWhenArgumentsAreMissing,
  );

  async function failsWithTheRemoveUsageWhenTheAccountSelectorIsMissing() {
    const failure = await runCredentialsFailure({
      action: 'remove',
      options: { yes: true },
    });

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('launch-store creds remove');
  }

  it(
    'fails with the remove usage when the account selector is missing',
    failsWithTheRemoveUsageWhenTheAccountSelectorIsMissing,
  );

  async function requiresAnAccountSelectorForNonInteractiveUse() {
    const failure = await runCredentialsFailure({
      action: 'use',
      options: { yes: true },
    });

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('account label or Key ID');
  }

  it(
    'requires an account selector for non-interactive use',
    requiresAnAccountSelectorForNonInteractiveUse,
  );

  async function rejectsAnUnknownPushKeySubcommandWithoutTouchingTheVault() {
    const failure = await runCredentialsFailure({
      action: 'push-key',
      firstArgument: 'rotate',
      options: { yes: true },
    });

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('import, status, or export');
  }

  it(
    'rejects an unknown push-key subcommand without touching the vault',
    rejectsAnUnknownPushKeySubcommandWithoutTouchingTheVault,
  );

  async function requiresAKeyIDForNonInteractiveAPNsExport() {
    const failure = await runCredentialsFailure({
      action: 'push-key',
      firstArgument: 'export',
      options: { yes: true },
    });

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('push-key export');
  }

  it(
    'requires a Key ID for non-interactive APNs export',
    requiresAKeyIDForNonInteractiveAPNsExport,
  );
}

describe('credentialsCommandProgram validation', describeCredentialsCommandProgramValidation);

function useCommandHome(homeDirectory: string, lines: string[]): void {
  const workPath = join(homeDirectory, 'work');

  useLaunchDirectories({
    homeDirectory,
    workingDirectory: workPath,
  });
  useSecretStore(new Map());
  useLoggerSink(function keepLine(text: string) {
    lines.push(text);
  });
}

function describeSetVendorNumberAction() {
  let homeDirectory: string;

  function prepareSetVendorNumberAction() {
    homeDirectory = createTemporaryHomeDirectory();

    const serialized = JSON.stringify({
      active: 'KEYA',
      accounts: [{ keyId: 'KEYA', issuerId: 'issuer-a', label: 'alpha', addedAt: 't' }],
    });

    writeLaunchHomeFile(homeDirectory, 'accounts.json', serialized);
  }

  beforeEach(prepareSetVendorNumberAction);

  function cleanupSetVendorNumberAction() {
    resetLaunchDirectories();
    resetSecretStore();
    resetLogger();
    removeTemporaryHomeDirectory(homeDirectory);
  }

  afterEach(cleanupSetVendorNumberAction);

  async function runInTemporaryHome(options: Record<string, unknown>) {
    const lines: string[] = [];

    useCommandHome(homeDirectory, lines);

    try {
      await credentialsCommandProgram({ action: 'set-vendor-number', options });

      return { failed: null, lines };
    } catch (cause) {
      return { failed: cause, lines };
    }
  }

  async function savesTheVendorNumberOnTheMatchingAccount() {
    const { failed, lines } = await runInTemporaryHome({
      account: 'alpha',
      vendorNumber: ' 12345678 ',
    });

    expect(failed).toBeNull();

    function includesAlphaLabel(line: string) {
      return line.includes('alpha');
    }

    expect(lines.some(includesAlphaLabel)).toBe(true);

    const accountsPath = join(homeDirectory, '.launch', 'accounts.json');
    const loadedFile = readFileSync(accountsPath, 'utf8');
    const savedFile = JSON.parse(loadedFile);

    expect(savedFile.accounts[0].vendorNumber).toBe('12345678');
  }

  it('saves the vendor number on the matching account', savesTheVendorNumberOnTheMatchingAccount);

  async function asksForBothFlags() {
    const withoutAccount = await runInTemporaryHome({ vendorNumber: '1' });
    const withoutNumber = await runInTemporaryHome({ account: 'alpha' });

    expect(withoutAccount.failed).toBeInstanceOf(Error);
    expect(withoutNumber.failed).toBeInstanceOf(Error);
  }

  it('asks for both flags', asksForBothFlags);

  async function rejectsAVendorNumberThatIsNotDigits() {
    const { failed } = await runInTemporaryHome({ account: 'alpha', vendorNumber: 'abc' });

    expect(failed).toBeInstanceOf(Error);
    expect(failed).toMatchObject({
      message: expect.stringContaining('digits only'),
    });
  }

  it('rejects a vendor number that is not digits', rejectsAVendorNumberThatIsNotDigits);
}

describe('set-vendor-number action', describeSetVendorNumberAction);

function describeSetPlayReportsBucketAction() {
  let homeDirectory: string;

  function prepareSetPlayReportsBucketAction() {
    homeDirectory = createTemporaryHomeDirectory();
  }

  beforeEach(prepareSetPlayReportsBucketAction);

  function cleanupSetPlayReportsBucketAction() {
    resetLaunchDirectories();
    resetSecretStore();
    resetLogger();
    removeTemporaryHomeDirectory(homeDirectory);
  }

  afterEach(cleanupSetPlayReportsBucketAction);

  async function runInTemporaryHome(options: Record<string, unknown>) {
    const lines: string[] = [];

    useCommandHome(homeDirectory, lines);

    try {
      await credentialsCommandProgram({ action: 'set-play-reports-bucket', options });

      return { failed: null, lines };
    } catch (cause) {
      return { failed: cause, lines };
    }
  }

  function readSavedPortfolio() {
    const portfolioPath = join(homeDirectory, '.launch', 'portfolio.json');
    const loadedFile = readFileSync(portfolioPath, 'utf8');
    return JSON.parse(loadedFile);
  }

  async function savesTheBucketNameFromACopiedGsURIIntoPortfolioPiece() {
    const { failed, lines } = await runInTemporaryHome({
      playReportsBucket: 'gs://pubsite_prod_rev_123/',
    });

    expect(failed).toBeNull();

    function includesPlayRevSite(line: string) {
      return line.includes('pubsite_prod_rev_123');
    }

    expect(lines.some(includesPlayRevSite)).toBe(true);

    const savedPortfolio = readSavedPortfolio();

    expect(savedPortfolio.playReportsBucket).toBe('pubsite_prod_rev_123');
  }

  it(
    'saves the bucket name from a copied gs:// URI into portfolio.json',
    savesTheBucketNameFromACopiedGsURIIntoPortfolioPiece,
  );

  async function keepsTheTagsAlreadySavedInPortfolioPiece() {
    const serialized = JSON.stringify({
      version: 1,
      discoveredAt: '2026-10-01T00:00:00.000Z',
      apps: [],
      tags: [{ appKey: 'ios-1', owner: 'mine', ga4PropertyId: null }],
    });

    writeLaunchHomeFile(homeDirectory, 'portfolio.json', serialized);

    await runInTemporaryHome({ playReportsBucket: 'pubsite_prod_123' });

    const savedPortfolio = readSavedPortfolio();

    expect(savedPortfolio.tags).toHaveLength(1);
    expect(savedPortfolio.playReportsBucket).toBe('pubsite_prod_123');
  }

  it('keeps the tags already saved in portfolio.json', keepsTheTagsAlreadySavedInPortfolioPiece);

  async function asksForTheFlagAndRejectsPieceThatIsNotAPlayBucket() {
    const withoutFlag = await runInTemporaryHome({});
    const withWrongBucket = await runInTemporaryHome({ playReportsBucket: 'gs://my-bucket/' });

    expect(withoutFlag.failed).toBeInstanceOf(Error);
    expect(withWrongBucket.failed).toBeInstanceOf(Error);
    expect(withWrongBucket.failed).toMatchObject({
      message: expect.stringContaining('pubsite_prod_rev_'),
    });
  }

  it(
    'asks for the flag and rejects text that is not a Play bucket',
    asksForTheFlagAndRejectsPieceThatIsNotAPlayBucket,
  );
}

describe('set-play-reports-bucket action', describeSetPlayReportsBucketAction);

function describeAndroidCredentialStatus() {
  function cleanupAndroidCredentialStatus() {
    resetLaunchDirectories();
    resetSecretStore();
    resetLogger();
  }

  afterEach(cleanupAndroidCredentialStatus);

  async function reportsABrokenLaunchPieceInsteadOfHidingIt() {
    const homeDirectory = createTemporaryHomeDirectory();

    try {
      const work = join(homeDirectory, 'work');

      mkdirSync(work, { recursive: true });

      const launchPath = join(work, 'launch.config.js');

      writeFileSync(launchPath, 'throw new Error("broken config fixture")');
      useCommandHome(homeDirectory, []);

      const credentialsProgram = credentialsCommandProgram({
        action: 'status',
        options: { yes: true },
      });

      await expect(credentialsProgram).rejects.toMatchObject({
        message: expect.stringContaining('Could not load launch.config.js'),
      });
    } finally {
      removeTemporaryHomeDirectory(homeDirectory);
    }
  }

  it(
    'reports a broken Launch config instead of hiding it',
    reportsABrokenLaunchPieceInsteadOfHidingIt,
  );

  async function listsAllConfiguredAndroidAppsWithoutAskingForAnApp() {
    const homeDirectory = createTemporaryHomeDirectory();

    try {
      for (const name of ['alpha', 'beta']) {
        const directory = join(homeDirectory, 'work', 'apps', name);

        mkdirSync(directory, { recursive: true });

        const appPath = join(directory, 'app.json');
        const serialized = JSON.stringify({
          expo: { slug: name, android: { package: `com.example.${name}` } },
        });

        writeFileSync(appPath, serialized);
      }

      const lines: string[] = [];

      useCommandHome(homeDirectory, lines);
      useSecretStore(new Map([['play-service-account:com.example.alpha', 'dummy']]));
      await credentialsCommandProgram({ action: 'status', options: { yes: true } });
      expect(lines.join('')).toContain('Google service account (alpha): stored');
      expect(lines.join('')).toContain('Google service account (beta): not stored');
    } finally {
      removeTemporaryHomeDirectory(homeDirectory);
    }
  }

  it(
    'lists all configured Android apps without asking for an app',
    listsAllConfiguredAndroidAppsWithoutAskingForAnApp,
  );
}

describe('Android credential status', describeAndroidCredentialStatus);
