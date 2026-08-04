import {
  registerBuildEngine,
  registerComputeHost,
  registerCredentialsProvider,
  registerHostedBuildProvider,
  registerStorageProvider,
  registerStorageProviderResolver,
  registerSubmitter,
} from '../core/services/registry.js';
import { Effect } from 'effect';
import { ArtifactRetentionLive } from '../core/services/artifactRetention.js';
import { LocalCredentialsStoreLive } from '../core/services/localCredentialsStore.js';
import { makeLocalCredentialsProvider } from './credentials/local.js';
import { makeLocalStorageProviderResolver } from './storage/local.js';
import { makeS3StorageProviderResolver } from './storage/s3.js';
import { makeSupabaseStorageProviderResolver } from './storage/supabase.js';
import { makeFastlaneBuildEngine } from './build/fastlane.js';
import { makeGradleBuildEngine } from './build/gradle.js';
import { easHostedBuildProvider } from './build/eas.js';
import { appStoreConnectSubmitter } from './submit/appStoreConnect.js';
import { googlePlaySubmitter } from './submit/googlePlay.js';
import { easSubmitter } from './submit/eas.js';
import { makeAwsEc2MacComputeHost } from './compute/awsEc2Mac.js';
import { byoSshComputeHost } from './compute/byoSsh.js';
/**
 * Register every provider that ships with Launch.
 *
 * The compute hosts and the EAS submitter are cheap to register - the heavy SDKs (AWS, eas-cli) are
 * dynamic-imported inside their methods, so a local-only run that never builds remotely never loads them.
 * The iOS (`fastlane`/`app-store-connect`) and Android (`gradle`/`google-play`) engines + submitters are
 * all registered; the pipeline selects the right pair per platform (see `resolveBuildEngineName`).
 */
export const registerBuiltins = () =>
  Effect.gen(function* () {
    registerCredentialsProvider(
      yield* makeLocalCredentialsProvider().pipe(Effect.provide(LocalCredentialsStoreLive)),
    );
    const localStorageResolver = yield* makeLocalStorageProviderResolver().pipe(
      Effect.provide(ArtifactRetentionLive),
    );
    registerStorageProviderResolver(localStorageResolver);
    registerStorageProvider(yield* localStorageResolver.resolveStorageProvider({}));
    registerStorageProviderResolver(yield* makeS3StorageProviderResolver());
    registerStorageProviderResolver(yield* makeSupabaseStorageProviderResolver());
    registerBuildEngine(yield* makeFastlaneBuildEngine());
    registerBuildEngine(yield* makeGradleBuildEngine());
    registerHostedBuildProvider(easHostedBuildProvider);
    registerSubmitter(appStoreConnectSubmitter);
    registerSubmitter(googlePlaySubmitter);
    registerSubmitter(easSubmitter);
    registerComputeHost(yield* makeAwsEc2MacComputeHost());
    registerComputeHost(byoSshComputeHost);
  });
