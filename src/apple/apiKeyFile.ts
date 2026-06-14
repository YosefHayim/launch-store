/**
 * Write the App Store Connect API key to the temporary JSON file fastlane's `--api_key_path` expects.
 *
 * fastlane tools (`pilot`, `deliver`) authenticate from a JSON key file rather than the in-memory key
 * Launch holds, so every fastlane-driven Apple action writes one. Centralized here so the submitter
 * and the metadata command produce byte-identical files and never drift on the field names Apple wants.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AscKey } from "../core/types.js";

/** Write `ascKey` in fastlane's `--api_key_path` JSON shape to a fresh temp file; returns its path. */
export function writeAscApiKeyFile(ascKey: AscKey): string {
  const dir = mkdtempSync(join(tmpdir(), "launch-key-"));
  const path = join(dir, "asc_api_key.json");
  writeFileSync(
    path,
    JSON.stringify({ key_id: ascKey.keyId, issuer_id: ascKey.issuerId, key: ascKey.p8, in_house: false }),
  );
  return path;
}
