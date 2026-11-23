// Registers the build, storage, credentials, submit, and compute providers that ship with Launch.

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
import { easHostedBuildProvider } from './build/expo-application-services.ts';
import { appStoreConnectSubmitter } from './submit/app-store-connect.ts';
import { googlePlaySubmitter } from './submit/google-play.ts';
import { easSubmitter } from './submit/expo-application-services.ts';
import { makeAwsEc2MacComputeHost } from './compute/aws-ec2-mac.ts';
import { byoSshComputeHost } from './compute/byo-ssh.ts';

/** Register every provider that ships with Launch. */
export async function registerBuiltins(): Promise<void> {
  const localCredentialsProvider = makeLocalCredentialsProvider();

  registerCredentialsProvider(localCredentialsProvider);

  const localStorageResolver = makeLocalStorageProviderResolver();

  registerStorageProviderResolver(localStorageResolver);

  const localStorage = await localStorageResolver.resolveStorageProvider({});

  registerStorageProvider(localStorage);

  const s3StorageProviderResolver = makeS3StorageProviderResolver();

  registerStorageProviderResolver(s3StorageProviderResolver);

  const supabaseStorageProviderResolver = makeSupabaseStorageProviderResolver();

  registerStorageProviderResolver(supabaseStorageProviderResolver);

  const xcodeBuildEngine = makeXcodeBuildEngine();

  registerBuildEngine(xcodeBuildEngine);

  const gradleBuildEngine = makeGradleBuildEngine();

  registerBuildEngine(gradleBuildEngine);
  registerHostedBuildProvider(easHostedBuildProvider);
  registerSubmitter(appStoreConnectSubmitter);
  registerSubmitter(googlePlaySubmitter);
  registerSubmitter(easSubmitter);

  const awsEc2MacComputeHost = makeAwsEc2MacComputeHost();

  registerComputeHost(awsEc2MacComputeHost);
  registerComputeHost(byoSshComputeHost);
}
