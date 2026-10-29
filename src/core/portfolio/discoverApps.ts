import type { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import { listAccounts } from '../credentials/accounts.js';
import { errorMessage } from '../services/errorMessage.js';
import type { LaunchPathsService } from '../services/paths.js';
import { StatsCredentials } from '../stats/statsCredentials.js';
import type { AccountRecord } from '../types/credentials.js';
import type { DiscoveredApp, DiscoveryReport, DiscoveryWarning } from '../types/portfolio.js';
import type { StatsCredentialsShape } from '../types/stats.js';
import { createAndroidAppKey, createIosAppKey, mergeDiscoveredApps } from './portfolioLogic.js';

const PLAY_ACCOUNT_LABEL = 'google-play';
const APPLE_DISCOVERY_CONCURRENCY = 4;

type DiscoveryRequirements =
  | FileSystem.FileSystem
  | LaunchPathsService
  | Path.Path
  | StatsCredentialsShape;

interface AccountDiscovery {
  readonly accountLabel: string;
  readonly apps: readonly DiscoveredApp[];
  readonly warning: DiscoveryWarning | null;
}

const failedAccountDiscovery = (accountLabel: string, cause: unknown): AccountDiscovery => ({
  accountLabel,
  apps: [],
  warning: { accountLabel, message: errorMessage(cause) },
});

const discoverAppleAccount = (
  account: AccountRecord,
): Effect.Effect<AccountDiscovery, never, StatsCredentialsShape> =>
  Effect.gen(function* () {
    const credentials = yield* StatsCredentials;
    const ascClient = yield* credentials.ascClientForAccount(account.keyId);
    const isKeyMissing = ascClient === null;
    if (isKeyMissing) {
      return failedAccountDiscovery(
        account.label,
        'no saved key for this account in the secret store',
      );
    }
    const ascApps = yield* ascClient.listApps();
    const apps = ascApps.map(
      (ascApp): DiscoveredApp => ({
        key: createIosAppKey(ascApp.id),
        platform: 'ios',
        storeId: ascApp.id,
        name: ascApp.name,
        bundleId: ascApp.bundleId,
        packageName: null,
        accountKeyId: account.keyId,
        accountLabel: account.label,
      }),
    );
    return { accountLabel: account.label, apps, warning: null };
  }).pipe(Effect.catchAll((cause) => Effect.succeed(failedAccountDiscovery(account.label, cause))));

const discoverPlay = (): Effect.Effect<AccountDiscovery | null, never, StatsCredentialsShape> =>
  Effect.gen(function* () {
    const credentials = yield* StatsCredentials;
    const reportingClient = yield* credentials.playReportingClient();
    const isPlayNotConnected = reportingClient === null;
    if (isPlayNotConnected) return null;
    const playApps = yield* reportingClient.listApps();
    const apps = playApps.map(
      (playApp): DiscoveredApp => ({
        key: createAndroidAppKey(playApp.packageName),
        platform: 'android',
        storeId: playApp.packageName,
        name: playApp.displayName,
        bundleId: null,
        packageName: playApp.packageName,
        accountKeyId: null,
        accountLabel: PLAY_ACCOUNT_LABEL,
      }),
    );
    return { accountLabel: PLAY_ACCOUNT_LABEL, apps, warning: null };
  }).pipe(
    Effect.catchAll((cause) => Effect.succeed(failedAccountDiscovery(PLAY_ACCOUNT_LABEL, cause))),
  );

export const discoverApps = (): Effect.Effect<DiscoveryReport, never, DiscoveryRequirements> =>
  Effect.gen(function* () {
    const accounts = yield* listAccounts();
    const appleDiscoveries = yield* Effect.forEach(accounts, discoverAppleAccount, {
      concurrency: APPLE_DISCOVERY_CONCURRENCY,
    });
    const playDiscovery = yield* discoverPlay();
    const discoveries: AccountDiscovery[] = [...appleDiscoveries];
    const isPlayConnected = playDiscovery !== null;
    if (isPlayConnected) discoveries.push(playDiscovery);
    const warnings: DiscoveryWarning[] = [];
    for (const discovery of discoveries) {
      const hasWarning = discovery.warning !== null;
      if (hasWarning) warnings.push(discovery.warning);
    }
    const appLists = discoveries.map((discovery) => discovery.apps);
    return {
      apps: mergeDiscoveredApps(appLists),
      warnings,
      attemptedAccountCount: discoveries.length,
      failedAccountLabels: warnings.map((warning) => warning.accountLabel),
    };
  });
