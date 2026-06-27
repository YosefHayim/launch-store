/**
 * Wire {@link inspectDoctor}'s impure inputs to real I/O.
 *
 * {@link inspectDoctor} (`core/doctor/inspect.ts`) is a pure read — every side-effecting input it needs
 * arrives through a {@link DoctorContext}. This builder is the production wiring of that seam: PATH probes
 * via `core/exec`, the memoized store-client resolvers from `core/storeClients`, the keychain query, and
 * the local credentials status. It lives in `core` (not the CLI) so both `launch doctor` and the `doctor`
 * MCP tool construct an identical context from one place — the CLI no longer owns this glue. A test builds
 * its own fake {@link DoctorContext} instead of calling this, so the network/keychain stays untouched.
 *
 * `core` importing the local credentials *provider* by value mirrors `core/storage.ts` importing the
 * storage providers — an allowed direction; only the inspect *core* must stay provider-free (it takes the
 * status as an injected thunk).
 */

import { capture, exists } from '../exec.js';
import { hostOs } from '../os.js';
import { loadConfig } from '../config.js';
import { createAscClientResolver, createPlayClientResolver } from '../storeClients.js';
import { localCredentialsProvider } from '../../providers/credentials/local.js';
import type { DoctorContext, DoctorPlatform } from './types.js';

/**
 * Build the production {@link DoctorContext} for a platform. The store resolvers' concrete clients
 * structurally satisfy the narrow {@link import("./types.js").DoctorAscApi}/`DoctorPlayApi` surfaces, so
 * they assign with no cast (return-type covariance). `androidSdk` is added only when one of the SDK env
 * vars is set, to honor the exact-optional-property contract.
 */
export async function buildDoctorContext(platform: DoctorPlatform): Promise<DoctorContext> {
  const { config, apps } = await loadConfig();
  const sdk = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'];
  return {
    config,
    apps,
    platform,
    os: hostOs(),
    cwd: process.cwd(),
    exists,
    resolveAsc: createAscClientResolver(),
    resolvePlay: createPlayClientResolver(),
    credentialsStatus: () => localCredentialsProvider.status(),
    corepackAvailable: () => exists('corepack'),
    codesignIdentities: async () => {
      try {
        return await capture('security', ['find-identity', '-v', '-p', 'codesigning']);
      } catch {
        return null;
      }
    },
    ...(sdk ? { androidSdk: sdk } : {}),
  };
}
