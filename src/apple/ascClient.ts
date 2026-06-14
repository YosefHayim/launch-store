/**
 * App Store Connect API client.
 *
 * Authenticates with the App Store Connect API key (the `.p8`) by minting a short-lived ES256 JWT,
 * exactly as Apple's docs require — no password, no 2FA. This one key drives every Apple
 * interaction Launch needs: reading build numbers, and the "Certificates, Identifiers & Profiles"
 * automation (register a bundle id, create a distribution certificate from a CSR, create/download a
 * provisioning profile) that replaces the trips you'd otherwise make through the Developer website.
 *
 * Note Apple's API deliberately has NO endpoint to create a new app *record* — that one step stays
 * in the App Store Connect UI. {@link getAppId} returning null is how Launch detects it's missing.
 *
 * @see https://developer.apple.com/documentation/appstoreconnectapi
 */

import { SignJWT, importPKCS8 } from "jose";
import type { AscKey } from "../core/types.js";
import { highestVersion } from "../core/version.js";
import { withRetry } from "../core/asyncPool.js";

/** Scheme + host of the App Store Connect API; most resources hang off `/v1`, a few newer ones off `/v2`. */
const API_ORIGIN = "https://api.appstoreconnect.apple.com";
const BASE_URL = `${API_ORIGIN}/v1`;
const AUDIENCE = "appstoreconnect-v1";
/** Apple rejects tokens whose lifetime exceeds 20 minutes; stay safely under it. */
const TOKEN_TTL_SECONDS = 19 * 60;

/**
 * Certificate type to create/reuse. `DISTRIBUTION` is Apple's modern unified "Apple Distribution"
 * identity, valid for App Store submission; its codesign identity is named `Apple Distribution`.
 */
export const DISTRIBUTION_CERT_TYPE = "DISTRIBUTION";
/** Codesign identity name that pairs with {@link DISTRIBUTION_CERT_TYPE}. */
export const DISTRIBUTION_CERT_NAME = "Apple Distribution";
/** Provisioning profile type for App Store / TestFlight distribution. */
export const APP_STORE_PROFILE_TYPE = "IOS_APP_STORE";
/** Provisioning profile type for ad-hoc (install-link) distribution to a fixed set of registered devices. */
export const AD_HOC_PROFILE_TYPE = "IOS_APP_ADHOC";
/** Platform value Apple expects when registering a device for ad-hoc distribution. */
const IOS_DEVICE_PLATFORM = "IOS";

/** One App Store Connect API error, as returned in the `errors` array of a failed response. */
interface AscError {
  status: string;
  code: string;
  title: string;
  detail?: string;
}

/**
 * A non-2xx response from the App Store Connect API. Carries the HTTP `status` so callers can tell a
 * transient failure (429 rate-limit, 5xx) apart from a permanent 4xx, while the message preserves
 * Apple's human-readable `detail`. Extends Error, so existing `rejects.toThrow(/…/)` assertions hold.
 */
export class AscRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AscRequestError";
  }
}

/** Whether an error is a transient App Store Connect failure worth retrying (HTTP 429 or any 5xx). */
export function isRetryableAscError(error: unknown): boolean {
  return error instanceof AscRequestError && (error.status === 429 || error.status >= 500);
}

/** A registered Bundle ID resource (an App ID in the Developer portal). */
export interface BundleIdResource {
  id: string;
  identifier: string;
  /** The team's seed/prefix id (e.g. `5NS9ZUMYCS`), which doubles as the Team ID. May be absent. */
  seedId?: string | undefined;
}

/** A signing certificate resource, with the bytes needed to package a `.p12`. */
export interface CertificateResource {
  id: string;
  serialNumber: string;
  /** Base64-encoded DER of the certificate (the `.cer` content). */
  certificateContent: string;
  /** ISO-8601 expiry; used to skip an expired cert when reusing. May be absent. */
  expirationDate?: string | undefined;
}

/** A device registered in the Developer portal, eligible to receive ad-hoc builds. */
export interface DeviceResource {
  id: string;
  /** The device's 40-char (or 25-char, newer) UDID. */
  udid: string;
  /** Human label shown in the portal, e.g. `Dana's iPhone`. */
  name: string;
  /** Apple's status, e.g. `ENABLED` / `DISABLED`. Disabled devices don't count toward an ad-hoc profile. */
  status?: string | undefined;
}

/** A provisioning profile resource, with the bytes needed to install it locally. */
export interface ProfileResource {
  id: string;
  name: string;
  uuid: string;
  /** Base64-encoded `.mobileprovision` contents. */
  profileContent: string;
}

/** A capability enabled on a bundle id (App ID), e.g. `PUSH_NOTIFICATIONS`. */
export interface BundleIdCapabilityResource {
  id: string;
  capabilityType: string;
}

/** An in-app purchase (the `inAppPurchasesV2` resource) on an app. */
export interface InAppPurchaseResource {
  id: string;
  /** Apple product id, the catalog's natural key. */
  productId: string;
  /** Internal reference name. */
  name: string;
  /** `CONSUMABLE` / `NON_CONSUMABLE` / `NON_RENEWING_SUBSCRIPTION`. */
  inAppPurchaseType: string;
  /** Apple's lifecycle state, e.g. `MISSING_METADATA` / `READY_TO_SUBMIT`. Absent unless requested. */
  state?: string;
}

/** A subscription group — the container for mutually-exclusive subscription levels. */
export interface SubscriptionGroupResource {
  id: string;
  referenceName: string;
}

/** One auto-renewable subscription within a group. */
export interface SubscriptionResource {
  id: string;
  productId: string;
  name: string;
  /** Apple's lifecycle state, e.g. `MISSING_METADATA`. Absent unless requested. */
  state?: string;
}

/**
 * One locale's stored copy for a product, group, or subscription. The same shape serves in-app-purchase,
 * subscription, and subscription-group localizations — Apple keys them all on `locale`, with `name`
 * always present and `description` only on the product/subscription variants.
 */
export interface LocalizationResource {
  id: string;
  locale: string;
  name: string;
  description?: string;
}

/**
 * A price point — one rung of Apple's fixed price ladder for a product in a territory. `customerPrice`
 * is the amount the buyer pays (e.g. `"9.99"`); a price is set by linking the product to one of these.
 */
export interface PricePointResource {
  id: string;
  customerPrice: string;
  territory: string;
}

/**
 * A build uploaded to App Store Connect. The release flow reads these so a developer can promote an
 * already-verified TestFlight build instead of re-uploading, and to wait for a fresh upload to finish
 * processing before attaching it to a version.
 */
export interface BuildResource {
  id: string;
  /** Build number — Apple's `version` attribute on a build (the CFBundleVersion). */
  buildNumber: string;
  /** Apple's processing state: `PROCESSING`, `VALID`, or `INVALID`. Only a `VALID` build is submittable. */
  processingState: string;
  /** ISO-8601 instant the build was uploaded. Absent on older builds Apple no longer dates. */
  uploadedDate?: string | undefined;
  /** Whether Apple has expired the build (TestFlight's 90-day limit); an expired build can't be submitted. */
  expired: boolean;
}

/**
 * One App Store version — a single public release moving through its lifecycle (the `appStoreVersions`
 * resource). `appStoreState` is the lifecycle the `release`/`status` flow branches on (editable vs.
 * in-review vs. live).
 */
export interface AppStoreVersionResource {
  id: string;
  /** Marketing version, e.g. `1.4.0` (CFBundleShortVersionString). */
  versionString: string;
  /** Apple's lifecycle state, e.g. `PREPARE_FOR_SUBMISSION`, `WAITING_FOR_REVIEW`, `READY_FOR_SALE`. */
  appStoreState: string;
  /** How the approved build goes live (`AFTER_APPROVAL` / `MANUAL` / `SCHEDULED`). Absent unless requested. */
  releaseType?: string | undefined;
}

/**
 * One locale's editable App Store version copy. The release flow only touches `whatsNew` (the
 * "What's New in This Version" notes); the rest of the listing stays with `launch metadata` (fastlane).
 */
export interface AppStoreVersionLocalizationResource {
  id: string;
  locale: string;
  /** The release-notes text for this version + locale. Absent when unset. */
  whatsNew?: string | undefined;
}

/**
 * A version's phased-release record (`appStoreVersionPhasedRelease`) — Apple's 7-day gradual percentage
 * rollout for an approved update. `launch rollout` steers it via {@link PhasedReleaseResource.phasedReleaseState}.
 */
export interface PhasedReleaseResource {
  id: string;
  /** Apple's state: `INACTIVE`, `ACTIVE`, `PAUSED`, or `COMPLETE`. */
  phasedReleaseState: string;
}

/**
 * A review submission — Apple's modern, batched submit container (`reviewSubmissions`), which replaced
 * the deprecated per-version `appStoreVersionSubmissions`. A version is submitted by adding it as an
 * item then flipping the submission to `submitted`.
 */
export interface ReviewSubmissionResource {
  id: string;
  /** Apple's state, e.g. `READY_FOR_REVIEW` (created, not yet submitted), `WAITING_FOR_REVIEW`, `IN_REVIEW`. */
  state: string;
}

interface ResourceList<A> {
  data: { id: string; attributes: A }[];
}
interface ResourceSingle<A> {
  data: { id: string; attributes: A };
}

/**
 * One page of a paginated collection: the page's `data` plus Apple's `links.next` — an absolute URL
 * to the following page, present only while more pages remain. Consumed by {@link AppStoreConnectClient.requestAll}.
 */
interface PagedList<A> {
  data: { id: string; attributes: A }[];
  links?: { next?: string };
}

/** Client bound to one App Store Connect API key. */
export class AppStoreConnectClient {
  constructor(private readonly key: AscKey) {}

  /** Mint a short-lived bearer token for the API. */
  private async token(): Promise<string> {
    const privateKey = await importPKCS8(this.key.p8, "ES256");
    const issuedAt = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.key.keyId, typ: "JWT" })
      .setIssuer(this.key.issuerId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + TOKEN_TTL_SECONDS)
      .setAudience(AUDIENCE)
      .sign(privateKey);
  }

  /**
   * Issue an authenticated request and parse the JSON body. On failure it surfaces Apple's own
   * error `detail` (e.g. "A required agreement is missing") instead of a bare status code, so the
   * CLI can show an actionable message.
   *
   * `pathOrUrl` is either a path relative to {@link BASE_URL} (e.g. `/devices?limit=200`) or an
   * already-absolute URL — Apple's pagination `links.next` is absolute and already carries `/v1`, so
   * {@link requestAll} passes it through verbatim. Re-prefixing such a URL with BASE_URL is exactly
   * the `/v1/v1/...` double-prefix bug that breaks naive clients once a collection spans pages.
   */
  private async request<T>(method: string, pathOrUrl: string, body?: unknown): Promise<T> {
    // Transparent backoff on Apple's transient failures (429 rate-limit / 5xx). A fresh token is
    // minted per attempt, so a retry that straddles the 19-minute TTL re-signs rather than 401s.
    return withRetry(() => this.requestOnce<T>(method, pathOrUrl, body), { isRetryable: isRetryableAscError });
  }

  /** A single (un-retried) authenticated request — the retry wrapper lives in {@link request}. */
  private async requestOnce<T>(method: string, pathOrUrl: string, body?: unknown): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!response.ok) {
      throw new AscRequestError(
        `App Store Connect ${method} ${pathOrUrl} failed (${response.status}): ${describeErrors(text)}`,
        response.status,
      );
    }
    return JSON.parse(text) as T;
  }

  /** Build an absolute URL for a `/v2` resource — a few newer collections (in-app purchases) live there. */
  private v2(path: string): string {
    return `${API_ORIGIN}/v2${path}`;
  }

  /**
   * GET every page of a paginated collection, following Apple's absolute `links.next` URLs verbatim
   * until the cursor runs out. Apple caps a page at 200 and links the rest; reading only the first
   * page silently truncates large collections (a team's devices, an app's version history), so any
   * "list all" call routes through here rather than a single `limit=200` read.
   */
  // A is the caller-specified attributes shape of the returned rows; no argument infers it, so the param is required.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  private async requestAll<A>(path: string): Promise<{ id: string; attributes: A }[]> {
    const all: { id: string; attributes: A }[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: PagedList<A> = await this.request<PagedList<A>>("GET", next);
      all.push(...page.data);
      next = page.links?.next;
    }
    return all;
  }

  /** Resolve the internal App Store Connect app id for a bundle identifier, or null if no record exists. */
  async getAppId(bundleId: string): Promise<string | null> {
    const { data } = await this.request<ResourceList<{ bundleId: string }>>(
      "GET",
      `/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`,
    );
    return data[0]?.id ?? null;
  }

  /**
   * Return the highest build number already uploaded for an app, or 0 if none exist yet.
   * The caller bumps this by one for the next upload.
   */
  async getLatestBuildNumber(bundleId: string): Promise<number> {
    const appId = await this.getAppId(bundleId);
    if (!appId) return 0;
    const { data } = await this.request<ResourceList<{ version: string }>>(
      "GET",
      `/builds?filter[app]=${appId}&sort=-version&limit=1&fields[builds]=version`,
    );
    const latest = data[0]?.attributes.version;
    const parsed = latest ? Number.parseInt(latest, 10) : 0;
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Return the highest marketing version (`CFBundleShortVersionString`) already on App Store Connect
   * for an app — folding both submitted App Store versions and TestFlight pre-release versions — or
   * null when the app has none yet (or no record exists). The caller suggests the next bump from this,
   * so a developer never silently reuses or guesses a version. Compared numerically (see
   * {@link highestVersion}) rather than trusting Apple's lexical sort, which mis-orders `1.10.0`.
   */
  async getLatestMarketingVersion(bundleId: string): Promise<string | null> {
    const appId = await this.getAppId(bundleId);
    if (!appId) return null;
    const [appStore, preRelease] = await Promise.all([
      this.requestAll<{ versionString: string }>(
        `/apps/${appId}/appStoreVersions?fields[appStoreVersions]=versionString&limit=200`,
      ),
      this.requestAll<{ version: string }>(
        `/apps/${appId}/preReleaseVersions?fields[preReleaseVersions]=version&limit=200`,
      ),
    ]);
    return highestVersion([
      ...appStore.map((entry) => entry.attributes.versionString),
      ...preRelease.map((entry) => entry.attributes.version),
    ]);
  }

  /** Poll a freshly uploaded build's processing state (e.g. `PROCESSING`, `VALID`, `INVALID`). */
  async getBuildProcessingState(bundleId: string, buildNumber: number): Promise<string | null> {
    const appId = await this.getAppId(bundleId);
    if (!appId) return null;
    const { data } = await this.request<ResourceList<{ processingState: string }>>(
      "GET",
      `/builds?filter[app]=${appId}&filter[version]=${buildNumber}&limit=1&fields[builds]=processingState`,
    );
    return data[0]?.attributes.processingState ?? null;
  }

  /** Cheap call that fails with a clear message when the account has an unsigned/expired agreement. */
  async assertReady(): Promise<void> {
    await this.request<ResourceList<unknown>>("GET", "/bundleIds?limit=1");
  }

  /**
   * Resolve this key's Apple Team ID — the bundle-id `seedId`, the only team identifier an API key
   * exposes (there is no org-name endpoint). Null when the account has registered no bundle ids yet.
   */
  async resolveTeamId(): Promise<string | null> {
    const { data } = await this.request<ResourceList<{ seedId?: string }>>(
      "GET",
      "/bundleIds?limit=1&fields[bundleIds]=seedId",
    );
    return data[0]?.attributes.seedId ?? null;
  }

  /**
   * List the names of the apps this key can access — the recognizable signal for telling accounts
   * apart in the picker (an opaque Team ID alone isn't memorable). All pages, names only.
   */
  async listAppNames(): Promise<string[]> {
    const data = await this.requestAll<{ name?: string }>("/apps?fields[apps]=name&limit=200");
    return data.map((entry) => entry.attributes.name).filter((name): name is string => Boolean(name));
  }

  /** Find a registered Bundle ID by its identifier, or null if it isn't registered yet. */
  async findBundleId(identifier: string): Promise<BundleIdResource | null> {
    const { data } = await this.request<ResourceList<{ identifier: string; seedId?: string }>>(
      "GET",
      `/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=1`,
    );
    const first = data[0];
    if (!first) return null;
    return { id: first.id, identifier: first.attributes.identifier, seedId: first.attributes.seedId };
  }

  /** Register a new Bundle ID (App ID) so a build can be signed against it. */
  async createBundleId(identifier: string, name: string): Promise<BundleIdResource> {
    const { data } = await this.request<ResourceSingle<{ identifier: string; seedId?: string }>>("POST", "/bundleIds", {
      data: { type: "bundleIds", attributes: { identifier, name, platform: "IOS" } },
    });
    return { id: data.id, identifier: data.attributes.identifier, seedId: data.attributes.seedId };
  }

  /** List distribution certificates, newest expiry first, for reuse before creating a new one. */
  async listDistributionCertificates(): Promise<CertificateResource[]> {
    const data = await this.requestAll<{ serialNumber: string; certificateContent: string; expirationDate?: string }>(
      `/certificates?filter[certificateType]=${DISTRIBUTION_CERT_TYPE}&limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      serialNumber: entry.attributes.serialNumber,
      certificateContent: entry.attributes.certificateContent,
      expirationDate: entry.attributes.expirationDate,
    }));
  }

  /** Create a distribution certificate from a PEM certificate-signing request. */
  async createCertificate(csrContent: string): Promise<CertificateResource> {
    const { data } = await this.request<
      ResourceSingle<{ serialNumber: string; certificateContent: string; expirationDate?: string }>
    >("POST", "/certificates", {
      data: { type: "certificates", attributes: { csrContent, certificateType: DISTRIBUTION_CERT_TYPE } },
    });
    return {
      id: data.id,
      serialNumber: data.attributes.serialNumber,
      certificateContent: data.attributes.certificateContent,
      expirationDate: data.attributes.expirationDate,
    };
  }

  /** Find a provisioning profile by exact name (Launch names its profiles deterministically). */
  async findProfileByName(name: string): Promise<ProfileResource | null> {
    const { data } = await this.request<ResourceList<{ name: string; uuid: string; profileContent: string }>>(
      "GET",
      `/profiles?filter[name]=${encodeURIComponent(name)}&limit=1`,
    );
    const first = data[0];
    if (!first) return null;
    return {
      id: first.id,
      name: first.attributes.name,
      uuid: first.attributes.uuid,
      profileContent: first.attributes.profileContent,
    };
  }

  /** Create an App Store provisioning profile linking a bundle id to a distribution certificate. */
  async createAppStoreProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
  ): Promise<ProfileResource> {
    const { data } = await this.request<ResourceSingle<{ name: string; uuid: string; profileContent: string }>>(
      "POST",
      "/profiles",
      {
        data: {
          type: "profiles",
          attributes: { name, profileType: APP_STORE_PROFILE_TYPE },
          relationships: {
            bundleId: { data: { type: "bundleIds", id: bundleIdResourceId } },
            certificates: { data: [{ type: "certificates", id: certificateId }] },
          },
        },
      },
    );
    return {
      id: data.id,
      name: data.attributes.name,
      uuid: data.attributes.uuid,
      profileContent: data.attributes.profileContent,
    };
  }

  /** Delete a provisioning profile (used when recreating one after issuing a new certificate). */
  async deleteProfile(id: string): Promise<void> {
    await this.request<unknown>("DELETE", `/profiles/${id}`);
  }

  /**
   * List every registered device, across all pages. An ad-hoc profile must enumerate the devices it
   * covers, and a real team easily exceeds Apple's 200-per-page cap — so this folds the whole
   * collection via {@link requestAll} rather than reading one page (the silent-truncation trap).
   */
  async listDevices(): Promise<DeviceResource[]> {
    const data = await this.requestAll<{ udid: string; name: string; status?: string }>("/devices?limit=200");
    return data.map((entry) => ({
      id: entry.id,
      udid: entry.attributes.udid,
      name: entry.attributes.name,
      status: entry.attributes.status,
    }));
  }

  /** Find a registered device by UDID (case-insensitive — Apple stores UDIDs lower-case), or null. */
  async findDeviceByUdid(udid: string): Promise<DeviceResource | null> {
    const wanted = udid.toLowerCase();
    return (await this.listDevices()).find((device) => device.udid.toLowerCase() === wanted) ?? null;
  }

  /**
   * Register a device so ad-hoc builds can target it. Apple treats a known UDID idempotently (it
   * returns the existing entry rather than erroring), so callers can register-then-include safely.
   */
  async registerDevice(udid: string, name: string): Promise<DeviceResource> {
    const { data } = await this.request<ResourceSingle<{ udid: string; name: string; status?: string }>>(
      "POST",
      "/devices",
      { data: { type: "devices", attributes: { udid, name, platform: IOS_DEVICE_PLATFORM } } },
    );
    return { id: data.id, udid: data.attributes.udid, name: data.attributes.name, status: data.attributes.status };
  }

  /**
   * Create an ad-hoc provisioning profile that ties a bundle id + distribution certificate to an
   * explicit device set — the install-link analog of {@link createAppStoreProfile}. The profile is
   * only valid for the `deviceIds` listed, so it must be recreated whenever the device set changes.
   */
  async createAdHocProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    deviceIds: string[],
  ): Promise<ProfileResource> {
    const { data } = await this.request<ResourceSingle<{ name: string; uuid: string; profileContent: string }>>(
      "POST",
      "/profiles",
      {
        data: {
          type: "profiles",
          attributes: { name, profileType: AD_HOC_PROFILE_TYPE },
          relationships: {
            bundleId: { data: { type: "bundleIds", id: bundleIdResourceId } },
            certificates: { data: [{ type: "certificates", id: certificateId }] },
            devices: { data: deviceIds.map((id) => ({ type: "devices", id })) },
          },
        },
      },
    );
    return {
      id: data.id,
      name: data.attributes.name,
      uuid: data.attributes.uuid,
      profileContent: data.attributes.profileContent,
    };
  }

  /* ------------------------------------------------------------------------ */
  /*  App Store Connect product catalog — capabilities, in-app purchases,      */
  /*  subscriptions, and pricing. Consumed by the `launch sync` reconciler     */
  /*  (core/ascSync.ts); none of this is needed by the build/sign path.        */
  /* ------------------------------------------------------------------------ */

  /** List the capabilities currently enabled on a bundle id (App ID). */
  async listBundleIdCapabilities(bundleIdResourceId: string): Promise<BundleIdCapabilityResource[]> {
    const data = await this.requestAll<{ capabilityType?: string }>(
      `/bundleIds/${bundleIdResourceId}/bundleIdCapabilities?limit=200`,
    );
    return data.flatMap((entry) =>
      entry.attributes.capabilityType ? [{ id: entry.id, capabilityType: entry.attributes.capabilityType }] : [],
    );
  }

  /** Enable a capability on a bundle id. The reconciler only calls this for a capability not already on. */
  async enableCapability(bundleIdResourceId: string, capabilityType: string): Promise<BundleIdCapabilityResource> {
    const { data } = await this.request<ResourceSingle<{ capabilityType?: string }>>("POST", "/bundleIdCapabilities", {
      data: {
        type: "bundleIdCapabilities",
        attributes: { capabilityType },
        relationships: { bundleId: { data: { type: "bundleIds", id: bundleIdResourceId } } },
      },
    });
    return { id: data.id, capabilityType: data.attributes.capabilityType ?? capabilityType };
  }

  /** Disable a capability by its resource id (only reached under `--allow-destructive`). */
  async disableCapability(capabilityId: string): Promise<void> {
    await this.request<unknown>("DELETE", `/bundleIdCapabilities/${capabilityId}`);
  }

  /** List an app's in-app purchases (the `inAppPurchasesV2` collection), across all pages. */
  async listInAppPurchases(appId: string): Promise<InAppPurchaseResource[]> {
    const data = await this.requestAll<{
      productId?: string;
      name?: string;
      inAppPurchaseType?: string;
      state?: string;
    }>(`/apps/${appId}/inAppPurchasesV2?limit=200&fields[inAppPurchases]=productId,name,inAppPurchaseType,state`);
    return data.map((entry) => ({
      id: entry.id,
      productId: entry.attributes.productId ?? "",
      name: entry.attributes.name ?? "",
      inAppPurchaseType: entry.attributes.inAppPurchaseType ?? "",
      ...(entry.attributes.state ? { state: entry.attributes.state } : {}),
    }));
  }

  /** Create an in-app purchase. Note the `/v2` path — IAP creation is one of Apple's few v2 endpoints. */
  async createInAppPurchase(
    appId: string,
    input: { productId: string; name: string; inAppPurchaseType: string },
  ): Promise<InAppPurchaseResource> {
    const { data } = await this.request<
      ResourceSingle<{ productId?: string; name?: string; inAppPurchaseType?: string }>
    >("POST", this.v2("/inAppPurchases"), {
      data: {
        type: "inAppPurchases",
        attributes: { productId: input.productId, name: input.name, inAppPurchaseType: input.inAppPurchaseType },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    });
    return {
      id: data.id,
      productId: data.attributes.productId ?? input.productId,
      name: data.attributes.name ?? input.name,
      inAppPurchaseType: data.attributes.inAppPurchaseType ?? input.inAppPurchaseType,
    };
  }

  /** List the localizations already attached to an in-app purchase. */
  async listInAppPurchaseLocalizations(iapId: string): Promise<LocalizationResource[]> {
    return this.localizationsFrom(`/inAppPurchasesV2/${iapId}/inAppPurchaseLocalizations?limit=200`);
  }

  /** Create one locale's display copy for an in-app purchase. */
  async createInAppPurchaseLocalization(
    iapId: string,
    input: { locale: string; name: string; description?: string },
  ): Promise<LocalizationResource> {
    return this.createLocalization("inAppPurchaseLocalizations", "inAppPurchaseV2", "inAppPurchases", iapId, input);
  }

  /** List an app's subscription groups. */
  async listSubscriptionGroups(appId: string): Promise<SubscriptionGroupResource[]> {
    const data = await this.requestAll<{ referenceName?: string }>(
      `/apps/${appId}/subscriptionGroups?limit=200&fields[subscriptionGroups]=referenceName`,
    );
    return data.flatMap((entry) =>
      entry.attributes.referenceName ? [{ id: entry.id, referenceName: entry.attributes.referenceName }] : [],
    );
  }

  /** Create a subscription group on an app. */
  async createSubscriptionGroup(appId: string, referenceName: string): Promise<SubscriptionGroupResource> {
    const { data } = await this.request<ResourceSingle<{ referenceName?: string }>>("POST", "/subscriptionGroups", {
      data: {
        type: "subscriptionGroups",
        attributes: { referenceName },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    });
    return { id: data.id, referenceName: data.attributes.referenceName ?? referenceName };
  }

  /** List a subscription group's display-name localizations. */
  async listSubscriptionGroupLocalizations(groupId: string): Promise<LocalizationResource[]> {
    return this.localizationsFrom(`/subscriptionGroups/${groupId}/subscriptionGroupLocalizations?limit=200`);
  }

  /** Create one locale's display name for a subscription group (groups carry a name only, no description). */
  async createSubscriptionGroupLocalization(
    groupId: string,
    input: { locale: string; name: string },
  ): Promise<LocalizationResource> {
    return this.createLocalization(
      "subscriptionGroupLocalizations",
      "subscriptionGroup",
      "subscriptionGroups",
      groupId,
      input,
    );
  }

  /** List the subscriptions in a group. */
  async listSubscriptions(groupId: string): Promise<SubscriptionResource[]> {
    const data = await this.requestAll<{ productId?: string; name?: string; state?: string }>(
      `/subscriptionGroups/${groupId}/subscriptions?limit=200&fields[subscriptions]=productId,name,state`,
    );
    return data.map((entry) => ({
      id: entry.id,
      productId: entry.attributes.productId ?? "",
      name: entry.attributes.name ?? "",
      ...(entry.attributes.state ? { state: entry.attributes.state } : {}),
    }));
  }

  /** Create an auto-renewable subscription in a group. */
  async createSubscription(
    groupId: string,
    input: { productId: string; name: string; subscriptionPeriod: string; groupLevel: number },
  ): Promise<SubscriptionResource> {
    const { data } = await this.request<ResourceSingle<{ productId?: string; name?: string }>>(
      "POST",
      "/subscriptions",
      {
        data: {
          type: "subscriptions",
          attributes: {
            productId: input.productId,
            name: input.name,
            subscriptionPeriod: input.subscriptionPeriod,
            groupLevel: input.groupLevel,
          },
          relationships: { group: { data: { type: "subscriptionGroups", id: groupId } } },
        },
      },
    );
    return {
      id: data.id,
      productId: data.attributes.productId ?? input.productId,
      name: data.attributes.name ?? input.name,
    };
  }

  /** List a subscription's display-copy localizations. */
  async listSubscriptionLocalizations(subscriptionId: string): Promise<LocalizationResource[]> {
    return this.localizationsFrom(`/subscriptions/${subscriptionId}/subscriptionLocalizations?limit=200`);
  }

  /** Create one locale's display copy for a subscription. */
  async createSubscriptionLocalization(
    subscriptionId: string,
    input: { locale: string; name: string; description?: string },
  ): Promise<LocalizationResource> {
    return this.createLocalization("subscriptionLocalizations", "subscription", "subscriptions", subscriptionId, input);
  }

  /** Whether a subscription already has at least one price set (so the reconciler skips re-pricing it). */
  async subscriptionHasPrice(subscriptionId: string): Promise<boolean> {
    const { data } = await this.request<ResourceList<unknown>>(
      "GET",
      `/subscriptions/${subscriptionId}/prices?limit=1`,
    );
    return data.length > 0;
  }

  /** Find the subscription price point in `territory` whose customer price equals `customerPrice`, or null. */
  async findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    const points = await this.requestAll<{ customerPrice?: string; territory?: string }>(
      `/subscriptions/${subscriptionId}/pricePoints?filter[territory]=${encodeURIComponent(territory)}&limit=8000`,
    );
    return matchPricePoint(points, territory, customerPrice);
  }

  /** Set a subscription's price by linking it to a resolved price point (effective immediately). */
  async createSubscriptionPrice(subscriptionId: string, pricePointId: string): Promise<void> {
    await this.request<unknown>("POST", "/subscriptionPrices", {
      data: {
        type: "subscriptionPrices",
        attributes: { preserveCurrentPrice: false },
        relationships: {
          subscription: { data: { type: "subscriptions", id: subscriptionId } },
          subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: pricePointId } },
        },
      },
    });
  }

  /** Whether an in-app purchase already has a price schedule (so the reconciler skips re-pricing it). */
  async inAppPurchaseHasPrice(iapId: string): Promise<boolean> {
    try {
      const { data } = await this.request<{ data: { id: string } | null }>(
        "GET",
        `/inAppPurchasesV2/${iapId}/iapPriceSchedule`,
      );
      return data !== null;
    } catch (error) {
      // No schedule yet reads as a 404 on some accounts — that's "unpriced", not a real failure.
      if (error instanceof AscRequestError && error.status === 404) return false;
      throw error;
    }
  }

  /** Find the IAP price point in `territory` whose customer price equals `customerPrice`, or null. */
  async findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    const points = await this.requestAll<{ customerPrice?: string; territory?: string }>(
      this.v2(`/inAppPurchases/${iapId}/pricePoints?filter[territory]=${encodeURIComponent(territory)}&limit=8000`),
    );
    return matchPricePoint(points, territory, customerPrice);
  }

  /**
   * Set an IAP's price by creating a price schedule anchored on a base territory's price point. The
   * relationship references a client-supplied temp id that the `included` price resource carries —
   * the JSON:API pattern Apple requires here — and a `baseTerritory` is mandatory (omitting it returns
   * Apple's `BASE_TERRITORY_INTERVAL_REQUIRED` 409).
   */
  async createInAppPurchasePriceSchedule(iapId: string, baseTerritory: string, pricePointId: string): Promise<void> {
    const priceRef = "launch-base-price";
    await this.request<unknown>("POST", "/inAppPurchasePriceSchedules", {
      data: {
        type: "inAppPurchasePriceSchedules",
        relationships: {
          inAppPurchase: { data: { type: "inAppPurchases", id: iapId } },
          baseTerritory: { data: { type: "territories", id: baseTerritory } },
          manualPrices: { data: [{ type: "inAppPurchasePrices", id: priceRef }] },
        },
      },
      included: [
        {
          type: "inAppPurchasePrices",
          id: priceRef,
          attributes: { startDate: null },
          relationships: {
            inAppPurchaseV2: { data: { type: "inAppPurchases", id: iapId } },
            inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: pricePointId } },
          },
        },
      ],
    });
  }

  /* ------------------------------------------------------------------------ */
  /*  App Store release lifecycle — builds, versions, export compliance,        */
  /*  what's-new, phased release, and the modern review-submission flow.        */
  /*  Consumed by core/appStoreRelease.ts (the `release`/`status`/`rollout`     */
  /*  commands). The build/sign path needs none of this.                       */
  /* ------------------------------------------------------------------------ */

  /**
   * List an app's uploaded builds, newest first, across all pages. The release flow reads this to let a
   * developer promote an already-verified TestFlight build instead of re-uploading. Empty when the app
   * has no record yet. Returns enough to show and filter the picker: number, processing state, upload
   * date, and Apple's expiry flag.
   */
  async listBuilds(bundleId: string): Promise<BuildResource[]> {
    const appId = await this.getAppId(bundleId);
    if (!appId) return [];
    const data = await this.requestAll<{
      version?: string;
      processingState?: string;
      uploadedDate?: string;
      expired?: boolean;
    }>(
      `/builds?filter[app]=${appId}&sort=-version&limit=200&fields[builds]=version,processingState,uploadedDate,expired`,
    );
    return data.map((entry) => ({
      id: entry.id,
      buildNumber: entry.attributes.version ?? "",
      processingState: entry.attributes.processingState ?? "",
      uploadedDate: entry.attributes.uploadedDate,
      expired: entry.attributes.expired ?? false,
    }));
  }

  /**
   * The marketing version (CFBundleShortVersionString) a build belongs to, read from its related
   * pre-release version, or null when it has none. Needed when promoting an existing build: an App Store
   * version's `versionString` must match the build's marketing version for Apple to accept the pairing.
   */
  async getBuildMarketingVersion(buildId: string): Promise<string | null> {
    const { data } = await this.request<{ data: { id: string; attributes: { version?: string } } | null }>(
      "GET",
      `/builds/${buildId}/preReleaseVersion?fields[preReleaseVersions]=version`,
    );
    return data?.attributes.version ?? null;
  }

  /**
   * Set a build's export-compliance answer (`usesNonExemptEncryption`), clearing the "Missing
   * Compliance" block before submission. Done at submit time so a promoted TestFlight build — which
   * never ran a local Launch build — is covered too. See `core/exportCompliance.ts` for how the boolean
   * is resolved.
   */
  async setBuildUsesNonExemptEncryption(buildId: string, usesNonExemptEncryption: boolean): Promise<void> {
    await this.request<unknown>("PATCH", `/builds/${buildId}`, {
      data: { type: "builds", id: buildId, attributes: { usesNonExemptEncryption } },
    });
  }

  /**
   * List an app's App Store versions for one platform, newest first, across all pages. The release
   * state machine reads this to find an editable version to reuse (the idempotent-resume / hotfix path)
   * or to decide a fresh version is needed.
   */
  async listAppStoreVersions(appId: string, platform: string): Promise<AppStoreVersionResource[]> {
    const data = await this.requestAll<{ versionString?: string; appStoreState?: string; releaseType?: string }>(
      `/apps/${appId}/appStoreVersions?filter[platform]=${platform}` +
        `&fields[appStoreVersions]=versionString,appStoreState,releaseType&limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      versionString: entry.attributes.versionString ?? "",
      appStoreState: entry.attributes.appStoreState ?? "",
      releaseType: entry.attributes.releaseType,
    }));
  }

  /** Create a new App Store version for a platform, with its release type (and a scheduled date when set). */
  async createAppStoreVersion(
    appId: string,
    input: { versionString: string; platform: string; releaseType: string; earliestReleaseDate?: string },
  ): Promise<AppStoreVersionResource> {
    const attributes: Record<string, unknown> = {
      platform: input.platform,
      versionString: input.versionString,
      releaseType: input.releaseType,
    };
    if (input.earliestReleaseDate) attributes["earliestReleaseDate"] = input.earliestReleaseDate;
    const { data } = await this.request<
      ResourceSingle<{ versionString?: string; appStoreState?: string; releaseType?: string }>
    >("POST", "/appStoreVersions", {
      data: {
        type: "appStoreVersions",
        attributes,
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    });
    return {
      id: data.id,
      versionString: data.attributes.versionString ?? input.versionString,
      appStoreState: data.attributes.appStoreState ?? "",
      releaseType: data.attributes.releaseType ?? input.releaseType,
    };
  }

  /**
   * Update an existing App Store version's version string, release type, and/or scheduled date. Passing
   * `earliestReleaseDate: null` clears a previously-scheduled date (switching back to MANUAL/AFTER_APPROVAL).
   */
  async updateAppStoreVersion(
    versionId: string,
    input: { versionString?: string; releaseType?: string; earliestReleaseDate?: string | null },
  ): Promise<void> {
    const attributes: Record<string, unknown> = {};
    if (input.versionString !== undefined) attributes["versionString"] = input.versionString;
    if (input.releaseType !== undefined) attributes["releaseType"] = input.releaseType;
    if (input.earliestReleaseDate !== undefined) attributes["earliestReleaseDate"] = input.earliestReleaseDate;
    await this.request<unknown>("PATCH", `/appStoreVersions/${versionId}`, {
      data: { type: "appStoreVersions", id: versionId, attributes },
    });
  }

  /** Attach a build to an App Store version (the version↔build relationship). */
  async selectBuildForVersion(versionId: string, buildId: string): Promise<void> {
    await this.request<unknown>("PATCH", `/appStoreVersions/${versionId}/relationships/build`, {
      data: { type: "builds", id: buildId },
    });
  }

  /** List a version's per-locale editable copy (the release flow reads/writes only `whatsNew`). */
  async listAppStoreVersionLocalizations(versionId: string): Promise<AppStoreVersionLocalizationResource[]> {
    const data = await this.requestAll<{ locale?: string; whatsNew?: string }>(
      `/appStoreVersions/${versionId}/appStoreVersionLocalizations` +
        `?fields[appStoreVersionLocalizations]=locale,whatsNew&limit=200`,
    );
    return data.flatMap((entry) =>
      entry.attributes.locale
        ? [{ id: entry.id, locale: entry.attributes.locale, whatsNew: entry.attributes.whatsNew }]
        : [],
    );
  }

  /** Set one locale's "What's New in This Version" release notes on a version. */
  async updateVersionWhatsNew(localizationId: string, whatsNew: string): Promise<void> {
    await this.request<unknown>("PATCH", `/appStoreVersionLocalizations/${localizationId}`, {
      data: { type: "appStoreVersionLocalizations", id: localizationId, attributes: { whatsNew } },
    });
  }

  /** A version's phased-release record, or null when none has been created for it. */
  async getPhasedRelease(versionId: string): Promise<PhasedReleaseResource | null> {
    const { data } = await this.request<{ data: { id: string; attributes: { phasedReleaseState?: string } } | null }>(
      "GET",
      `/appStoreVersions/${versionId}/appStoreVersionPhasedRelease`,
    );
    return data ? { id: data.id, phasedReleaseState: data.attributes.phasedReleaseState ?? "" } : null;
  }

  /** Start a phased (gradual, 7-day) release for an approved version. */
  async createPhasedRelease(versionId: string): Promise<PhasedReleaseResource> {
    const { data } = await this.request<ResourceSingle<{ phasedReleaseState?: string }>>(
      "POST",
      "/appStoreVersionPhasedReleases",
      {
        data: {
          type: "appStoreVersionPhasedReleases",
          relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
        },
      },
    );
    return { id: data.id, phasedReleaseState: data.attributes.phasedReleaseState ?? "" };
  }

  /** Steer a phased release: `PAUSE`, `ACTIVE` (resume), or `COMPLETE` (release to everyone now). */
  async updatePhasedRelease(phasedReleaseId: string, phasedReleaseState: string): Promise<void> {
    await this.request<unknown>("PATCH", `/appStoreVersionPhasedReleases/${phasedReleaseId}`, {
      data: { type: "appStoreVersionPhasedReleases", id: phasedReleaseId, attributes: { phasedReleaseState } },
    });
  }

  /** Cancel a not-yet-started phased release so an immediate 100% release goes out instead. */
  async deletePhasedRelease(phasedReleaseId: string): Promise<void> {
    await this.request<unknown>("DELETE", `/appStoreVersionPhasedReleases/${phasedReleaseId}`);
  }

  /** List an app's review submissions for a platform (to find an open, not-yet-submitted one to reuse). */
  async listReviewSubmissions(appId: string, platform: string): Promise<ReviewSubmissionResource[]> {
    const data = await this.requestAll<{ state?: string }>(
      `/apps/${appId}/reviewSubmissions?filter[platform]=${platform}&fields[reviewSubmissions]=state,platform&limit=200`,
    );
    return data.map((entry) => ({ id: entry.id, state: entry.attributes.state ?? "" }));
  }

  /** Open a new review submission for an app + platform (the modern batched submit container). */
  async createReviewSubmission(appId: string, platform: string): Promise<ReviewSubmissionResource> {
    const { data } = await this.request<ResourceSingle<{ state?: string }>>("POST", "/reviewSubmissions", {
      data: {
        type: "reviewSubmissions",
        attributes: { platform },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    });
    return { id: data.id, state: data.attributes.state ?? "" };
  }

  /** Add an App Store version to an open review submission as an item. */
  async addReviewSubmissionItem(submissionId: string, versionId: string): Promise<void> {
    await this.request<unknown>("POST", "/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id: submissionId } },
          appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
        },
      },
    });
  }

  /** Submit an open review submission to App Store review (flips `submitted` true). */
  async submitReviewSubmission(submissionId: string): Promise<void> {
    await this.request<unknown>("PATCH", `/reviewSubmissions/${submissionId}`, {
      data: { type: "reviewSubmissions", id: submissionId, attributes: { submitted: true } },
    });
  }

  /** Shared GET → {@link LocalizationResource}[] for any product/subscription/group localization collection. */
  private async localizationsFrom(path: string): Promise<LocalizationResource[]> {
    const data = await this.requestAll<{ locale?: string; name?: string; description?: string }>(path);
    return data.flatMap((entry) =>
      entry.attributes.locale && entry.attributes.name
        ? [
            {
              id: entry.id,
              locale: entry.attributes.locale,
              name: entry.attributes.name,
              ...(entry.attributes.description ? { description: entry.attributes.description } : {}),
            },
          ]
        : [],
    );
  }

  /** Shared POST for any localization resource, parameterized by its type and parent relationship. */
  private async createLocalization(
    resourceType: string,
    relationshipName: string,
    parentType: string,
    parentId: string,
    input: { locale: string; name: string; description?: string },
  ): Promise<LocalizationResource> {
    const { data } = await this.request<ResourceSingle<{ locale?: string; name?: string; description?: string }>>(
      "POST",
      `/${resourceType}`,
      {
        data: {
          type: resourceType,
          attributes: {
            locale: input.locale,
            name: input.name,
            ...(input.description === undefined ? {} : { description: input.description }),
          },
          relationships: { [relationshipName]: { data: { type: parentType, id: parentId } } },
        },
      },
    );
    return {
      id: data.id,
      locale: data.attributes.locale ?? input.locale,
      name: data.attributes.name ?? input.name,
      ...(data.attributes.description ? { description: data.attributes.description } : {}),
    };
  }
}

/**
 * Find the price point whose `customerPrice` equals the desired amount in a territory. Apple returns
 * prices as decimal strings (`"9.99"`); we parse and compare numerically so `"9.99"` matches `9.99`.
 * Returns null when no rung matches — the reconciler turns that into an actionable "no price point for
 * $X" error rather than silently leaving the product unpriced.
 */
function matchPricePoint(
  points: { id: string; attributes: { customerPrice?: string; territory?: string } }[],
  territory: string,
  customerPrice: number,
): PricePointResource | null {
  for (const point of points) {
    const price = point.attributes.customerPrice;
    if (price !== undefined && Number.parseFloat(price) === customerPrice) {
      return { id: point.id, customerPrice: price, territory: point.attributes.territory ?? territory };
    }
  }
  return null;
}

/** Extract Apple's human-readable error detail from a failed-response body, falling back to raw text. */
export function describeErrors(body: string): string {
  try {
    const parsed = JSON.parse(body) as { errors?: AscError[] };
    if (parsed.errors?.length) {
      return parsed.errors.map((e) => e.detail ?? e.title).join("; ");
    }
  } catch {
    /* not JSON — fall through */
  }
  return body.length > 0 ? body : "no response body";
}
