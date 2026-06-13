/**
 * The App Store Connect submitter — v1's upload path.
 *
 * Uploads the signed `.ipa` to Apple using fastlane `pilot` (TestFlight, the default) or `deliver`
 * (public review, only on an explicit `launch release --to-store`). Authenticates with the same API
 * key as everything else, written to a temporary JSON file in fastlane's expected shape and removed
 * after. Implements {@link Submitter}; a Google Play submitter implements the same interface later.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppleCredentials, ResolvedBuildContext, Submitter, SubmitTarget } from "../../core/types.js";
import { run } from "../../core/exec.js";

/** Write the API key in the JSON shape fastlane's `--api_key_path` expects; returns the file path. */
function writeApiKeyFile(creds: AppleCredentials): string {
  const dir = mkdtempSync(join(tmpdir(), "launch-key-"));
  const path = join(dir, "asc_api_key.json");
  writeFileSync(
    path,
    JSON.stringify({
      key_id: creds.ascKey.keyId,
      issuer_id: creds.ascKey.issuerId,
      key: creds.ascKey.p8,
      in_house: false,
    }),
  );
  return path;
}

export const appStoreConnectSubmitter: Submitter = {
  name: "app-store-connect",

  async submit(
    artifactPath: string,
    target: SubmitTarget,
    creds: AppleCredentials,
    _ctx: ResolvedBuildContext,
  ): Promise<void> {
    const apiKeyPath = writeApiKeyFile(creds);
    try {
      const args =
        target === "testflight"
          ? [
              "pilot",
              "upload",
              "--ipa",
              artifactPath,
              "--api_key_path",
              apiKeyPath,
              "--skip_waiting_for_build_processing",
              "true",
            ]
          : [
              "deliver",
              "--ipa",
              artifactPath,
              "--api_key_path",
              apiKeyPath,
              "--submit_for_review",
              "true",
              "--force",
              "true",
            ];
      await run("fastlane", args);
    } finally {
      rmSync(apiKeyPath, { force: true });
    }
  },
};
