// Registers the credentials provider that ships with Launch.

import { registerCredentialsProvider } from '../services/provider-support/registry.ts';
import { makeLocalCredentialsProvider } from './credentials/local.ts';

/** Register the on-machine Apple key and Play service account store. */
export async function registerBuiltins(): Promise<void> {
  const localCredentialsProvider = makeLocalCredentialsProvider();

  registerCredentialsProvider(localCredentialsProvider);
}
