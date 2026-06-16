/**
 * Lazy, memoized resolvers for the read-only store clients (App Store Connect + Google Play).
 *
 * `launch plan` / `launch drift` and `launch store doctor` both need the same thing: resolve the active
 * Apple key / Play service account **once**, construct the client, and hand it to several independent
 * readers that each use only the slice they need. This module is that single seam — lifted out of
 * `cli/commands/plan.ts` so the credential-load-and-memoize logic lives in exactly one place and every
 * read-only aggregation layer (plan, readiness, a future `launch mcp`) shares it.
 *
 * Each resolver returns `null` when the account isn't configured, letting a caller emit a skip instead of
 * throwing. The concrete clients structurally satisfy every reader interface (`AscSurfacesApi`,
 * `AscReadinessApi`, `PlayCatalogApi`, `PlayReadinessApi`), so a caller assigns a resolver to a field
 * typed to the narrow slice it needs with no cast — function return-type covariance does the rest.
 */

import { loadActiveAscKey } from "./accounts.js";
import { AppStoreConnectClient } from "../apple/ascClient.js";
import { GooglePlayClient, parseServiceAccount } from "../google/playClient.js";
import { loadServiceAccount } from "../google/credentials.js";

/**
 * A memoized App Store Connect resolver: on first call it loads the active Apple key and constructs the
 * client (or resolves `null` when no account is active), then caches that result for every later call so
 * sibling readers share one client and one credential read. `undefined` is the "not yet resolved" sentinel
 * — distinct from a resolved `null` — so a genuinely unconfigured account is cached, not re-probed.
 */
export function createAscClientResolver(): () => Promise<AppStoreConnectClient | null> {
  let cached: AppStoreConnectClient | null | undefined;
  return async () => {
    if (cached === undefined) {
      const ascKey = await loadActiveAscKey();
      cached = ascKey ? new AppStoreConnectClient(ascKey) : null;
    }
    return cached;
  };
}

/**
 * A memoized Google Play resolver, mirroring {@link createAscClientResolver}: loads the service-account
 * JSON once and constructs the client (or resolves `null` when none is configured), caching the result.
 */
export function createPlayClientResolver(): () => Promise<GooglePlayClient | null> {
  let cached: GooglePlayClient | null | undefined;
  return async () => {
    if (cached === undefined) {
      const json = await loadServiceAccount();
      cached = json ? new GooglePlayClient(parseServiceAccount(json)) : null;
    }
    return cached;
  };
}
