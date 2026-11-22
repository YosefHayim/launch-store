import {
  registerBuildEngine,
  registerComputeHost,
  registerCredentialsProvider,
  registerHostedBuildProvider,
  registerStorageProvider,
  registerStorageProviderResolver,
  registerSubmitter,
} from '../services/provider-support/registry.ts';
import { makeLocalCredentialsProvider } from './credentials/local.ts';
import { makeLocalStorageProviderResolver } from './storage/local.ts';
import { makeS3StorageProviderResolver } from './storage/s3.ts';
import { makeSupabaseStorageProviderResolver } from './storage/supabase.ts';
import { makeXcodeBuildEngine } from './build/xcode.ts';
import { makeGradleBuildEngine } from './build/gradle.ts';
import { easHostedBuildProvider } from './build/eas.ts';
import { appStoreConnectSubmitter } from './submit/app-store-connect.ts';
import { googlePlaySubmitter } from './submit/google-play.ts';
import { easSubmitter } from './submit/eas.ts';
import { makeAwsEc2MacComputeHost } from './compute/aws-ec2-mac.ts';
import { byoSshComputeHost } from './compute/byo-ssh.ts';

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
