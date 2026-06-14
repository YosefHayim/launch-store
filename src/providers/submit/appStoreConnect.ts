/**
 * The App Store Connect submitter — v1's upload path.
 *
 * Uploads the signed `.ipa` to Apple using fastlane `pilot` (TestFlight, the default) or `deliver`
 * (public review, only on an explicit `launch release --to-store`). Authenticates with the same API
 * key as everything else, written to a temporary JSON file in fastlane's expected shape and removed
 * after. Implements {@link Submitter}; a Google Play submitter implements the same interface later.
 */

import { rmSync } from "node:fs";
import type { BuildCredentials, ResolvedBuildContext, Submitter, SubmitTarget } from "../../core/types.js";
import { run } from "../../core/exec.js";
import { writeAscApiKeyFile } from "../../apple/apiKeyFile.js";

export const appStoreConnectSubmitter: Submitter = {
  name: "app-store-connect",

  async submit(
    artifactPath: string,
    target: SubmitTarget,
    creds: BuildCredentials,
    ctx: ResolvedBuildContext,
  ): Promise<void> {
    if (creds.platform !== "ios") throw new Error("The app-store-connect submitter handles iOS only.");
    const apiKeyPath = writeAscApiKeyFile(creds.ascKey);
    try {
      const args =
        target === "testing"
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
      // Resolved env (profile env: / .env / keychain / --env) reaches fastlane as its process env.
      await run("fastlane", args, { env: ctx.env });
    } finally {
      rmSync(apiKeyPath, { force: true });
    }
  },
};
