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

const BASE_URL = "https://api.appstoreconnect.apple.com/v1";
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

/** One App Store Connect API error, as returned in the `errors` array of a failed response. */
interface AscError {
  status: string;
  code: string;
  title: string;
  detail?: string;
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

/** A provisioning profile resource, with the bytes needed to install it locally. */
export interface ProfileResource {
  id: string;
  name: string;
  uuid: string;
  /** Base64-encoded `.mobileprovision` contents. */
  profileContent: string;
}

interface ResourceList<A> {
  data: { id: string; attributes: A }[];
}
interface ResourceSingle<A> {
  data: { id: string; attributes: A };
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
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
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
      throw new Error(`App Store Connect ${method} ${path} failed (${response.status}): ${describeErrors(text)}`);
    }
    return JSON.parse(text) as T;
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
      this.request<ResourceList<{ versionString: string }>>(
        "GET",
        `/apps/${appId}/appStoreVersions?fields[appStoreVersions]=versionString&limit=200`,
      ),
      this.request<ResourceList<{ version: string }>>(
        "GET",
        `/apps/${appId}/preReleaseVersions?fields[preReleaseVersions]=version&limit=200`,
      ),
    ]);
    return highestVersion([
      ...appStore.data.map((entry) => entry.attributes.versionString),
      ...preRelease.data.map((entry) => entry.attributes.version),
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
    const { data } = await this.request<
      ResourceList<{ serialNumber: string; certificateContent: string; expirationDate?: string }>
    >("GET", `/certificates?filter[certificateType]=${DISTRIBUTION_CERT_TYPE}&limit=200`);
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
