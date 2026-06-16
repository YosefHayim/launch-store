/**
 * Shared artifact scaffolds for `launch migrate` — content every migration source emits the same way,
 * kept in one place so EAS (#171) and fastlane (#172) can't drift. Today that's the `store.config.json`
 * skeleton: both sources scaffold an empty listing when the project has none and otherwise leave an
 * existing one untouched, so the decision and the skeleton live here rather than in each source.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { serializeStoreConfig, type StoreConfig } from "../storeConfig.js";
import type { MigrationArtifact, MigrationNote } from "./types.js";

/** A fill-in-the-blanks `store.config.json` (the EAS metadata schema Launch adopts verbatim for iOS). */
const STORE_CONFIG_SKELETON: StoreConfig = {
  configVersion: 0,
  apple: { info: { "en-US": { title: "", subtitle: "", description: "", keywords: [] } } },
};

/**
 * Decide how a migration handles `store.config.json` in `cwd`: emit a skeleton artifact when none exists
 * (with a `manual` note to fill it in or pull the live listing), or emit no artifact and a `skipped` note
 * when one is already present (Launch uses it verbatim). Returns both so the caller appends them uniformly.
 */
export function scaffoldStoreConfig(cwd: string): { artifact: MigrationArtifact | null; note: MigrationNote } {
  if (existsSync(join(cwd, "store.config.json"))) {
    return {
      artifact: null,
      note: {
        level: "skipped",
        message: "store.config.json already present — Launch uses it verbatim (same schema as EAS metadata).",
      },
    };
  }
  return {
    artifact: { path: "store.config.json", contents: serializeStoreConfig(STORE_CONFIG_SKELETON) },
    note: {
      level: "manual",
      message:
        "Scaffolded store.config.json — fill in your listing, or run `launch metadata pull` to import the live App Store listing.",
    },
  };
}
