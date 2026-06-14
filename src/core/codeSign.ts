/**
 * Code-signing for OTA updates — the "your keys" guarantee for `launch update`.
 *
 * Without signing, anyone who can write to your bucket (or a misconfigured-public one) could push
 * arbitrary JavaScript to every installed app. So Launch signs each update manifest by default: it
 * generates an RSA key pair + self-signed certificate locally (openssl, exactly like the iOS
 * distribution cert), keeps the PRIVATE key in the OS secret store, and emits only the public
 * certificate for the app to embed (`expo.updates.codeSigningCertificate`). `expo-updates` then
 * rejects any manifest not signed by the matching key.
 *
 * The signature is produced with `expo-updates`' default scheme: RSA PKCS#1 v1.5 over SHA-256, returned
 * in the structured `expo-signature` header form `sig="…", keyid="main", alg="rsa-v1_5-sha256"`.
 */

import { createSign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "./logger.js";
import { capture } from "./exec.js";
import { getSecret, setSecret } from "./keychain.js";
import { CREDENTIALS_DIR, ensureDir } from "./paths.js";

/** Secret-store account holding the OTA code-signing private key (PEM). */
const PRIVATE_KEY_ACCOUNT = "ota-code-signing-key";
/** The keyid `expo-updates` expects by default; carried in the signature header + app config. */
export const CODE_SIGNING_KEYID = "main";
/** Path the public certificate is written to (non-secret; the app embeds a copy of it). */
export const CODE_SIGNING_CERT_PATH = join(CREDENTIALS_DIR, "launch-code-signing.pem");

/** The resolved code-signing material for a publish: the cert to embed + a function to sign manifests. */
export interface CodeSigner {
  /** Absolute path to the public certificate the app must embed. */
  certPath: string;
  /** Sign a manifest body, returning the full `expo-signature` header value. */
  sign(manifestBody: string): string;
}

/**
 * Format an RSA-SHA256 signature over `manifestBody` as the `expo-signature` header value. Exported so
 * the manifest assembler/tests can verify the structured-field shape without touching the key store.
 */
export function signatureHeader(manifestBody: string, privateKeyPem: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(manifestBody);
  signer.end();
  const signature = signer.sign(privateKeyPem).toString("base64");
  return `sig="${signature}", keyid="${CODE_SIGNING_KEYID}", alg="rsa-v1_5-sha256"`;
}

/**
 * Resolve the code-signing material, generating the key pair + self-signed certificate on first use.
 * The private key lives only in the OS secret store; the certificate is written to
 * {@link CODE_SIGNING_CERT_PATH} for the developer to copy into the app. Idempotent: a second call
 * reuses the stored key. In `--dry-run` it neither generates nor stores anything.
 */
export async function ensureCodeSigner(dryRun: boolean, log: Logger): Promise<CodeSigner> {
  if (dryRun) {
    return { certPath: CODE_SIGNING_CERT_PATH, sign: () => 'sig="<dry-run>", keyid="main", alg="rsa-v1_5-sha256"' };
  }

  const existingKey = await getSecret(PRIVATE_KEY_ACCOUNT);
  if (existingKey) {
    return { certPath: CODE_SIGNING_CERT_PATH, sign: (body) => signatureHeader(body, existingKey) };
  }

  // First publish: mint an RSA key + self-signed code-signing cert with openssl (key born locally).
  const work = mkdtempSync(join(tmpdir(), "launch-codesign-"));
  try {
    const keyPath = join(work, "key.pem");
    const certPath = join(work, "cert.pem");
    await capture("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "3650",
      "-subj",
      "/CN=Launch Code Signing",
    ]);
    const privateKeyPem = readFileSync(keyPath, "utf8");
    await setSecret(PRIVATE_KEY_ACCOUNT, privateKeyPem);
    ensureDir(CREDENTIALS_DIR);
    writeFileSync(CODE_SIGNING_CERT_PATH, readFileSync(certPath));
    log.step("code signing", `generated signing key + cert → ${CODE_SIGNING_CERT_PATH}`, "ota-update");
    return { certPath: CODE_SIGNING_CERT_PATH, sign: (body) => signatureHeader(body, privateKeyPem) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
