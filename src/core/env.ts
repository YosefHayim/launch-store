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
 * surrounding quotes are stripped. This avoids a dependency for a format Relay fully controls.
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

/**
 * Heuristically flag env keys that look like backend secrets, which should not be in a file
 * whose values get bundled into the app. Names containing SECRET/PRIVATE/PASSWORD/TOKEN, or
 * ending in `_KEY` without a publishable/public/client/web qualifier, are flagged.
 */
export function secretLookingKeys(env: Record<string, string>): string[] {
  const obviouslySecret = /(SECRET|PRIVATE|PASSWORD|PASSWD|TOKEN)/i;
  const keyish = /_KEY$/i;
  const publishable = /(PUBLISHABLE|PUBLIC|CLIENT|WEB|ANON)/i;
  return Object.keys(env).filter((name) => {
    if (obviouslySecret.test(name)) return true;
    return keyish.test(name) && !publishable.test(name);
  });
}
