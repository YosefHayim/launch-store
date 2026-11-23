// Registers and looks up build, storage, credentials, submit, and compute providers by name.

import type {
  BuildEngine,
  ComputeHost,
  CredentialsProvider,
  HostedBuildProvider,
  StorageProvider,
  StorageProviderResolver,
  Submitter,
} from '../../types/providers.ts';

const credentialsProviders = new Map<string, CredentialsProvider>();
const buildEngines = new Map<string, BuildEngine>();
const hostedBuildProviders = new Map<string, HostedBuildProvider>();
const storageProviders = new Map<string, StorageProvider>();
const storageProviderResolvers = new Map<string, StorageProviderResolver>();
const submitters = new Map<string, Submitter>();
const computeHosts = new Map<string, ComputeHost>();

/** Register a credentials provider under its `name`. */
export function registerCredentialsProvider(provider: CredentialsProvider): void {
  credentialsProviders.set(provider.name, provider);
}

/** Register a build engine under its `name`. */
export function registerBuildEngine(engine: BuildEngine): void {
  buildEngines.set(engine.name, engine);
}

/** Register a hosted build provider under its `name`. */
export function registerHostedBuildProvider(provider: HostedBuildProvider): void {
  hostedBuildProviders.set(provider.name, provider);
}

/** Register a storage provider under its `name`. */
export function registerStorageProvider(provider: StorageProvider): void {
  storageProviders.set(provider.name, provider);
}

/** Register a configured storage-provider resolver under its `name`. */
export function registerStorageProviderResolver(resolver: StorageProviderResolver): void {
  storageProviderResolvers.set(resolver.name, resolver);
}

/** Register a submitter under its `name`. */
export function registerSubmitter(submitter: Submitter): void {
  submitters.set(submitter.name, submitter);
}

/** Register a compute host (remote-Mac provisioner) under its `name`. */
export function registerComputeHost(host: ComputeHost): void {
  computeHosts.set(host.name, host);
}

/** A provider lookup failed; the message lists the registered names. */
export type ProviderNotRegistered = Readonly<{
  readonly _tag: 'ProviderNotRegistered';
  readonly kind: string;
  readonly name: string;
  readonly available: readonly string[];
  readonly message: string;
}>;

function makeProviderNotRegistered(fields: {
  kind: string;
  name: string;
  available: readonly string[];
  message: string;
}): ProviderNotRegistered {
  return { _tag: 'ProviderNotRegistered', ...fields };
}

function lookup<Registered>(
  kind: string,
  name: string,
  registry: Map<string, Registered>,
): Registered {
  const found = registry.get(name);

  if (found == null) {
    const names = [...registry.keys()];
    const message = `Unknown ${kind} "${name}". Valid ${kind}s: ${names.join(', ')}.`;
    throw makeProviderNotRegistered({ kind, name, available: names, message });
  }

  return found;
}

export function getCredentialsProvider(name: string) {
  return lookup('credentials provider', name, credentialsProviders);
}

export function getBuildEngine(name: string) {
  return lookup('build engine', name, buildEngines);
}

export function getHostedBuildProvider(name: string) {
  return lookup('hosted build provider', name, hostedBuildProviders);
}

export function getStorageProvider(name: string) {
  return lookup('storage provider', name, storageProviders);
}

export function getStorageProviderResolver(name: string) {
  return lookup('storage provider resolver', name, storageProviderResolvers);
}

export function getSubmitter(name: string) {
  return lookup('submitter', name, submitters);
}

export function getComputeHost(name: string) {
  return lookup('compute host', name, computeHosts);
}
