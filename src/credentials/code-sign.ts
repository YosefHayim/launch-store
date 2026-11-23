// Creates the key Launch uses to sign over-the-air update manifests.

import { createSign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LaunchSecretStore } from '../services/credentials/secret-store.ts';
import { captureCommandOutput } from '../services/platform/execute-command.ts';
import type { Logger } from '../services/platform/logger.ts';
import { resolveCredentialsDirectory } from '../services/platform/paths.ts';

const PRIVATE_KEY_ACCOUNT = 'ota-code-signing-key';

export type CodeSigner = Readonly<{
  readonly certPath: string;
  readonly sign: (manifestBody: string) => string;
}>;

/** Format an RSA-SHA256 signature as an Expo Updates signature header. */
export function signatureHeader(manifestBody: string, privateKeyPem: string): string {
  const signer = createSign('RSA-SHA256');

  signer.update(manifestBody);
  signer.end();

  const signature = signer.sign(privateKeyPem).toString('base64');

  return `sig="${signature}", keyid="main", alg="rsa-v1_5-sha256"`;
}

function signDryRun(): string {
  return 'sig="<dry-run>", keyid="main", alg="rsa-v1_5-sha256"';
}

/** Load or generate the local Expo Updates signing key and public certificate. */
export async function ensureCodeSigner(dryRun: boolean, logger: Logger): Promise<CodeSigner> {
  const credentialsDirectory = resolveCredentialsDirectory();
  const publicCertificatePath = join(credentialsDirectory, 'launch-code-signing.pem');

  if (dryRun) {
    return { certPath: publicCertificatePath, sign: signDryRun };
  }

  const existingPrivateKey = await new LaunchSecretStore().readSecret(PRIVATE_KEY_ACCOUNT);

  const hasPrivateKey = existingPrivateKey != null;

  if (hasPrivateKey) {
    const storedPrivateKey = existingPrivateKey;

    function signWithStoredKey(manifestBody: string): string {
      return signatureHeader(manifestBody, storedPrivateKey);
    }

    return { certPath: publicCertificatePath, sign: signWithStoredKey };
  }

  const systemTemporaryDirectory = tmpdir();
  const launchCodesignPath = join(systemTemporaryDirectory, 'launch-codesign-');
  const temporaryDirectory = await mkdtemp(launchCodesignPath);

  try {
    const privateKeyPath = join(temporaryDirectory, 'key.pem');
    const stagedCertificatePath = join(temporaryDirectory, 'cert.pem');

    await captureCommandOutput('openssl', [
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

    const privateKeyPem = await readFile(privateKeyPath, 'utf8');
    const certificateBytes = await readFile(stagedCertificatePath);

    await new LaunchSecretStore().storeSecret(PRIVATE_KEY_ACCOUNT, privateKeyPem);
    await mkdir(credentialsDirectory, { recursive: true });
    await writeFile(publicCertificatePath, certificateBytes);
    logger.step(
      'code signing',
      `generated signing key and certificate -> ${publicCertificatePath}`,
      'ota-update',
    );

    function signWithGeneratedKey(manifestBody: string): string {
      return signatureHeader(manifestBody, privateKeyPem);
    }

    return { certPath: publicCertificatePath, sign: signWithGeneratedKey };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
