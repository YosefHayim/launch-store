/**
 * Apple signing-credential automation — the "manage your own keys, locally" engine.
 *
 * This is the leg of EAS Build that Launch replaces without a subscription: it registers the App
 * ID, creates (or reuses) a distribution certificate, and creates (or reuses) the matching App
 * Store provisioning profile — all through the official App Store Connect API, so you almost never
 * open the Apple Developer website.
 *
 * Security model: the certificate's private key is generated locally (`openssl`), so only a CSR
 * ever leaves the machine. The signed key+cert is imported into the login Keychain (so `xcodebuild`
 * can sign) AND backed up as a password-protected `.p12` under `~/.launch/credentials` (chmod 600);
 * the `.p12` password lives in the Keychain, never beside the file. Reuse-first throughout, because
 * Apple caps distribution certificates at ~2–3 and a wasted slot is painful to recover.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AscKey, SigningAssets } from "../core/types.js";
import type { Logger } from "../core/logger.js";
import { capture } from "../core/exec.js";
import { getSecret, setSecret } from "../core/keychain.js";
import { CREDENTIALS_INDEX, PROVISIONING_PROFILES_DIR, accountCredentialsDir, ensureDir } from "../core/paths.js";
import {
  AppStoreConnectClient,
  DISTRIBUTION_CERT_NAME,
  type CertificateResource,
  type ProfileResource,
} from "./ascClient.js";

/**
 * Keychain account holding the random password that protects an account's `.p12` backup, namespaced
 * by Key ID so each Apple account's `.p12` has its own password. Exported so first-run migration can
 * rename the legacy single-account entry (`dist-cert-p12-password`) onto this scheme.
 */
export function p12PasswordAccount(keyId: string): string {
  return `dist-cert-p12-password:${keyId}`;
}
/** Apple's distribution-certificate cap; creating past it fails, so warn first. */
const DISTRIBUTION_CERT_CAP = 2;

/** Persisted record of the distribution certificate Launch created and backed up. */
interface CertRecord {
  /** App Store Connect certificate resource id. */
  id: string;
  /** Certificate serial number (matched against the live list to confirm it still exists). */
  serial: string;
  /** Absolute path to the password-protected `.p12` backup. */
  p12Path: string;
}

/** Persisted record of one bundle's App Store provisioning profile. */
interface ProfileRecord {
  id: string;
  uuid: string;
  name: string;
  /** Absolute path to the backed-up `.mobileprovision`. */
  path: string;
  teamId: string;
}

/** On-disk credential metadata (`~/.launch/credentials/index.json`). No secrets — paths + ids only. */
interface CredentialsIndex {
  certificate?: CertRecord;
  profiles: Record<string, ProfileRecord>;
}

/** Inputs for {@link ensureSigningCredentials}. */
export interface EnsureSigningOptions {
  /** Bundle identifier to provision (e.g. `com.loopi.pomedero`). */
  bundleId: string;
  /** App handle, used to name the App ID when registering it. */
  appName: string;
  /** The resolved App Store Connect API key. */
  ascKey: AscKey;
  log: Logger;
  /** Rehearse only: log every action, touch nothing (no network, no openssl, no Keychain). */
  dryRun: boolean;
  /** Confirm before creating a real, rate-limited Apple resource. Return false to abort. */
  confirmCreate: (message: string) => Promise<boolean>;
}

/** Summarize what signing material is cached locally for one account, for `launch creds status`. */
export function describeStoredCredentials(keyId: string): { certSerial: string | null; bundleIds: string[] } {
  const index = readIndex(keyId);
  return { certSerial: index.certificate?.serial ?? null, bundleIds: Object.keys(index.profiles) };
}

/** Absolute path to one account's signing index. */
function indexPath(keyId: string): string {
  return join(accountCredentialsDir(keyId), "index.json");
}

/** Read an account's credentials index, tolerating a missing or malformed file. */
function readIndex(keyId: string): CredentialsIndex {
  const path = indexPath(keyId);
  if (!existsSync(path)) return { profiles: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CredentialsIndex>;
    return { profiles: parsed.profiles ?? {}, ...(parsed.certificate ? { certificate: parsed.certificate } : {}) };
  } catch {
    return { profiles: {} };
  }
}

/** Write an account's credentials index back to disk. */
function writeIndex(keyId: string, index: CredentialsIndex): void {
  ensureDir(accountCredentialsDir(keyId));
  writeFileSync(indexPath(keyId), JSON.stringify(index, null, 2));
}

/** Pull a single `<key>…</key><string>…</string>` value out of a provisioning profile's plist XML. */
function plistString(xml: string, key: string): string | null {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(xml);
  return match?.[1] ?? null;
}

/** Pull the first entry of a `<key>…</key><array><string>…</string>` value (e.g. TeamIdentifier). */
function plistFirstArrayString(xml: string, key: string): string | null {
  const match = new RegExp(`<key>${key}</key>\\s*<array>\\s*<string>([^<]+)</string>`).exec(xml);
  return match?.[1] ?? null;
}

/**
 * Return cached signing assets for a bundle id without any network call — the build's silent-reuse
 * path. Null if anything is missing (no cert backup, no installed profile), which tells the caller
 * to run setup. Verifies the files actually exist, not just that metadata mentions them.
 */
export function loadCachedSigningAssets(keyId: string, bundleId: string): SigningAssets | null {
  const index = readIndex(keyId);
  const cert = index.certificate;
  const profile = index.profiles[bundleId];
  if (!cert || !profile) return null;
  const installedProfile = join(PROVISIONING_PROFILES_DIR, `${profile.uuid}.mobileprovision`);
  if (!existsSync(cert.p12Path) || !existsSync(installedProfile)) return null;
  return {
    bundleId,
    teamId: profile.teamId,
    certName: DISTRIBUTION_CERT_NAME,
    certSerial: cert.serial,
    profileName: profile.name,
    profileUuid: profile.uuid,
    profilePath: installedProfile,
  };
}

/** Generate an RSA private key + certificate-signing request locally; returns the key path and CSR PEM. */
async function generateKeypairAndCsr(dir: string): Promise<{ keyPath: string; csrPem: string }> {
  const keyPath = join(dir, "dist.key");
  const csrPath = join(dir, "dist.csr");
  await capture("openssl", [
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    csrPath,
    "-subj",
    "/CN=Launch Distribution/O=Launch/C=US",
  ]);
  return { keyPath, csrPem: readFileSync(csrPath, "utf8") };
}

/** Package the signed certificate + private key into a password-protected `.p12` backup. */
async function packageP12(
  dir: string,
  keyPath: string,
  certBase64: string,
  p12Path: string,
  password: string,
): Promise<void> {
  const cerPath = join(dir, "dist.cer");
  const certPemPath = join(dir, "dist.crt.pem");
  writeFileSync(cerPath, Buffer.from(certBase64, "base64"));
  await capture("openssl", ["x509", "-inform", "DER", "-in", cerPath, "-out", certPemPath]);
  await capture("openssl", [
    "pkcs12",
    "-export",
    "-inkey",
    keyPath,
    "-in",
    certPemPath,
    "-out",
    p12Path,
    "-passout",
    `pass:${password}`,
    "-name",
    DISTRIBUTION_CERT_NAME,
  ]);
  chmodSync(p12Path, 0o600);
}

/** Import a `.p12` into the login Keychain, pre-authorizing codesign. Ignores an already-present item. */
async function importP12(p12Path: string, password: string): Promise<void> {
  try {
    await capture("security", [
      "import",
      p12Path,
      "-P",
      password,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
      "-f",
      "pkcs12",
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) throw error;
  }
}

/** Decode an installed profile to read its UUID, name, and Team ID (Xcode's manual-signing inputs). */
async function readProfileMetadata(
  profilePath: string,
): Promise<{ uuid: string; name: string; teamId: string | null }> {
  const xml = await capture("security", ["cms", "-D", "-i", profilePath]);
  const uuid = plistString(xml, "UUID");
  const name = plistString(xml, "Name");
  if (!uuid || !name) throw new Error(`Could not read UUID/Name from provisioning profile at ${profilePath}.`);
  return { uuid, name, teamId: plistFirstArrayString(xml, "TeamIdentifier") };
}

/** Decode the base64 profile content, install it where Xcode looks, and back it up per-account. */
async function installProfile(
  keyId: string,
  bundleId: string,
  profileContent: string,
): Promise<{ uuid: string; name: string; teamId: string | null; installedPath: string }> {
  const backupPath = join(ensureDir(accountCredentialsDir(keyId)), `${bundleId}.mobileprovision`);
  writeFileSync(backupPath, Buffer.from(profileContent, "base64"));
  const { uuid, name, teamId } = await readProfileMetadata(backupPath);
  ensureDir(PROVISIONING_PROFILES_DIR);
  const installedPath = join(PROVISIONING_PROFILES_DIR, `${uuid}.mobileprovision`);
  copyFileSync(backupPath, installedPath);
  return { uuid, name, teamId, installedPath };
}

/** Get (or create + persist) the random password that protects one account's `.p12` backup. */
async function p12Password(keyId: string): Promise<string> {
  const account = p12PasswordAccount(keyId);
  const existing = await getSecret(account);
  if (existing) return existing;
  const password = randomBytes(24).toString("hex");
  await setSecret(account, password);
  return password;
}

/** A SigningAssets stand-in for `--dry-run`, so the rest of the pipeline can run unchanged. */
function dryRunAssets(bundleId: string): SigningAssets {
  return {
    bundleId,
    teamId: "DRYRUNTEAM",
    certName: DISTRIBUTION_CERT_NAME,
    certSerial: "DRYRUN000000",
    profileName: `Launch_${bundleId}_AppStore`,
    profileUuid: "00000000-0000-0000-0000-000000000000",
    profilePath: join(PROVISIONING_PROFILES_DIR, "dry-run.mobileprovision"),
  };
}

/**
 * Resolve a bundle's signing assets, reusing what already exists and creating only what's missing.
 *
 * Order: ensure the App ID is registered → ensure a usable distribution certificate (reuse the
 * cached one if it still exists on Apple, else create a fresh key/CSR/cert) → ensure the App Store
 * profile (reuse by name, or recreate when a new cert was issued). Every creation is gated by
 * {@link EnsureSigningOptions.confirmCreate}. Idempotent: a second run with everything in place
 * performs no writes and no creations.
 */
export async function ensureSigningCredentials(options: EnsureSigningOptions): Promise<SigningAssets> {
  const { bundleId, appName, ascKey, log, dryRun, confirmCreate } = options;

  if (dryRun) {
    log.info(`[dry-run] would ensure App ID, distribution certificate, and App Store profile for ${bundleId}`);
    return dryRunAssets(bundleId);
  }

  const keyId = ascKey.keyId;
  const client = new AppStoreConnectClient(ascKey);
  const index = readIndex(keyId);

  // 1. App ID must be registered before a profile can reference it.
  let bundle = await client.findBundleId(bundleId);
  if (!bundle) {
    if (!(await confirmCreate(`Register App ID "${bundleId}" in your Apple account?`))) {
      throw new Error(
        `App ID ${bundleId} is not registered. Re-run and confirm, or register it in the Developer portal.`,
      );
    }
    bundle = await client.createBundleId(bundleId, appName);
    log.step("app id", `registered ${bundleId}`, "bundle-id");
  } else {
    log.step("app id", `${bundleId} already registered`, "bundle-id");
  }

  // 2. Distribution certificate: reuse the cached one if Apple still lists it, else create one.
  const liveCerts = await client.listDistributionCertificates();
  const password = await p12Password(keyId);
  const reusable = reusableCertificate(index, liveCerts);
  let cert: CertRecord;
  let freshCert = false;
  if (reusable) {
    cert = reusable;
    await importP12(cert.p12Path, password);
    log.step("certificate", `reusing distribution cert ${cert.serial}`, "distribution-certificate");
  } else {
    if (liveCerts.length >= DISTRIBUTION_CERT_CAP) {
      log.warn(
        `Apple already has ${liveCerts.length} distribution certificate(s) and none are Launch's. ` +
          `If creation fails, revoke an unused one in the Developer portal (Apple caps these).`,
      );
    }
    if (!(await confirmCreate("Create a new distribution certificate (generates a private key on this Mac)?"))) {
      throw new Error("No usable distribution certificate. Re-run and confirm to create one.");
    }
    cert = await createAndStoreCertificate(client, password, keyId);
    freshCert = true;
    index.certificate = cert;
    writeIndex(keyId, index);
    log.step("certificate", `created distribution cert ${cert.serial}`, "distribution-certificate");
  }

  // 3. App Store profile: reuse by name unless we just minted a new cert (then recreate to match it).
  // Space-free name so it passes safely through xcodebuild's PROVISIONING_PROFILE_SPECIFIER setting.
  const profileName = `Launch_${bundleId}_AppStore`;
  const existingProfile = await client.findProfileByName(profileName);
  let profile: ProfileResource;
  if (existingProfile && !freshCert) {
    profile = existingProfile;
    log.step("profile", `reusing ${profileName}`, "provisioning-profile");
  } else {
    if (existingProfile) await client.deleteProfile(existingProfile.id);
    profile = await client.createAppStoreProfile(profileName, bundle.id, cert.id);
    log.step("profile", `created ${profileName}`, "provisioning-profile");
  }

  const installed = await installProfile(keyId, bundleId, profile.profileContent);
  const teamId = installed.teamId ?? bundle.seedId ?? "";
  index.profiles[bundleId] = {
    id: profile.id,
    uuid: installed.uuid,
    name: installed.name,
    path: installed.installedPath,
    teamId,
  };
  writeIndex(keyId, index);

  return {
    bundleId,
    teamId,
    certName: DISTRIBUTION_CERT_NAME,
    certSerial: cert.serial,
    profileName: installed.name,
    profileUuid: installed.uuid,
    profilePath: installed.installedPath,
  };
}

/**
 * Local files + identifiers needed to sign on a REMOTE Mac, produced by {@link ensureRemoteSigningAssets}.
 *
 * The remote pipeline uploads `p12Path` and `profilePath` (plus the API `.p8`) into a throwaway
 * keychain on the host; `p12Password` unlocks the `.p12` there. `teamId`/`profileName`/`certName` feed
 * the host's manual-signing export options. The remote Mac re-reads the profile's UUID itself, so it
 * isn't carried here. Distinct from {@link SigningAssets} (which assumes a locally-installed profile).
 */
export interface RemoteSigningBundle {
  bundleId: string;
  /** Codesign identity name, e.g. `Apple Distribution`. */
  certName: string;
  /** Serial of the distribution certificate (for logging/reuse). */
  certSerial: string;
  /** Apple Developer Team ID (from the App ID's seed id). */
  teamId: string;
  /** Deterministic App Store profile name Launch creates. */
  profileName: string;
  /** Absolute local path to the password-protected `.p12` to upload. */
  p12Path: string;
  /** Password that unlocks the `.p12` (from the OS secret store). */
  p12Password: string;
  /** Absolute local path to the `.mobileprovision` bytes to upload. */
  profilePath: string;
}

/**
 * Resolve a bundle's signing assets for a REMOTE (off-Mac) build, leaving local files to upload.
 *
 * The cross-platform twin of {@link ensureSigningCredentials}: it ensures the same Apple resources
 * over the API and packages the distribution `.p12` locally with openssl (decision 7 — the private
 * key is born on your machine, never on rented infra), but it does NOT import anything into a local
 * codesign keychain or install the profile where a local Xcode looks — there is none. The remote Mac
 * imports the `.p12` into a throwaway keychain and reads the profile itself. Touches only the ASC API
 * and openssl, so it runs on Windows/Linux.
 */
export async function ensureRemoteSigningAssets(options: EnsureSigningOptions): Promise<RemoteSigningBundle> {
  const { bundleId, appName, ascKey, log, dryRun, confirmCreate } = options;

  if (dryRun) {
    log.info(`[dry-run] would ensure App ID + distribution .p12 + App Store profile for ${bundleId}, ready to upload`);
    return {
      bundleId,
      certName: DISTRIBUTION_CERT_NAME,
      certSerial: "DRYRUN000000",
      teamId: "DRYRUNTEAM",
      profileName: `Launch_${bundleId}_AppStore`,
      p12Path: join(accountCredentialsDir(ascKey.keyId), "dry-run.p12"),
      p12Password: "dry-run",
      profilePath: join(accountCredentialsDir(ascKey.keyId), "dry-run.mobileprovision"),
    };
  }

  const keyId = ascKey.keyId;
  const client = new AppStoreConnectClient(ascKey);
  const index = readIndex(keyId);

  // 1. App ID must exist before a profile can reference it.
  let bundle = await client.findBundleId(bundleId);
  if (!bundle) {
    if (!(await confirmCreate(`Register App ID "${bundleId}" in your Apple account?`))) {
      throw new Error(`App ID ${bundleId} is not registered. Re-run and confirm, or register it in the portal.`);
    }
    bundle = await client.createBundleId(bundleId, appName);
    log.step("app id", `registered ${bundleId}`, "bundle-id");
  } else {
    log.step("app id", `${bundleId} already registered`, "bundle-id");
  }

  // 2. Distribution cert as a local .p12 — reuse the cached one, else mint with openssl (no keychain import).
  const liveCerts = await client.listDistributionCertificates();
  const password = await p12Password(keyId);
  const reusable = reusableCertificate(index, liveCerts);
  let cert: CertRecord;
  let freshCert = false;
  if (reusable) {
    cert = reusable;
    log.step("certificate", `reusing distribution cert ${cert.serial}`, "distribution-certificate");
  } else {
    if (liveCerts.length >= DISTRIBUTION_CERT_CAP) {
      log.warn(
        `Apple already has ${liveCerts.length} distribution certificate(s) and none are Launch's. ` +
          `If creation fails, revoke an unused one in the Developer portal (Apple caps these).`,
      );
    }
    if (!(await confirmCreate("Create a new distribution certificate (generates a private key on this machine)?"))) {
      throw new Error("No usable distribution certificate. Re-run and confirm to create one.");
    }
    cert = await createCertificateForUpload(client, password, keyId);
    freshCert = true;
    index.certificate = cert;
    writeIndex(keyId, index);
    log.step("certificate", `created distribution cert ${cert.serial}`, "distribution-certificate");
  }

  // 3. App Store profile — reuse by name unless a fresh cert was minted; save the bytes to upload.
  const profileName = `Launch_${bundleId}_AppStore`;
  const existingProfile = await client.findProfileByName(profileName);
  let profile: ProfileResource;
  if (existingProfile && !freshCert) {
    profile = existingProfile;
    log.step("profile", `reusing ${profileName}`, "provisioning-profile");
  } else {
    if (existingProfile) await client.deleteProfile(existingProfile.id);
    profile = await client.createAppStoreProfile(profileName, bundle.id, cert.id);
    log.step("profile", `created ${profileName}`, "provisioning-profile");
  }
  const profilePath = join(ensureDir(accountCredentialsDir(keyId)), `${bundleId}.mobileprovision`);
  writeFileSync(profilePath, Buffer.from(profile.profileContent, "base64"));

  return {
    bundleId,
    certName: DISTRIBUTION_CERT_NAME,
    certSerial: cert.serial,
    teamId: bundle.seedId ?? "",
    profileName,
    p12Path: cert.p12Path,
    p12Password: password,
    profilePath,
  };
}

/** Mint a distribution cert + local `.p12` for upload, WITHOUT importing it into a local keychain. */
async function createCertificateForUpload(
  client: AppStoreConnectClient,
  password: string,
  keyId: string,
): Promise<CertRecord> {
  const work = mkdtempSync(join(tmpdir(), "launch-cert-"));
  try {
    const { keyPath, csrPem } = await generateKeypairAndCsr(work);
    const created = await client.createCertificate(csrPem);
    const p12Path = join(ensureDir(accountCredentialsDir(keyId)), `dist-${created.serialNumber}.p12`);
    await packageP12(work, keyPath, created.certificateContent, p12Path, password);
    return { id: created.id, serial: created.serialNumber, p12Path };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** A cached cert is reusable only if Apple still lists its serial and the local `.p12` backup exists. */
function reusableCertificate(index: CredentialsIndex, liveCerts: CertificateResource[]): CertRecord | null {
  const cached = index.certificate;
  if (!cached || !existsSync(cached.p12Path)) return null;
  return liveCerts.some((c) => c.serialNumber === cached.serial) ? cached : null;
}

/** Generate a key/CSR, ask Apple to sign it, and package + back up the `.p12`. Returns the record. */
async function createAndStoreCertificate(
  client: AppStoreConnectClient,
  password: string,
  keyId: string,
): Promise<CertRecord> {
  const work = mkdtempSync(join(tmpdir(), "launch-cert-"));
  try {
    const { keyPath, csrPem } = await generateKeypairAndCsr(work);
    const created = await client.createCertificate(csrPem);
    const p12Path = join(ensureDir(accountCredentialsDir(keyId)), `dist-${created.serialNumber}.p12`);
    await packageP12(work, keyPath, created.certificateContent, p12Path, password);
    await importP12(p12Path, password);
    return { id: created.id, serial: created.serialNumber, p12Path };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Move a pre-multi-account signing index (the flat `~/.launch/credentials/index.json` plus the `.p12`
 * and `.mobileprovision` files it references) into the per-account folder for `keyId`, rewriting the
 * stored paths so {@link reusableCertificate} still finds the cached `.p12` (and so doesn't burn an
 * Apple cert slot re-creating one). Best-effort and idempotent: a missing legacy index is a no-op, and
 * a failed file move just leaves that account to re-provision on its next build. Called once by the
 * account-registry migration; see `core/accounts.ts`.
 */
export function migrateLegacySigningIndex(keyId: string): void {
  if (!existsSync(CREDENTIALS_INDEX)) return;
  let index: CredentialsIndex;
  try {
    index = JSON.parse(readFileSync(CREDENTIALS_INDEX, "utf8")) as CredentialsIndex;
  } catch {
    return; // malformed legacy index — leave it; the account re-provisions cleanly
  }
  const destDir = ensureDir(accountCredentialsDir(keyId));
  const moveInto = (path: string | undefined): string | undefined => {
    if (!path || !existsSync(path)) return path;
    const dest = join(destDir, basename(path));
    try {
      renameSync(path, dest);
      return dest;
    } catch {
      return path; // cross-device or permission issue — keep the original path
    }
  };
  if (index.certificate) index.certificate.p12Path = moveInto(index.certificate.p12Path) ?? index.certificate.p12Path;
  for (const record of Object.values(index.profiles)) {
    record.path = moveInto(record.path) ?? record.path;
  }
  writeFileSync(join(destDir, "index.json"), JSON.stringify(index, null, 2));
  try {
    rmSync(CREDENTIALS_INDEX);
  } catch {
    /* leave the legacy file if it can't be removed — the per-account copy is what's read now */
  }
}
