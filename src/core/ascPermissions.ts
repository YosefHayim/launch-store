/**
 * ASC API-key **role preflight** — the diagnostic behind `launch doctor`'s per-feature access matrix.
 *
 * Why this exists: an App Store Connect API key carries exactly one role (Admin, App Manager,
 * Developer, Customer Support, Finance, Sales, Marketing …). A key without the role a feature needs
 * doesn't fail at sign-in — it fails with `403 FORBIDDEN` *deep inside* the operation (you learn the
 * key can't reply to reviews only when `launch reviews respond` blows up mid-flight). Apple exposes
 * **no endpoint to read a key's own role**, so the only reliable check is empirical: attempt a cheap
 * representative read per role-gated feature and classify the outcome. `launch doctor` runs this up
 * front so the developer sees the gaps before a command hits them. (Epic #54, "Auth note".)
 *
 * Design mirrors the other ASC reconciler seams (`core/exportCompliance.ts`, `core/appStoreRelease.ts`):
 * a narrow {@link AscPermissionProbeApi} slice names the exact client reads used as probes, so the
 * classify/format logic is unit-tested against a hand-rolled fake and `AppStoreConnectClient` satisfies
 * it structurally. Every probe is a **read** — the preflight never mutates the account.
 */

import { AscRequestError } from "../apple/ascClient.js";

/**
 * The exact read-only slice of {@link AppStoreConnectClient} the role preflight probes. Each method is
 * one cheap representative read for a distinct role-gated feature cluster; the return value is discarded
 * (only resolve-vs-reject matters), hence `Promise<unknown>`. `AppStoreConnectClient` satisfies this
 * structurally.
 */
export interface AscPermissionProbeApi {
  /** Provisioning & signing — Certificates, Identifiers & Profiles. */
  listDistributionCertificates(): Promise<unknown>;
  /** TestFlight — beta groups & testers. */
  listBetaGroups(appId: string): Promise<unknown>;
  /** App Store release — versions, submission, rollout. */
  listAppStoreVersions(appId: string, platform: string): Promise<unknown>;
  /** In-app purchases & subscriptions. */
  listSubscriptionGroups(appId: string): Promise<unknown>;
  /** Customer reviews — read & respond. */
  listCustomerReviews(appId: string, filters?: { rating?: number; territory?: string }): Promise<unknown>;
  /** Analytics reports. */
  listAnalyticsReportRequests(appId: string, accessType: string): Promise<unknown>;
}

/**
 * Verdict of probing one role-gated feature with the active key:
 * - `available` — the probe read succeeded; the key has the role.
 * - `forbidden` — `403`; the key's role doesn't grant this feature.
 * - `unauthorized` — `401`; the key/issuer/expiry is wrong (an auth problem, not a role one).
 * - `inconclusive` — no app record to probe against, or an unexpected (e.g. network) error.
 */
export type AscPermissionStatus = "available" | "forbidden" | "unauthorized" | "inconclusive";

/** One row of the key-role preflight: a feature, the roles that unlock it, and the probe verdict. */
export interface AscPermissionResult {
  /** Stable feature key, e.g. `"customer-reviews"`. */
  feature: string;
  /** Human label shown in `launch doctor`. */
  label: string;
  /** ASC roles that grant the feature — the actionable hint on a `403`. */
  roles: readonly string[];
  /** Probe outcome. */
  status: AscPermissionStatus;
  /** Context for an `inconclusive` verdict (no app record, or the unexpected error's message). */
  detail?: string;
}

/** A role-gated feature plus the read used to test the active key's access to it. */
interface FeatureProbe {
  feature: string;
  label: string;
  roles: readonly string[];
  /** App-resource probes need a resolved app id; account-wide ones (e.g. certificates) don't. */
  needsApp: boolean;
  run(api: AscPermissionProbeApi, appId: string): Promise<unknown>;
}

/** Apple's platform filter for the App Store version probe — iOS is all `launch` targets today. */
const IOS_PLATFORM = "IOS";

/** Analytics report requests are filtered by access type; `ONGOING` is the standard recurring set. */
const ANALYTICS_ACCESS_TYPE = "ONGOING";

/** The role-gated clusters `launch doctor` probes, each via one cheap existing client read. */
const FEATURE_PROBES: readonly FeatureProbe[] = [
  {
    feature: "provisioning",
    label: "Provisioning & signing (certificates, identifiers, profiles)",
    roles: ["Admin", "App Manager", "Developer"],
    needsApp: false,
    run: (api) => api.listDistributionCertificates(),
  },
  {
    feature: "testflight",
    label: "TestFlight (beta groups & testers)",
    roles: ["Admin", "App Manager"],
    needsApp: true,
    run: (api, appId) => api.listBetaGroups(appId),
  },
  {
    feature: "app-store-release",
    label: "App Store release (versions, submission, rollout)",
    roles: ["Admin", "App Manager"],
    needsApp: true,
    run: (api, appId) => api.listAppStoreVersions(appId, IOS_PLATFORM),
  },
  {
    feature: "monetization",
    label: "In-app purchases & subscriptions",
    roles: ["Admin", "App Manager"],
    needsApp: true,
    run: (api, appId) => api.listSubscriptionGroups(appId),
  },
  {
    feature: "customer-reviews",
    label: "Customer reviews (read & respond)",
    roles: ["Admin", "App Manager", "Customer Support"],
    needsApp: true,
    run: (api, appId) => api.listCustomerReviews(appId),
  },
  {
    feature: "analytics-reports",
    label: "Analytics reports",
    roles: ["Admin", "App Manager", "Developer", "Marketing"],
    needsApp: true,
    run: (api, appId) => api.listAnalyticsReportRequests(appId, ANALYTICS_ACCESS_TYPE),
  },
];

/** Pull the HTTP status off an ASC error; `undefined` for non-HTTP failures (network, parse, …). */
function ascStatus(error: unknown): number | undefined {
  return error instanceof AscRequestError ? error.status : undefined;
}

/** Run one probe and classify the key's access to its feature from the outcome. */
async function classifyProbe(
  probe: FeatureProbe,
  api: AscPermissionProbeApi,
  appId: string,
): Promise<AscPermissionResult> {
  const row = { feature: probe.feature, label: probe.label, roles: probe.roles };
  try {
    await probe.run(api, appId);
    return { ...row, status: "available" };
  } catch (error) {
    const status = ascStatus(error);
    if (status === 403) return { ...row, status: "forbidden" };
    if (status === 401) return { ...row, status: "unauthorized" };
    return { ...row, status: "inconclusive", detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Probe the active key against every role-gated feature and return one verdict per cluster (input order
 * preserved). App-scoped probes are reported `inconclusive` when `appId` is null — there's no app record
 * to read against, which is a "can't tell", not a permission failure. Probes run concurrently
 * (independent reads); each catches its own error, so one failure never sinks the rest.
 */
export async function probeKeyPermissions(
  api: AscPermissionProbeApi,
  appId: string | null,
): Promise<AscPermissionResult[]> {
  return Promise.all(
    FEATURE_PROBES.map((probe) => {
      if (probe.needsApp && appId === null) {
        return Promise.resolve<AscPermissionResult>({
          feature: probe.feature,
          label: probe.label,
          roles: probe.roles,
          status: "inconclusive",
          detail: "no app record to probe",
        });
      }
      return classifyProbe(probe, api, appId ?? "");
    }),
  );
}

/** Render one preflight row as a `launch doctor` line (✓ available / ✗ blocked / • can't tell). */
export function formatPermissionLine(result: AscPermissionResult): string {
  switch (result.status) {
    case "available":
      return `✓ ${result.label}`;
    case "forbidden":
      return `✗ ${result.label} — key lacks the role (needs one of: ${result.roles.join(", ")})`;
    case "unauthorized":
      return `✗ ${result.label} — key unauthorized (401); re-check the key id, issuer id, and expiry`;
    case "inconclusive":
      return `• ${result.label} — couldn't determine${result.detail ? ` (${result.detail})` : ""}`;
  }
}
