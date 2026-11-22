import { loadConfig } from '../config/config.ts';
import { listAccounts } from '../credentials/accounts.ts';
import { listStoredAndroidPackages } from '../credentials/androidKeystore.ts';
import { errorMessage } from '../services/platform/errorMessage.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { StatsCredentials } from '../stats/statsCredentials.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { AccountRecord } from '../types/credentials.ts';
import type { DiscoveredApp, DiscoveryWarning } from '../types/portfolio.ts';
import { createAndroidAppKey, createIosAppKey, mergeDiscoveredApps } from './portfolioLogic.ts';
import { loadPortfolioFile } from './portfolioStore.ts';

interface DiscoveryReport {
  readonly apps: readonly DiscoveredApp[];
  readonly warnings: readonly DiscoveryWarning[];
  readonly attemptedAccountCount: number;
  readonly failedAccountLabels: readonly string[];
}

interface AccountDiscovery {
  readonly accountLabel: string;
  readonly apps: readonly DiscoveredApp[];
  readonly warning: DiscoveryWarning | null;
}

interface ListedAppleApp {
  readonly id: string;
  readonly name: string;
  readonly bundleId: string | null;
}

interface ListedPlayApp {
  readonly packageName: string;
  readonly displayName: string;
}

interface PackageNameRead {
  readonly names: readonly string[];
  readonly failure: unknown | null;
}

interface PlayPackageRead {
  readonly packages: readonly string[];
  readonly failures: readonly AccountDiscovery[];
}

const PLAY_ACCOUNT_LABEL = 'google-play';

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

function failedAccountDiscovery(accountLabel: string, cause: unknown): AccountDiscovery {
  return {
    accountLabel,
    apps: [],
    warning: { accountLabel, message: errorMessage(cause) },
  };
}

type ListApps = () => unknown;

function isListApps(candidate: unknown): candidate is ListApps {
  return typeof candidate == 'function';
}

function readPromise(listedApps: unknown): Promise<unknown> {
  if (listedApps instanceof Promise) {
    return listedApps;
  }

  throw new Error('Store client listApps did not return a promise.');
}

async function readStoreList(client: object): Promise<readonly unknown[]> {
  if ('listApps' in client == false) {
    throw new Error('Store client cannot list apps.');
  }

  const listApps = client.listApps;

  if (isListApps(listApps) == false) {
    throw new Error('Store client cannot list apps.');
  }

  const listedAppsPromise = listApps.call(client);
  const listedApps = await readPromise(listedAppsPromise);

  if (Array.isArray(listedApps) == false) {
    throw new Error('Store client did not return an app list.');
  }

  return listedApps;
}

function isListedAppleApp(candidate: unknown): candidate is ListedAppleApp {
  if (isRecord(candidate) == false) {
    return false;
  }

  if (typeof candidate['id'] != 'string') {
    return false;
  }

  if (typeof candidate['name'] != 'string') {
    return false;
  }

  if (candidate['bundleId'] == null) {
    return true;
  }

  return typeof candidate['bundleId'] == 'string';
}

function isListedPlayApp(candidate: unknown): candidate is ListedPlayApp {
  if (isRecord(candidate) == false) {
    return false;
  }

  if (typeof candidate['packageName'] != 'string') {
    return false;
  }

  return typeof candidate['displayName'] == 'string';
}

async function listAppleApps(ascClient: object): Promise<readonly ListedAppleApp[]> {
  const listedApps = await readStoreList(ascClient);
  const appleApps: ListedAppleApp[] = [];

  for (const listedApp of listedApps) {
    if (isListedAppleApp(listedApp) == false) {
      throw new Error('App Store client returned an app list discovery cannot read.');
    }

    appleApps.push(listedApp);
  }

  return appleApps;
}

async function listPlayApps(reportingClient: object): Promise<readonly ListedPlayApp[]> {
  const listedApps = await readStoreList(reportingClient);
  const playApps: ListedPlayApp[] = [];

  for (const listedApp of listedApps) {
    if (isListedPlayApp(listedApp) == false) {
      throw new Error('Play client returned an app list discovery cannot read.');
    }

    playApps.push(listedApp);
  }

  return playApps;
}

async function discoverAppleAccount(account: AccountRecord): Promise<AccountDiscovery> {
  try {
    const ascClient = await StatsCredentials.ascClientForAccount(account.keyId);

    if (ascClient == null) {
      return failedAccountDiscovery(
        account.label,
        'no saved key for this account in the secret store',
      );
    }

    const ascApps = await listAppleApps(ascClient);

    function toDiscoveredApp(ascApp: ListedAppleApp): DiscoveredApp {
      return {
        key: createIosAppKey(ascApp.id),
        platform: 'ios',
        storeId: ascApp.id,
        name: ascApp.name,
        bundleId: ascApp.bundleId,
        packageName: null,
        accountKeyId: account.keyId,
        accountLabel: account.label,
      };
    }

    return { accountLabel: account.label, apps: ascApps.map(toDiscoveredApp), warning: null };
  } catch (cause) {
    return failedAccountDiscovery(account.label, cause);
  }
}

async function discoverAppleAccounts(
  accounts: readonly AccountRecord[],
): Promise<AccountDiscovery[]> {
  const discoveries: AccountDiscovery[] = [];
  let nextIndex = 0;

  async function discoverNextAccount(): Promise<void> {
    const index = nextIndex;
    nextIndex += 1;
    const isFinished = index >= accounts.length;

    if (isFinished) {
      return;
    }

    const account = accounts[index];

    if (account == null) {
      throw new Error('Account list changed while apps were discovered.');
    }

    discoveries[index] = await discoverAppleAccount(account);
    await discoverNextAccount();
  }

  const appleDiscoveryConcurrency = 4;
  const workerCount = Math.min(appleDiscoveryConcurrency, accounts.length);
  const workers: Promise<void>[] = [];

  for (let workerNumber = 0; workerNumber < workerCount; workerNumber += 1) {
    workers.push(discoverNextAccount());
  }

  await Promise.all(workers);

  return discoveries;
}

function readConfiguredPackageName(app: AppDescriptor): string[] {
  if (app.packageName == null) {
    return [];
  }

  return [app.packageName];
}

async function readConfiguredPackageNames(): Promise<readonly string[]> {
  const workingDirectory = readLaunchDirectories().workingDirectory;
  const configuration = await loadConfig(workingDirectory);

  return configuration.apps.flatMap(readConfiguredPackageName);
}

function readSavedPackageName(app: DiscoveredApp): string[] {
  if (app.packageName == null) {
    return [];
  }

  return [app.packageName];
}

async function readSavedPackageNames(): Promise<readonly string[]> {
  const savedPortfolio = await loadPortfolioFile();

  if (savedPortfolio == null) {
    return [];
  }

  return savedPortfolio.apps.flatMap(readSavedPackageName);
}

type ReadPackageNames = () => Promise<readonly string[]>;

async function readPackageNames(readNames: ReadPackageNames): Promise<PackageNameRead> {
  try {
    const names = await readNames();

    return { names, failure: null };
  } catch (cause) {
    return { names: [], failure: cause };
  }
}

function collectPlayPackages(packageReads: readonly PackageNameRead[]): PlayPackageRead {
  const failures: AccountDiscovery[] = [];
  const packages = new Set<string>();

  for (const packageRead of packageReads) {
    if (packageRead.failure != null) {
      const failure = failedAccountDiscovery(PLAY_ACCOUNT_LABEL, packageRead.failure);
      failures.push(failure);
      continue;
    }

    for (const packageName of packageRead.names) {
      packages.add(packageName);
    }
  }

  return { packages: [...packages], failures };
}

async function readPlayPackageNames(): Promise<PlayPackageRead> {
  const configuredRead = await readPackageNames(readConfiguredPackageNames);
  const savedRead = await readPackageNames(readSavedPackageNames);
  const storedRead = await readPackageNames(listStoredAndroidPackages);

  return collectPlayPackages([configuredRead, savedRead, storedRead]);
}

async function discoverPlay(packageName: string): Promise<AccountDiscovery | null> {
  try {
    const reportingClient = await StatsCredentials.playReportingClient(packageName);

    if (reportingClient == null) {
      return null;
    }

    const playApps = await listPlayApps(reportingClient);

    function toDiscoveredApp(playApp: ListedPlayApp): DiscoveredApp {
      return {
        key: createAndroidAppKey(playApp.packageName),
        platform: 'android',
        storeId: playApp.packageName,
        name: playApp.displayName,
        bundleId: null,
        packageName: playApp.packageName,
        accountKeyId: null,
        accountLabel: PLAY_ACCOUNT_LABEL,
      };
    }

    return {
      accountLabel: PLAY_ACCOUNT_LABEL,
      apps: playApps.map(toDiscoveredApp),
      warning: null,
    };
  } catch (cause) {
    return failedAccountDiscovery(PLAY_ACCOUNT_LABEL, cause);
  }
}

async function discoverPlayPackages(
  packageNames: readonly string[],
): Promise<(AccountDiscovery | null)[]> {
  const playDiscoveries: (AccountDiscovery | null)[] = [];

  for (const packageName of packageNames) {
    const playDiscovery = await discoverPlay(packageName);
    playDiscoveries.push(playDiscovery);
  }

  return playDiscoveries;
}

function combineDiscoveries(
  appleDiscoveries: readonly AccountDiscovery[],
  packageSourceFailures: readonly AccountDiscovery[],
  playDiscoveries: readonly (AccountDiscovery | null)[],
): AccountDiscovery[] {
  const discoveries: AccountDiscovery[] = [...appleDiscoveries, ...packageSourceFailures];

  for (const playDiscovery of playDiscoveries) {
    if (playDiscovery == null) {
      continue;
    }

    discoveries.push(playDiscovery);
  }

  return discoveries;
}

function readDiscoveryApps(discovery: AccountDiscovery): readonly DiscoveredApp[] {
  return discovery.apps;
}

function readWarningAccountLabel(warning: DiscoveryWarning): string {
  return warning.accountLabel;
}

function createDiscoveryReport(discoveries: readonly AccountDiscovery[]): DiscoveryReport {
  const warnings: DiscoveryWarning[] = [];

  for (const discovery of discoveries) {
    const warning = discovery.warning;

    if (warning == null) {
      continue;
    }

    warnings.push(warning);
  }

  const appLists = discoveries.map(readDiscoveryApps);
  const failedAccountLabels = warnings.map(readWarningAccountLabel);

  return {
    apps: mergeDiscoveredApps(appLists),
    warnings,
    attemptedAccountCount: discoveries.length,
    failedAccountLabels,
  };
}

export async function discoverApps(): Promise<DiscoveryReport> {
  const accounts = await listAccounts();
  const appleDiscoveries = await discoverAppleAccounts(accounts);
  const packageRead = await readPlayPackageNames();
  const playDiscoveries = await discoverPlayPackages(packageRead.packages);
  const discoveries = combineDiscoveries(appleDiscoveries, packageRead.failures, playDiscoveries);

  return createDiscoveryReport(discoveries);
}
