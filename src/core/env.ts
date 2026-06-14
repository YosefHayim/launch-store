/**
 * Build-time environment handling: `.env` (real values) validated against `.env.example`
 * (the committed template), with no `EXPO_PUBLIC_` prefix convention.
 *
 * Two safety behaviors live here: fail BEFORE a build if a documented key is missing (so you
 * never burn a build discovering it), and warn on secret-looking names since, without a prefix
 * guard, anything in `.env` can be injected into the shipped app.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Parse dotenv text into key→value pairs.
 *
 * Deliberately minimal (no interpolation/expansion): blank lines and `#` comments are skipped,
 * an optional leading `export` is dropped, the first `=` splits key from value, and matching
 * surrounding quotes are stripped. This avoids a dependency for a format Launch fully controls.
 */
export function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length) : line;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Read and parse a dotenv file. Returns an empty object if the file does not exist. */
export function loadDotenvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  return parseDotenv(readFileSync(filePath, "utf8"));
}

/**
 * Compare the profile's env against `.env.example` in the same directory and return the keys
 * the example documents but the env is missing (empty values count as missing). Empty array
 * when there is no `.env.example` — nothing to validate against.
 */
export function missingKeys(appDir: string, env: Record<string, string>): string[] {
  const examplePath = join(appDir, ".env.example");
  if (!existsSync(examplePath)) return [];
  const example = loadDotenvFile(examplePath);
  return Object.keys(example).filter((key) => env[key] === undefined || env[key] === "");
}

/** Names containing one of these are always treated as secret (case-insensitive). */
const OBVIOUSLY_SECRET = /(SECRET|PRIVATE|PASSWORD|PASSWD|TOKEN)/i;
/** A trailing `_KEY` is secret-ish unless qualified as publishable. */
const KEYISH = /_KEY$/i;
/** Qualifiers that mark a `_KEY` as safe to ship (publishable/anon keys). */
const PUBLISHABLE = /(PUBLISHABLE|PUBLIC|CLIENT|WEB|ANON)/i;

/**
 * Whether a single variable NAME looks like a backend secret: it contains SECRET/PRIVATE/PASSWORD/
 * TOKEN, or ends in `_KEY` without a publishable/public/client/web/anon qualifier. The one heuristic
 * shared by the `.env` warning ({@link secretLookingKeys}) and build-log redaction (`core/redact.ts`),
 * so both agree on what counts as a secret.
 */
export function isSecretLookingName(name: string): boolean {
  if (OBVIOUSLY_SECRET.test(name)) return true;
  return KEYISH.test(name) && !PUBLISHABLE.test(name);
}

/**
 * Heuristically flag env keys that look like backend secrets, which should not be in a file
 * whose values get bundled into the app. See {@link isSecretLookingName} for the rule.
 */
export function secretLookingKeys(env: Record<string, string>): string[] {
  return Object.keys(env).filter(isSecretLookingName);
}
