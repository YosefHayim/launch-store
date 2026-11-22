import {
  registerBuildEngine,
  registerComputeHost,
  registerCredentialsProvider,
  registerHostedBuildProvider,
  registerStorageProvider,
  registerStorageProviderResolver,
  registerSubmitter,
} from '../services/providerSupport/registry.js';
import { makeLocalCredentialsProvider } from './credentials/local.js';
import { makeLocalStorageProviderResolver } from './storage/local.js';
import { makeS3StorageProviderResolver } from './storage/s3.js';
import { makeSupabaseStorageProviderResolver } from './storage/supabase.js';
import { makeXcodeBuildEngine } from './build/xcode.js';
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
 * The iOS (`xcode`/`app-store-connect`) and Android (`gradle`/`google-play`) engines + submitters are
 * all registered; the pipeline selects the right pair per platform (see `resolveBuildEngineName`).
 */
export async function registerBuiltins(): Promise<void> {
  registerCredentialsProvider(makeLocalCredentialsProvider());

  const localStorageResolver = makeLocalStorageProviderResolver();
  registerStorageProviderResolver(localStorageResolver);
  const localStorage = await localStorageResolver.resolveStorageProvider({});
  registerStorageProvider(localStorage);
  registerStorageProviderResolver(makeS3StorageProviderResolver());
  registerStorageProviderResolver(makeSupabaseStorageProviderResolver());
  registerBuildEngine(makeXcodeBuildEngine());
  registerBuildEngine(makeGradleBuildEngine());
  registerHostedBuildProvider(easHostedBuildProvider);
  registerSubmitter(appStoreConnectSubmitter);
  registerSubmitter(googlePlaySubmitter);
  registerSubmitter(easSubmitter);
  registerComputeHost(makeAwsEc2MacComputeHost());
  registerComputeHost(byoSshComputeHost);
}
