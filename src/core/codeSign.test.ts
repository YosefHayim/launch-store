import { describe, expect, it } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { signatureHeader } from "./codeSign.js";

describe("signatureHeader", () => {
  it("produces an expo-signature header whose RSA-SHA256 signature verifies against the public key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const body = JSON.stringify({ id: "u", runtimeVersion: "1.0.0" });

    const header = signatureHeader(body, privateKey.export({ type: "pkcs8", format: "pem" }).toString());

    // Structured-field shape the expo-updates client parses.
    expect(header).toMatch(/^sig="[^"]+", keyid="main", alg="rsa-v1_5-sha256"$/);

    // The embedded signature must actually verify over the exact manifest body.
    const signature = Buffer.from(/sig="([^"]+)"/.exec(header)![1]!, "base64");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(body);
    verifier.end();
    expect(verifier.verify(publicKey, signature)).toBe(true);
  });
});
