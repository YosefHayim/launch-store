import { FileSystem, Path } from '@effect/platform';
import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Effect } from 'effect';
import type { Logger } from '../services/logger.js';
import { captureCommandOutput } from '../services/exec.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { resolveAccountCredentialsDirectory } from '../services/paths.js';
import type { AppleCredentialsClient } from '../services/appleCredentialsClient.js';
import type { CertificateResource } from '../types/appleCatalog.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import { getSecret, setSecret } from './keychain.js';
import { randomHexSecret } from './randomSecret.js';
import {
  makeAppleSigningFailure,
  type AppleSigningFailure,
  type AppleSigningPlatform,
  type CertRecord,
  type CredentialsIndex,
  writeIndex,
} from './appleSigningIndex.js';

/** Apple's distribution-certificate cap; creating past it fails, so warn first. */
const DISTRIBUTION_CERT_CAP = 2;

/** Xcode identity name used for App Store and ad-hoc distribution certificates. */
export const DISTRIBUTION_CERT_NAME = 'Apple Distribution';

/**
 * Keychain account holding the random password that protects an account's `.p12` backup, namespaced
 * by Key ID so each Apple account's `.p12` has its own password. Exported so first-run migration can
 * rename the legacy single-account entry (`dist-cert-p12-password`) onto this scheme.
 */
export const p12PasswordAccount = (keyId: string): string => {
  return `dist-cert-p12-password:${keyId}`;
};

/** Get (or create + persist) the random password that protects one account's `.p12` backup. */
export const p12Password = (
  keyId: string,
): Effect.Effect<string, unknown, LaunchSecretStoreService> =>
  Effect.gen(function* () {
    const account = p12PasswordAccount(keyId);
    const existing = yield* getSecret(account);
    if (existing) return existing;
    const password = yield* randomHexSecret(24);
    yield* setSecret(account, password);
    return password;
  });

/** Generate an RSA private key + certificate-signing request locally; returns the key path and CSR PEM. */
const generateKeypairAndCsr = (
  workDirectory: string,
): Effect.Effect<
  {
    keyPath: string;
    csrPem: string;
  },
  unknown,
  AppleSigningPlatform
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const keyPath = pathService.join(workDirectory, 'dist.key');
    const csrPath = pathService.join(workDirectory, 'dist.csr');
    yield* captureCommandOutput('openssl', [
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
    const csrPem = yield* fileSystem.readFileString(csrPath);
    return { keyPath, csrPem };
  });

/** Package the signed certificate + private key into a password-protected `.p12` backup. */
const packageP12 = (
  workDirectory: string,
  keyPath: string,
  certBase64: string,
  p12Path: string,
  password: string,
): Effect.Effect<void, unknown, AppleSigningPlatform> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const cerPath = pathService.join(workDirectory, 'dist.cer');
    const certPemPath = pathService.join(workDirectory, 'dist.crt.pem');
    yield* fileSystem.writeFile(cerPath, Buffer.from(certBase64, 'base64'));
    yield* captureCommandOutput('openssl', [
      'x509',
      '-inform',
      'DER',
      '-in',
      cerPath,
      '-out',
      certPemPath,
    ]);
    yield* captureCommandOutput('openssl', [
      'pkcs12',
      '-export',
      '-inkey',
      keyPath,
      '-in',
      certPemPath,
      '-out',
      p12Path,
      '-passout',
      `pass:${password}`,
      '-name',
      DISTRIBUTION_CERT_NAME,
    ]);
    yield* fileSystem.chmod(p12Path, 0o600);
  });

/** Import a `.p12` into the login Keychain, pre-authorizing codesign. Ignores an already-present item. */
export const importP12 = (
  p12Path: string,
  password: string,
): Effect.Effect<void, unknown, CommandExecutor | LaunchEnvironmentService> =>
  Effect.gen(function* () {
    const importAttempt = yield* captureCommandOutput('security', [
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
    ]).pipe(Effect.either);
    if (importAttempt._tag === 'Left' && !/already exists/i.test(String(importAttempt.left))) {
      return yield* Effect.fail(importAttempt.left);
    }
  });

/** Mint a distribution cert + local `.p12` for upload, WITHOUT importing it into a local keychain. */
export const createCertificateForUpload = (
  client: AppleCredentialsClient,
  password: string,
  keyId: string,
): Effect.Effect<CertRecord, unknown, AppleSigningPlatform> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const workDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'launch-cert-' });
      const { keyPath, csrPem } = yield* generateKeypairAndCsr(workDirectory);
      const created = yield* client.createCertificate(csrPem);
      const credentialsDirectory = yield* resolveAccountCredentialsDirectory(keyId);
      yield* fileSystem.makeDirectory(credentialsDirectory, { recursive: true });
      const p12Path = pathService.join(credentialsDirectory, `dist-${created.serialNumber}.p12`);
      yield* packageP12(workDirectory, keyPath, created.certificateContent, p12Path, password);
      return { id: created.id, serial: created.serialNumber, p12Path };
    }),
  );

/** Generate a key/CSR, ask Apple to sign it, package + back up the `.p12`, and import it for local codesign. */
export const createAndStoreCertificate = (
  client: AppleCredentialsClient,
  password: string,
  keyId: string,
): Effect.Effect<CertRecord, unknown, AppleSigningPlatform> =>
  Effect.gen(function* () {
    const cert = yield* createCertificateForUpload(client, password, keyId);
    yield* importP12(cert.p12Path, password);
    return cert;
  });

/** A cached cert is reusable only if Apple still lists its serial and the local `.p12` backup exists. */
export const reusableCertificate = (
  index: CredentialsIndex,
  liveCerts: CertificateResource[],
): Effect.Effect<CertRecord | null, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cached = index.certificate;
    if (!cached) return null;
    if (!(yield* fileSystem.exists(cached.p12Path).pipe(Effect.orElseSucceed(() => false))))
      return null;
    if (liveCerts.some((certificate) => certificate.serialNumber === cached.serial)) return cached;
    return null;
  });

/** Inputs for {@link ensureDistributionCertificate} - one shared cert step for local/ad-hoc/remote. */
export type EnsureDistributionCertificateOptions = {
  client: AppleCredentialsClient;
  keyId: string;
  index: CredentialsIndex;
  confirmCreate: (message: string) => Effect.Effect<boolean, unknown>;
  log: Logger;
  /** When true, import a reused or freshly minted `.p12` into the local keychain for codesign. */
  importToKeychain: boolean;
  /** When true, warn before minting if Apple already sits at the distribution-cert cap. */
  warnAtCertCap: boolean;
  /** Confirm prompt wording ("this Mac" vs "this machine"). */
  createConfirmMessage: string;
};

export type EnsuredDistributionCertificate = {
  cert: CertRecord;
  freshCert: boolean;
  password: string;
};

/**
 * Resolve the team distribution certificate shared by every bundle: reuse a still-live cached
 * `.p12`, or mint a fresh key/CSR/cert. Local and ad-hoc paths import into the login keychain;
 * the remote path leaves the `.p12` on disk for upload only.
 */
export const ensureDistributionCertificate = (
  options: EnsureDistributionCertificateOptions,
): Effect.Effect<
  EnsuredDistributionCertificate,
  AppleSigningFailure | unknown,
  AppleSigningPlatform | LaunchSecretStoreService
> =>
  Effect.gen(function* () {
    const {
      client,
      keyId,
      index,
      confirmCreate,
      log,
      importToKeychain,
      warnAtCertCap,
      createConfirmMessage,
    } = options;
    const liveCerts = yield* client.listDistributionCertificates();
    const password = yield* p12Password(keyId);
    const reusable = yield* reusableCertificate(index, liveCerts);
    if (reusable) {
      if (importToKeychain) yield* importP12(reusable.p12Path, password);
      yield* log.step(
        'certificate',
        `reusing distribution cert ${reusable.serial}`,
        'distribution-certificate',
      );
      return { cert: reusable, freshCert: false, password };
    }
    if (warnAtCertCap && liveCerts.length >= DISTRIBUTION_CERT_CAP) {
      yield* log.warn(
        `Apple already has ${liveCerts.length} distribution certificate(s) and none are Launch's. ` +
          `If creation fails, revoke an unused one in the Developer portal (Apple caps these).`,
      );
    }
    if (!(yield* confirmCreate(createConfirmMessage))) {
      return yield* Effect.fail(
        makeAppleSigningFailure({
          message: 'No usable distribution certificate. Re-run and confirm to create one.',
        }),
      );
    }
    let cert: CertRecord;
    if (importToKeychain) {
      cert = yield* createAndStoreCertificate(client, password, keyId);
    } else {
      cert = yield* createCertificateForUpload(client, password, keyId);
    }
    index.certificate = cert;
    yield* writeIndex(keyId, index);
    yield* log.step(
      'certificate',
      `created distribution cert ${cert.serial}`,
      'distribution-certificate',
    );
    return { cert, freshCert: true, password };
  });
