import type {
  BuildEngine,
  ComputeHost,
  CredentialsProvider,
  HostedBuildProvider,
  StorageProvider,
  StorageProviderResolver,
  Submitter,
} from '../types/providers.js';
import { Data, Effect } from 'effect';
const credentialsProviders = new Map<string, CredentialsProvider>();
const buildEngines = new Map<string, BuildEngine>();
const hostedBuildProviders = new Map<string, HostedBuildProvider>();
const storageProviders = new Map<string, StorageProvider>();
const storageProviderResolvers = new Map<string, StorageProviderResolver>();
const submitters = new Map<string, Submitter>();
const computeHosts = new Map<string, ComputeHost>();
/** Register a credentials provider under its `name`. */
export const registerCredentialsProvider = (provider: CredentialsProvider): void => {
  credentialsProviders.set(provider.name, provider);
};
/** Register a build engine under its `name`. */
export const registerBuildEngine = (engine: BuildEngine): void => {
  buildEngines.set(engine.name, engine);
};
/** Register a hosted build provider under its `name`. */
export const registerHostedBuildProvider = (provider: HostedBuildProvider): void => {
  hostedBuildProviders.set(provider.name, provider);
};
/** Register a storage provider under its `name`. */
export const registerStorageProvider = (provider: StorageProvider): void => {
  storageProviders.set(provider.name, provider);
};
/** Register a configured storage-provider resolver under its `name`. */
export const registerStorageProviderResolver = (resolver: StorageProviderResolver): void => {
  storageProviderResolvers.set(resolver.name, resolver);
};
/** Register a submitter under its `name`. */
export const registerSubmitter = (submitter: Submitter): void => {
  submitters.set(submitter.name, submitter);
};
/** Register a compute host (remote-Mac provisioner) under its `name`. */
export const registerComputeHost = (host: ComputeHost): void => {
  computeHosts.set(host.name, host);
};
/** Look up a registered provider, throwing a clear error listing the available names if missing. */
export type ProviderNotRegistered = Readonly<{
  readonly _tag: 'ProviderNotRegistered';
  readonly kind: string;
  readonly name: string;
  readonly available: readonly string[];
}>;
export const makeProviderNotRegistered =
  Data.tagged<ProviderNotRegistered>('ProviderNotRegistered');
const lookup = <T>(
  kind: string,
  name: string,
  registry: Map<string, T>,
): Effect.Effect<T, ProviderNotRegistered> => {
  const found = registry.get(name);
  if (!found) {
    const names = [...registry.keys()];
    return Effect.fail(makeProviderNotRegistered({ kind, name, available: names }));
  }
  return Effect.succeed(found);
};
export const getCredentialsProvider = (name: string) =>
  lookup('credentials provider', name, credentialsProviders);
export const getBuildEngine = (name: string) => lookup('build engine', name, buildEngines);
export const getHostedBuildProvider = (name: string) =>
  lookup('hosted build provider', name, hostedBuildProviders);
export const getStorageProvider = (name: string) =>
  lookup('storage provider', name, storageProviders);
export const getStorageProviderResolver = (name: string) =>
  lookup('storage provider resolver', name, storageProviderResolvers);
export const getSubmitter = (name: string) => lookup('submitter', name, submitters);
export const getComputeHost = (name: string) => lookup('compute host', name, computeHosts);
