/**
 * Registers all built-in providers into the registry.
 *
 * The CLI calls {@link registerBuiltins} once at startup. New built-ins are added here; cloud
 * providers that pull heavy SDKs should be registered lazily (dynamic import inside their own
 * `register`) so a local-only run never imports them.
 */

import {
  registerBuildEngine,
  registerComputeHost,
  registerCredentialsProvider,
  registerStorageProvider,
  registerSubmitter,
} from '../core/registry.js';
import { localCredentialsProvider } from './credentials/local.js';
import { localStorageProvider } from './storage/local.js';
import { fastlaneBuildEngine } from './build/fastlane.js';
import { gradleBuildEngine } from './build/gradle.js';
import { appStoreConnectSubmitter } from './submit/appStoreConnect.js';
import { googlePlaySubmitter } from './submit/googlePlay.js';
import { easSubmitter } from './submit/eas.js';
import { awsEc2MacComputeHost } from './compute/awsEc2Mac.js';
import { byoSshComputeHost } from './compute/byoSsh.js';

/**
 * Register every provider that ships with Launch.
 *
 * The compute hosts and the EAS submitter are cheap to register — the heavy SDKs (AWS, eas-cli) are
 * dynamic-imported inside their methods, so a local-only run that never builds remotely never loads them.
 * The iOS (`fastlane`/`app-store-connect`) and Android (`gradle`/`google-play`) engines + submitters are
 * all registered; the pipeline selects the right pair per platform (see `resolveBuildEngineName`).
 */
export function registerBuiltins(): void {
  registerCredentialsProvider(localCredentialsProvider);
  registerStorageProvider(localStorageProvider);
  registerBuildEngine(fastlaneBuildEngine);
  registerBuildEngine(gradleBuildEngine);
  registerSubmitter(appStoreConnectSubmitter);
  registerSubmitter(googlePlaySubmitter);
  registerSubmitter(easSubmitter);
  registerComputeHost(awsEc2MacComputeHost);
  registerComputeHost(byoSshComputeHost);
}
