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

type DiscoveryRequirements =
  | FileSystem.FileSystem
  | LaunchPathsService
  | Path.Path
  | StatsCredentialsShape;

interface SourceDiscovery {
  readonly accountLabel: string;
  readonly apps: readonly DiscoveredApp[];
  readonly warning: DiscoveryWarning | null;
}

const failedSource = (accountLabel: string, cause: unknown): SourceDiscovery => ({
  accountLabel,
  apps: [],
  warning: { accountLabel, message: errorMessage(cause) },
});

const discoverAppleAccount = (
  account: AccountRecord,
): Effect.Effect<SourceDiscovery, never, StatsCredentialsShape> =>
  Effect.gen(function* () {
    const credentials = yield* StatsCredentials;
    const ascClient = yield* credentials.ascClientForAccount(account.keyId);
    if (ascClient === null) {
      return failedSource(account.label, 'no saved key for this account in the secret store');
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
  }).pipe(Effect.catchAll((cause) => Effect.succeed(failedSource(account.label, cause))));

/** The Play source, or null when no service account is saved (nothing was attempted). */
const discoverPlay = (): Effect.Effect<SourceDiscovery | null, never, StatsCredentialsShape> =>
  Effect.gen(function* () {
    const credentials = yield* StatsCredentials;
    const reportingClient = yield* credentials.playReportingClient();
    if (reportingClient === null) return null;
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
  }).pipe(Effect.catchAll((cause) => Effect.succeed(failedSource(PLAY_ACCOUNT_LABEL, cause))));

/** Ask every saved App Store Connect account and the Play service account which apps they see. */
export const discoverApps = (): Effect.Effect<DiscoveryReport, never, DiscoveryRequirements> =>
  Effect.gen(function* () {
    const accounts = yield* listAccounts();
    const appleSources = yield* Effect.forEach(accounts, discoverAppleAccount, { concurrency: 4 });
    const playSource = yield* discoverPlay();
    const sources: SourceDiscovery[] = [...appleSources];
    if (playSource !== null) sources.push(playSource);
    const warnings: DiscoveryWarning[] = [];
    for (const source of sources) {
      if (source.warning !== null) warnings.push(source.warning);
    }
    return {
      apps: mergeDiscoveredApps(sources.map((source) => source.apps)),
      warnings,
      attemptedSourceCount: sources.length,
      failedAccountLabels: warnings.map((warning) => warning.accountLabel),
    };
  });
