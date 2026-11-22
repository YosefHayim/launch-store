import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathExists } from '../path-exists.ts';
import { LaunchSecretStore } from '../services/credentials/secret-store.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { captureCommandOutput } from '../services/platform/exec.ts';
import type { Logger } from '../services/platform/logger.ts';
import { resolveAccountCredentialsDirectory } from '../services/platform/paths.ts';
import type { AppleCredentialsClient } from '../services/stores/apple-credentials-client.ts';
import type { CertificateResource } from '../types/apple-catalog.ts';
import { randomHexSecret } from './random-secret.ts';
import {
  makeAppleSigningFailure,
  type CertRecord,
  type CredentialsIndex,
  writeIndex,
} from './apple-signing-index.ts';

/** Xcode identity name used for App Store and ad-hoc distribution certificates. */
export const DISTRIBUTION_CERT_NAME = 'Apple Distribution';

/**
 * Keychain account holding the random password that protects an account's `.p12` backup, namespaced
 * by Key ID so each Apple account's `.p12` has its own password. Exported so first-run migration can
 * rename the legacy single-account entry (`dist-cert-p12-password`) onto this scheme.
 */
export function p12PasswordAccount(keyId: string): string {
  return `dist-cert-p12-password:${keyId}`;
}

function isStoredPasswordMissing(storedPassword: string | null): boolean {
  if (storedPassword == null) {
    return true;
  }

  return storedPassword == '';
}

/** Get (or create + persist) the random password that protects one account's `.p12` backup. */
async function p12Password(keyId: string): Promise<string> {
  const account = p12PasswordAccount(keyId);
  const existing = await LaunchSecretStore.readSecret(account);
  const isMissing = isStoredPasswordMissing(existing);

  if (isMissing == false) {
    return existing ?? '';
  }

  const password = randomHexSecret(24);
  await LaunchSecretStore.storeSecret(account, password);

  return password;
}

/** Generate an RSA private key + certificate-signing request locally; returns the key path and CSR PEM. */
async function generateKeypairAndCsr(workDirectory: string): Promise<{
  keyPath: string;
  csrPem: string;
}> {
  const keyPath = join(workDirectory, 'dist.key');
  const csrPath = join(workDirectory, 'dist.csr');

  await captureCommandOutput('openssl', [
    'req',
    '-new',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    csrPath,
    '-subj',
    '/CN=Launch Distribution/O=Launch/C=US',
  ]);

  const csrPem = await readFile(csrPath, 'utf8');

  return { keyPath, csrPem };
}

/** Package the signed certificate + private key into a password-protected `.p12` backup. */
async function packageP12(
  workDirectory: string,
  keyPath: string,
  certBase64: string,
  p12Path: string,
  password: string,
): Promise<void> {
  const cerPath = join(workDirectory, 'dist.cer');
  const certPemPath = join(workDirectory, 'dist.crt.pem');

  const bufferBytes = Buffer.from(certBase64, 'base64');
  await writeFile(cerPath, bufferBytes);
  await captureCommandOutput('openssl', [
    'x509',
    '-inform',
    'DER',
    '-in',
    cerPath,
    '-out',
    certPemPath,
  ]);
  await captureCommandOutput(
    'openssl',
    [
      'pkcs12',
      '-export',
      '-inkey',
      keyPath,
      '-in',
      certPemPath,
      '-out',
      p12Path,
      '-passout',
      'env:LAUNCH_P12_EXPORT_PASSWORD',
      '-name',
      DISTRIBUTION_CERT_NAME,
    ],
    { environmentOverrides: { LAUNCH_P12_EXPORT_PASSWORD: password } },
  );
  await chmod(p12Path, 0o600);
}

// security(1) says the item is already in the login keychain.
function describesExistingKeychainItem(cause: unknown): boolean {
  const failureMessage = errorMessage(cause);
  const mentionsMessage = /already exists/i.test(failureMessage);

  if (mentionsMessage) {
    return true;
  }

  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('stderr' in cause == false) {
    return false;
  }

  const standardError = cause.stderr;

  if (typeof standardError != 'string') {
    return false;
  }

  return /already exists/i.test(standardError);
}

/** Import a `.p12` into the login Keychain, pre-authorizing codesign. Ignores an already-present item. */
async function importP12(p12Path: string, password: string): Promise<void> {
  try {
    await captureCommandOutput('security', [
      'import',
      p12Path,
      '-P',
      password,
      '-T',
      '/usr/bin/codesign',
      '-T',
      '/usr/bin/security',
      '-f',
      'pkcs12',
    ]);
  } catch (cause) {
    const isAlreadyPresent = describesExistingKeychainItem(cause);

    if (isAlreadyPresent) {
      return;
    }

    throw cause;
  }
}

/** Mint a distribution cert + local `.p12` for upload, WITHOUT importing it into a local keychain. */
async function createCertificateForUpload(
  client: AppleCredentialsClient,
  password: string,
  keyId: string,
): Promise<CertRecord> {
  const systemTemporaryDirectory = tmpdir();
  const launchCertPath = join(systemTemporaryDirectory, 'launch-cert-');
  const workDirectory = await mkdtemp(launchCertPath);

  try {
    const generated = await generateKeypairAndCsr(workDirectory);
    const created = await client.createCertificate(generated.csrPem);
    const credentialsDirectory = resolveAccountCredentialsDirectory(keyId);

    await mkdir(credentialsDirectory, { recursive: true });

    const p12Path = join(credentialsDirectory, `dist-${created.serialNumber}.p12`);

    await packageP12(
      workDirectory,
      generated.keyPath,
      created.certificateContent,
      p12Path,
      password,
    );

    return { id: created.id, serial: created.serialNumber, p12Path };
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

/** Generate a key/CSR, ask Apple to sign it, package + back up the `.p12`, and import it for local codesign. */
async function createAndStoreCertificate(
  client: AppleCredentialsClient,
  password: string,
  keyId: string,
): Promise<CertRecord> {
  const cert = await createCertificateForUpload(client, password, keyId);
  await importP12(cert.p12Path, password);

  return cert;
}

/** A cached cert is reusable only if Apple still lists its serial and the local `.p12` backup exists. */
async function reusableCertificate(
  index: CredentialsIndex,
  liveCerts: readonly CertificateResource[],
): Promise<CertRecord | null> {
  const cached = index.certificate;

  if (cached == null) {
    return null;
  }

  const isBackupPresent = await pathExists(cached.p12Path);

  if (isBackupPresent == false) {
    return null;
  }

  const cachedSerial = cached.serial;

  function hasMatchingSerial(certificate: CertificateResource): boolean {
    return certificate.serialNumber == cachedSerial;
  }

  const isStillListed = liveCerts.some(hasMatchingSerial);

  if (isStillListed == false) {
    return null;
  }

  return cached;
}

/** Inputs for {@link ensureDistributionCertificate} - one shared cert step for local/ad-hoc/remote. */
type EnsureDistributionCertificateOptions = {
  client: AppleCredentialsClient;
  keyId: string;
  index: CredentialsIndex;
  confirmCreate: (message: string) => Promise<boolean>;
  log: Logger;
  /** When true, import a reused or freshly minted `.p12` into the local keychain for codesign. */
  importToKeychain: boolean;
  /** When true, warn before minting if Apple already sits at the distribution-cert cap. */
  warnAtCertCap: boolean;
  /** Confirm prompt wording ("this Mac" vs "this machine"). */
  createConfirmMessage: string;
};

type EnsuredDistributionCertificate = {
  cert: CertRecord;
  freshCert: boolean;
  password: string;
};

function shouldWarnAtCertificateCap(warnAtCertCap: boolean, certificateCount: number): boolean {
  if (warnAtCertCap == false) {
    return false;
  }

  const distributionCertCap = 2;

  return certificateCount >= distributionCertCap;
}

async function importReusedCertificate(
  importToKeychain: boolean,
  p12Path: string,
  password: string,
): Promise<void> {
  if (importToKeychain == false) {
    return;
  }

  await importP12(p12Path, password);
}

async function createDistributionCertificate(
  client: AppleCredentialsClient,
  password: string,
  keyId: string,
  importToKeychain: boolean,
): Promise<CertRecord> {
  if (importToKeychain) {
    return createAndStoreCertificate(client, password, keyId);
  }

  return createCertificateForUpload(client, password, keyId);
}

/**
 * Resolve the team distribution certificate shared by every bundle: reuse a still-live cached
 * `.p12`, or mint a fresh key/CSR/cert. Local and ad-hoc paths import into the login keychain;
 * the remote path leaves the `.p12` on disk for upload only.
 */
export async function ensureDistributionCertificate(
  certificateOptions: EnsureDistributionCertificateOptions,
): Promise<EnsuredDistributionCertificate> {
  const liveCerts = await certificateOptions.client.listDistributionCertificates();
  const password = await p12Password(certificateOptions.keyId);
  const reusable = await reusableCertificate(certificateOptions.index, liveCerts);

  if (reusable != null) {
    await importReusedCertificate(certificateOptions.importToKeychain, reusable.p12Path, password);

    certificateOptions.log.step(
      'certificate',
      `reusing distribution cert ${reusable.serial}`,
      'distribution-certificate',
    );

    return { cert: reusable, freshCert: false, password };
  }

  const warnAboutCap = shouldWarnAtCertificateCap(
    certificateOptions.warnAtCertCap,
    liveCerts.length,
  );

  if (warnAboutCap) {
    certificateOptions.log.warn(
      `Apple already has ${liveCerts.length} distribution certificate(s) and none are Launch's. ` +
        `If creation fails, revoke an unused one in the Developer portal (Apple caps these).`,
    );
  }

  const isCreationConfirmed = await certificateOptions.confirmCreate(
    certificateOptions.createConfirmMessage,
  );

  if (isCreationConfirmed == false) {
    throw makeAppleSigningFailure({
      message: 'No usable distribution certificate. Re-run and confirm to create one.',
    });
  }

  const cert = await createDistributionCertificate(
    certificateOptions.client,
    password,
    certificateOptions.keyId,
    certificateOptions.importToKeychain,
  );

  certificateOptions.index.certificate = cert;
  await writeIndex(certificateOptions.keyId, certificateOptions.index);
  certificateOptions.log.step(
    'certificate',
    `created distribution cert ${cert.serial}`,
    'distribution-certificate',
  );

  return { cert, freshCert: true, password };
}
