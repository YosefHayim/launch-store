import { FileSystem, Path } from '@effect/platform';
import { Data, Effect } from 'effect';
/**
 * Parse dotenv text into key->value pairs.
 *
 * Deliberately minimal (no interpolation/expansion): blank lines and `#` comments are skipped,
 * an optional leading `export` is dropped, the first `=` splits key from value, and matching
 * surrounding quotes are stripped. This avoids a dependency for a format Launch fully controls.
 */
export const parseDotenv = (content: string): Record<string, string> => {
  const environmentValues: Record<string, string> = {};
  for (const dotenvLine of content.split('\n')) {
    const line = dotenvLine.trim();
    if (line === '') continue;
    if (line.startsWith('#')) continue;
    let withoutExport = line;
    if (line.startsWith('export ')) withoutExport = line.slice('export '.length);
    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    let environmentValue = withoutExport.slice(eq + 1).trim();
    if (environmentValue.startsWith('"') && environmentValue.endsWith('"')) {
      environmentValue = environmentValue.slice(1, -1);
    } else if (environmentValue.startsWith("'") && environmentValue.endsWith("'")) {
      environmentValue = environmentValue.slice(1, -1);
    }
    if (key) environmentValues[key] = environmentValue;
  }
  return environmentValues;
};
/** Read and parse a dotenv file. Returns an empty object if the file does not exist. */
export const loadDotenvFile = (filePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if (!(yield* fileSystem.exists(filePath))) return {};
    return parseDotenv(yield* fileSystem.readFileString(filePath));
  });
/**
 * Whether an env var NAME is denied by an `envExclude` list. An entry ending in `*` is a prefix match -
 * `OPENAI_*` denies every name starting with `OPENAI_`, so a whole family of backend keys collapses to
 * one line; any other entry is an exact, case-sensitive name match. Prefixes anchor at the START, so a
 * pattern can't catch a name by its tail - there is deliberately no `*_KEY` suffix form, which would also
 * snag a publishable `EXPO_PUBLIC_..._KEY`. The single matching rule shared by {@link resolveEnv} (drops
 * matches before injection) and {@link missingKeys} (exempts matches from the gate), so the two agree.
 */
export const isEnvExcluded = (name: string, patterns: string[]): boolean => {
  for (const pattern of patterns) {
    if (pattern.endsWith('*')) {
      if (name.startsWith(pattern.slice(0, -1))) return true;
    } else if (name === pattern) {
      return true;
    }
  }
  return false;
};
/**
 * Compare the profile's env against `.env.example` in the same directory and return the keys
 * the example documents but the env is missing (empty values count as missing). Empty array
 * when there is no `.env.example` - nothing to validate against. Keys matched by `exclude` (the
 * `envExclude` list - exact names or `PREFIX*`, see {@link isEnvExcluded}) are skipped: a deliberately
 * backend-only secret isn't "missing", so documenting it in `.env.example` doesn't trip the gate - even
 * when no layer sets it.
 */
export const missingKeys = (
  appDirectory: string,
  environment: Record<string, string>,
  excludedPatterns: string[] = [],
) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const exampleEnvironment = yield* loadDotenvFile(
      pathService.join(appDirectory, '.env.example'),
    );
    return Object.keys(exampleEnvironment).filter((environmentName) => {
      if (isEnvExcluded(environmentName, excludedPatterns)) return false;
      if (environment[environmentName] === undefined) return true;
      return environment[environmentName] === '';
    });
  });
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
export const isSecretLookingName = (name: string): boolean => {
  if (OBVIOUSLY_SECRET.test(name)) return true;
  return KEYISH.test(name) && !PUBLISHABLE.test(name);
};
/**
 * Heuristically flag env keys that look like backend secrets, which should not be in a file
 * whose values get bundled into the app. See {@link isSecretLookingName} for the rule.
 */
export const secretLookingKeys = (env: Record<string, string>): string[] => {
  return Object.keys(env).filter(isSecretLookingName);
};
/**
 * Human-readable label for the layer a resolved value won from. Used as `ResolvedEnv.sources[key]`
 * and rendered verbatim in the `--print-env` table, so it doubles as the documented precedence
 * vocabulary. File layers carry their actual filename (`.env`, `.env.production`, `.env.local`).
 */
export const ENV_SOURCE = {
  flag: '--env (flag)',
  secret: 'keychain secret',
  profile: 'profile env:',
  local: '.env.local',
} as const;
/**
 * The resolved build/update/release environment plus where each value came from.
 *
 * `values` is the flat map injected into the command's subprocess; `sources` maps each key to the
 * winning layer's {@link ENV_SOURCE} label (or a `.env*` filename) for provenance in `--print-env`.
 * The two maps always share the same keys. `excluded` lists the `envExclude` names that were actually
 * set by some layer and then dropped - surfaced in the build log and exempted from the missing-key gate.
 */
export type ResolvedEnv = {
  values: Record<string, string>;
  sources: Record<string, string>;
  excluded: string[];
};
/**
 * Inputs to {@link resolveEnv}. `secrets` (keychain) and `cliEnv` (`--env` flags) are pre-resolved by
 * the caller; the dotenv files are read here from `appDir`. `includeLocal` opts `.env.local` in
 * (off by default to avoid surprise local env). `envFile` renames the base file (default `.env`).
 * `envExclude` names are dropped after all layers merge - see {@link resolveEnv}.
 */
export type ResolveEnvInput = {
  appDir: string;
  profileName: string;
  profileEnv?: Record<string, string> | undefined;
  envFile?: string | undefined;
  secrets?: Record<string, string> | undefined;
  cliEnv?: Record<string, string> | undefined;
  includeLocal?: boolean | undefined;
  envExclude?: string[] | undefined;
};
/**
 * Resolve env through the single precedence ladder (lowest -> highest, later overrides earlier):
 * `.env` (base) -> `.env.<profile>` -> `.env.local` (only with `includeLocal`) -> profile `env:` ->
 * keychain secrets -> `--env` flags. This is THE definition of env precedence for the whole CLI;
 * build, release, and update all resolve through it so they never drift (issue #25). Pure: does no
 * keychain or process work beyond reading the dotenv files.
 *
 * `envExclude` is a hard denylist: a name matched by the list (an exact name, or a `PREFIX*` wildcard -
 * see {@link isEnvExcluded}) is dropped from EVERY layer, so it can never reach the build subprocess no
 * matter which layer set it - even an explicit `--env`. Exclusion beats precedence by design; to inject
 * such a name you drop it from the list.
 */
export const resolveEnv = (input: ResolveEnvInput) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    let baseFile = input.envFile;
    if (baseFile === undefined) baseFile = '.env';
    const layers: {
      source: string;
      vars: Record<string, string>;
    }[] = [
      { source: baseFile, vars: yield* loadDotenvFile(pathService.join(input.appDir, baseFile)) },
      {
        source: `.env.${input.profileName}`,
        vars: yield* loadDotenvFile(pathService.join(input.appDir, `.env.${input.profileName}`)),
      },
    ];
    if (input.includeLocal) {
      layers.push({
        source: ENV_SOURCE.local,
        vars: yield* loadDotenvFile(pathService.join(input.appDir, '.env.local')),
      });
    }
    let profileEnvironment: Record<string, string> = {};
    if (input.profileEnv !== undefined) profileEnvironment = input.profileEnv;
    let secretEnvironment: Record<string, string> = {};
    if (input.secrets !== undefined) secretEnvironment = input.secrets;
    let cliEnvironment: Record<string, string> = {};
    if (input.cliEnv !== undefined) cliEnvironment = input.cliEnv;
    layers.push({ source: ENV_SOURCE.profile, vars: profileEnvironment });
    layers.push({ source: ENV_SOURCE.secret, vars: secretEnvironment });
    layers.push({ source: ENV_SOURCE.flag, vars: cliEnvironment });
    // Hard denylist: an excluded name is skipped in EVERY layer, so it can never land in the result no
    // matter which layer (incl. the final `--env`) set it - exclusion wins over precedence by design. Names
    // some layer actually tried to set are recorded, so the build log reports real drops, not the raw list.
    let excludedPatterns: string[] = [];
    if (input.envExclude !== undefined) excludedPatterns = input.envExclude;
    const excludedSeen = new Set<string>();
    const values: Record<string, string> = {};
    const sources: Record<string, string> = {};
    for (const layer of layers) {
      for (const [key, environmentValue] of Object.entries(layer.vars)) {
        if (excludedPatterns.length > 0 && isEnvExcluded(key, excludedPatterns)) {
          excludedSeen.add(key);
          continue;
        }
        values[key] = environmentValue;
        sources[key] = layer.source;
      }
    }
    return { values, sources, excluded: [...excludedSeen] };
  });
/**
 * Parse repeated `--env KEY=VALUE` flags into a map. Splits on the FIRST `=` so values may contain
 * `=` (e.g. a DSN or base64). Throws on a pair with no `=` or an empty key so a typo fails loudly
 * rather than silently dropping an override.
 */
export type CliEnvironmentFailure = Readonly<{
  readonly _tag: 'CliEnvironmentFailure';
  readonly message: string;
}>;
export const makeCliEnvironmentFailure =
  Data.tagged<CliEnvironmentFailure>('CliEnvironmentFailure');
export const parseCliEnv = (
  pairs: string[],
): Effect.Effect<Record<string, string>, CliEnvironmentFailure> =>
  Effect.gen(function* () {
    const out: Record<string, string> = {};
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq === -1)
        return yield* Effect.fail(
          makeCliEnvironmentFailure({ message: `Invalid --env "${pair}". Use --env KEY=VALUE.` }),
        );
      const key = pair.slice(0, eq).trim();
      if (key === '')
        return yield* Effect.fail(
          makeCliEnvironmentFailure({ message: `Invalid --env "${pair}". The key is empty.` }),
        );
      out[key] = pair.slice(eq + 1);
    }
    return out;
  });
/**
 * Render a resolved env as a masked provenance table for `--print-env`: `KEY  VALUE  SOURCE`, sorted
 * by key. Values are masked when the name looks secret ({@link isSecretLookingName}) or came from the
 * keychain - so the table is safe to paste - while non-secret values show in full for verification.
 */
export const formatEnvTable = (resolved: ResolvedEnv): string => {
  const keys = Object.keys(resolved.values).sort();
  if (keys.length === 0) return '(no env vars resolved)';
  const environmentEntries = keys.map((key) => {
    let masked = isSecretLookingName(key);
    if (!masked) masked = resolved.sources[key] === ENV_SOURCE.secret;
    let environmentValue = resolved.values[key];
    if (environmentValue === undefined) environmentValue = '';
    let environmentSource = resolved.sources[key];
    if (environmentSource === undefined) environmentSource = '';
    let displayedValue = environmentValue;
    if (masked) displayedValue = '------';
    return {
      key,
      value: displayedValue,
      source: environmentSource,
    };
  });
  const keyWidth = Math.max(
    'KEY'.length,
    ...environmentEntries.map((environmentEntry) => environmentEntry.key.length),
  );
  const valueWidth = Math.max(
    'VALUE'.length,
    ...environmentEntries.map((environmentEntry) => environmentEntry.value.length),
  );
  const header = `${'KEY'.padEnd(keyWidth)}  ${'VALUE'.padEnd(valueWidth)}  SOURCE`;
  const lines = environmentEntries.map(
    (environmentEntry) =>
      `${environmentEntry.key.padEnd(keyWidth)}  ${environmentEntry.value.padEnd(valueWidth)}  ${environmentEntry.source}`,
  );
  return [header, ''.repeat(header.length), ...lines].join('\n');
};
/**
 * Per-key provenance rows for the in-build env log: `KEY  source`, sorted by key with the key column
 * padded so sources line up. Unlike {@link formatEnvTable} this renders NO values - not even masked
 * ones - because the build log's only job is to show WHICH vars, and from WHICH layer, are being
 * injected into the bundle; with no values present there's nothing to leak. Empty array when no env
 * resolved. Pairs with the count summary `prepareBuild` logs above it, so a run visibly confirms the
 * layered env is reaching the build (issue #109, where local iOS silently dropped everything above
 * the app's own `.env`).
 */
export const envInjectionRows = (resolved: ResolvedEnv): string[] => {
  const keys = Object.keys(resolved.values).sort();
  if (keys.length === 0) return [];
  const keyWidth = Math.max(...keys.map((key) => key.length));
  return keys.map((key) => {
    let environmentSource = resolved.sources[key];
    if (environmentSource === undefined) environmentSource = '';
    return `${key.padEnd(keyWidth)}  ${environmentSource}`;
  });
};
