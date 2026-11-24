// Registers the build, storage, credentials, submit, and compute providers that ship with Launch.

import {
  registerBuildEngine,
  registerComputeHost,
  registerCredentialsProvider,
  registerHostedBuildProvider,
  registerStorageProvider,
  registerStorageProviderReader,
  registerSubmitter,
} from '../services/provider-support/registry.ts';
import { makeLocalCredentialsProvider } from './credentials/local.ts';
import { makeLocalStorageProviderReader } from './storage/local.ts';
import { makeXcodeBuildEngine } from './build/xcode.ts';
import { makeGradleBuildEngine } from './build/gradle.ts';
import { easHostedBuildProvider } from './build/expo-application-services.ts';
import { appStoreConnectSubmitter } from './submit/app-store-connect.ts';
import { googlePlaySubmitter } from './submit/google-play.ts';
import { easSubmitter } from './submit/expo-application-services.ts';
import { byoSshComputeHost } from './compute/byo-ssh.ts';

/** Register every provider that ships with Launch. */
export async function registerBuiltins(): Promise<void> {
  const localCredentialsProvider = makeLocalCredentialsProvider();

  registerCredentialsProvider(localCredentialsProvider);

  const localStorageReader = makeLocalStorageProviderReader();

  registerStorageProviderReader(localStorageReader);

  const localStorage = await localStorageReader.readStorageProvider({});

  registerStorageProvider(localStorage);

  const xcodeBuildEngine = makeXcodeBuildEngine();

  registerBuildEngine(xcodeBuildEngine);

  const gradleBuildEngine = makeGradleBuildEngine();

  registerBuildEngine(gradleBuildEngine);
  registerHostedBuildProvider(easHostedBuildProvider);
  registerSubmitter(appStoreConnectSubmitter);
  registerSubmitter(googlePlaySubmitter);
  registerSubmitter(easSubmitter);

  registerComputeHost(byoSshComputeHost);
}
