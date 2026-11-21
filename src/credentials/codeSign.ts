import type * as PlatformCommandExecutor from '@effect/platform/CommandExecutor';
import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import { createSign } from 'node:crypto';
import { captureCommandOutput } from '../services/platform/exec.js';
import type { LaunchEnvironmentService } from '../services/platform/environment.js';
import type { Logger } from '../services/platform/logger.js';
import {
  resolveCredentialsDirectory,
  type LaunchPathsService,
} from '../services/platform/paths.js';
import type { LaunchSecretStoreService } from '../services/credentials/secretStore.js';
import { getSecret, setSecret } from './storedSecret.js';

const PRIVATE_KEY_ACCOUNT = 'ota-code-signing-key';

export type CodeSigner = Readonly<{
  readonly certPath: string;
  readonly sign: (manifestBody: string) => string;
}>;

export type CodeSigningRequirements =
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchSecretStoreService
  | Path.Path
  | PlatformCommandExecutor.CommandExecutor;

/** Format an RSA-SHA256 signature as an Expo Updates signature header. */
export const signatureHeader = (manifestBody: string, privateKeyPem: string): string => {
  const signer = createSign('RSA-SHA256');
  signer.update(manifestBody);
  signer.end();
  const signature = signer.sign(privateKeyPem).toString('base64');
  return `sig="${signature}", keyid="main", alg="rsa-v1_5-sha256"`;
};

/** Load or generate the local Expo Updates signing key and public certificate. */
export const ensureCodeSigner = (
  dryRun: boolean,
  logger: Logger,
): Effect.Effect<CodeSigner, unknown, CodeSigningRequirements> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const credentialsDirectory = yield* resolveCredentialsDirectory();
      const publicCertificatePath = pathService.join(
        credentialsDirectory,
        'launch-code-signing.pem',
      );
      if (dryRun) {
        return {
          certPath: publicCertificatePath,
          sign: () => 'sig="<dry-run>", keyid="main", alg="rsa-v1_5-sha256"',
        };
      }
      const existingPrivateKey = yield* getSecret(PRIVATE_KEY_ACCOUNT);
      if (existingPrivateKey !== null) {
        return {
          certPath: publicCertificatePath,
          sign: (manifestBody) => signatureHeader(manifestBody, existingPrivateKey),
        };
      }
      const temporaryDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: 'launch-codesign-',
      });
      const privateKeyPath = pathService.join(temporaryDirectory, 'key.pem');
      const stagedCertificatePath = pathService.join(temporaryDirectory, 'cert.pem');
      yield* captureCommandOutput('openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        privateKeyPath,
        '-out',
        stagedCertificatePath,
        '-days',
        '3650',
        '-subj',
        '/CN=Launch Code Signing',
      ]);
      const privateKeyPem = yield* fileSystem.readFileString(privateKeyPath);
      const certificateBytes = yield* fileSystem.readFile(stagedCertificatePath);
      yield* setSecret(PRIVATE_KEY_ACCOUNT, privateKeyPem);
      yield* fileSystem.makeDirectory(credentialsDirectory, { recursive: true });
      yield* fileSystem.writeFile(publicCertificatePath, certificateBytes);
      yield* logger.step(
        'code signing',
        `generated signing key and certificate -> ${publicCertificatePath}`,
        'ota-update',
      );
      return {
        certPath: publicCertificatePath,
        sign: (manifestBody) => signatureHeader(manifestBody, privateKeyPem),
      };
    }),
  );
