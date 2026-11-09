import type { FileSystem, Path } from '@effect/platform';
import { Effect, Either } from 'effect';
import { listAccounts } from '../credentials/accounts.js';
import { listStoredAndroidPackages } from '../credentials/androidKeystore.js';
import { loadConfig } from '../config/config.js';
import { loadPortfolioFile } from './portfolioStore.js';
import { errorMessage } from '../services/errorMessage.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
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

const discoverPlay = (
  packageName: string,
): Effect.Effect<AccountDiscovery | null, never, StatsCredentialsShape> =>
  Effect.gen(function* () {
    const credentials = yield* StatsCredentials;
    const reportingClient = yield* credentials.playReportingClient(packageName);
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
    const launchPaths = yield* LaunchPaths;
    const configuredPackagesReply = yield* loadConfig(launchPaths.workingDirectory).pipe(
      Effect.map((configuration) => configuration.apps.flatMap((app) => app.packageName ?? [])),
      Effect.either,
    );
    const savedPackagesReply = yield* loadPortfolioFile().pipe(
      Effect.map(
        (savedPortfolio) => savedPortfolio?.apps.flatMap((app) => app.packageName ?? []) ?? [],
      ),
      Effect.either,
    );
    const storedPackagesReply = yield* listStoredAndroidPackages().pipe(Effect.either);
    const packageSourceReplies: readonly Either.Either<readonly string[], unknown>[] = [
      configuredPackagesReply,
      savedPackagesReply,
      storedPackagesReply,
    ];
    // A source that cannot be read marks Play as failed, so its cached apps are kept, not dropped.
    const packageSourceFailures = packageSourceReplies
      .filter(Either.isLeft)
      .map((failedReply) => failedAccountDiscovery(PLAY_ACCOUNT_LABEL, failedReply.left));
    const packages = new Set<string>(
      packageSourceReplies.filter(Either.isRight).flatMap((readReply) => readReply.right),
    );
    const playDiscoveries = yield* Effect.forEach([...packages], discoverPlay, { concurrency: 1 });
    const discoveries: AccountDiscovery[] = [...appleDiscoveries, ...packageSourceFailures];
    for (const playDiscovery of playDiscoveries)
      if (playDiscovery !== null) discoveries.push(playDiscovery);
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
