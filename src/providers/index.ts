/**
 * Registers all built-in providers into the registry.
 *
 * The CLI calls {@link registerBuiltins} once at startup. New built-ins are added here; cloud
 * providers that pull heavy SDKs should be registered lazily (dynamic import inside their own
 * `register`) so a local-only run never imports them.
 */

import {
  registerBuildEngine,
  registerCredentialsProvider,
  registerStorageProvider,
  registerSubmitter,
} from "../core/registry.js";
import { localCredentialsProvider } from "./credentials/local.js";
import { localStorageProvider } from "./storage/local.js";
import { fastlaneBuildEngine } from "./build/fastlane.js";
import { appStoreConnectSubmitter } from "./submit/appStoreConnect.js";

/** Register every provider that ships with Launch. */
export function registerBuiltins(): void {
  registerCredentialsProvider(localCredentialsProvider);
  registerStorageProvider(localStorageProvider);
  registerBuildEngine(fastlaneBuildEngine);
  registerSubmitter(appStoreConnectSubmitter);
}
