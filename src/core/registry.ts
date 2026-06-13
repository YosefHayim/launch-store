/**
 * The provider registry — Launch's tiny dependency-injection seam.
 *
 * Built-in providers register themselves here at startup; the pipeline then looks one up by the
 * name in `launch.config.ts`. Adding a backend is "implement an interface + call `register*`",
 * with no change to the pipeline. Cloud-heavy providers can be registered lazily so a local-only
 * install never imports their SDKs.
 */

import type { BuildEngine, CredentialsProvider, StorageProvider, Submitter } from "./types.js";

const credentialsProviders = new Map<string, CredentialsProvider>();
const buildEngines = new Map<string, BuildEngine>();
const storageProviders = new Map<string, StorageProvider>();
const submitters = new Map<string, Submitter>();

/** Register a credentials provider under its `name`. */
export function registerCredentialsProvider(provider: CredentialsProvider): void {
  credentialsProviders.set(provider.name, provider);
}

/** Register a build engine under its `name`. */
export function registerBuildEngine(engine: BuildEngine): void {
  buildEngines.set(engine.name, engine);
}

/** Register a storage provider under its `name`. */
export function registerStorageProvider(provider: StorageProvider): void {
  storageProviders.set(provider.name, provider);
}

/** Register a submitter under its `name`. */
export function registerSubmitter(submitter: Submitter): void {
  submitters.set(submitter.name, submitter);
}

/** Look up a registered provider, throwing a clear error listing the available names if missing. */
function lookup<T>(kind: string, name: string, registry: Map<string, T>): T {
  const found = registry.get(name);
  if (!found) {
    const names = [...registry.keys()];
    const available = names.length > 0 ? names.join(", ") : "(none registered)";
    throw new Error(`Unknown ${kind} "${name}". Available: ${available}.`);
  }
  return found;
}

export const getCredentialsProvider = (name: string): CredentialsProvider =>
  lookup("credentials provider", name, credentialsProviders);

export const getBuildEngine = (name: string): BuildEngine => lookup("build engine", name, buildEngines);

export const getStorageProvider = (name: string): StorageProvider => lookup("storage provider", name, storageProviders);

export const getSubmitter = (name: string): Submitter => lookup("submitter", name, submitters);
