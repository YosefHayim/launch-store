/**
 * The App Store Connect submitter — the binary-upload step.
 *
 * Uploads the signed `.ipa` to App Store Connect with fastlane `pilot`, authenticating with the same
 * API key as everything else (written to a temporary JSON file in fastlane's expected shape, removed
 * after). fastlane is deliberately scoped to the upload only: the uploaded build lands in App Store
 * Connect and is usable for BOTH TestFlight and an App Store version, so public release is no longer a
 * separate `deliver` step but is driven over the API by `core/appStoreRelease.ts` (`launch release`).
 * This submitter therefore just gets the binary to Apple — both submit targets upload the same way; the
 * API decides what becomes of it. Implements {@link Submitter}, the iOS twin of the Google Play one.
 */

import { rmSync } from "node:fs";
import type { BuildCredentials, ResolvedBuildContext, Submitter, SubmitTarget } from "../../core/types.js";
import { run } from "../../core/exec.js";
import { writeAscApiKeyFile } from "../../apple/apiKeyFile.js";

export const appStoreConnectSubmitter: Submitter = {
  name: "app-store-connect",

  async submit(
    artifactPath: string,
    _target: SubmitTarget,
    creds: BuildCredentials,
    ctx: ResolvedBuildContext,
  ): Promise<void> {
    if (creds.platform !== "ios") throw new Error("The app-store-connect submitter handles iOS only.");
    const apiKeyPath = writeAscApiKeyFile(creds.ascKey);
    try {
      // `pilot upload` puts the binary into App Store Connect; `--skip_waiting_for_build_processing`
      // returns as soon as the upload lands — Launch polls processing itself (see waitForValidBuild).
      // Resolved env (profile env: / .env / keychain / --env) reaches fastlane as its process env.
      await run(
        "fastlane",
        [
          "pilot",
          "upload",
          "--ipa",
          artifactPath,
          "--api_key_path",
          apiKeyPath,
          "--skip_waiting_for_build_processing",
          "true",
        ],
        { env: ctx.env },
      );
    } finally {
      rmSync(apiKeyPath, { force: true });
    }
  },
};
