// Reads local environment files and picks which of those values a build is allowed to keep.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../path-exists.ts';

type CliEnvironmentFailure = Readonly<{
  _tag: 'CliEnvironmentFailure';
  message: string;
}>;

function makeCliEnvironmentFailure(message: string): CliEnvironmentFailure {
  return { _tag: 'CliEnvironmentFailure', message };
}

function stripMatchingQuotes(environmentValue: string): string {
  const startsWithDoubleQuote = environmentValue.startsWith('"');

  if (startsWithDoubleQuote) {
    const endsWithDoubleQuote = environmentValue.endsWith('"');

    if (endsWithDoubleQuote) {
      return environmentValue.slice(1, -1);
    }
  }

  const startsWithSingleQuote = environmentValue.startsWith("'");

  if (startsWithSingleQuote) {
    const endsWithSingleQuote = environmentValue.endsWith("'");

    if (endsWithSingleQuote) {
      return environmentValue.slice(1, -1);
    }
  }

  return environmentValue;
}

/** Parse dotenv text into key->value pairs. */
export function parseDotenv(content: string): Record<string, string> {
  const environmentValues: Record<string, string> = {};

  for (const dotenvLine of content.split('\n')) {
    const line = dotenvLine.trim();

    const isBlank = line == '';

    if (isBlank) {
      continue;
    }

    const isComment = line.startsWith('#');

    if (isComment) {
      continue;
    }

    let withoutExport = line;

    const hasExportPrefix = line.startsWith('export ');

    if (hasExportPrefix) {
      withoutExport = line.slice('export '.length);
    }

    const separatorAt = withoutExport.indexOf('=');
    const hasSeparator = separatorAt != -1;

    if (hasSeparator == false) {
      continue;
    }

    const key = withoutExport.slice(0, separatorAt).trim();
    const hasKey = key != '';

    if (hasKey == false) {
      continue;
    }

    const environmentValue = stripMatchingQuotes(withoutExport.slice(separatorAt + 1).trim());

    environmentValues[key] = environmentValue;
  }

  return environmentValues;
}

/** Read and parse a dotenv file. Returns an empty object if the file does not exist. */
export async function loadDotenvFile(filePath: string): Promise<Record<string, string>> {
  const fileIsPresent = await pathExists(filePath);

  if (fileIsPresent == false) {
    return {};
  }

  try {
    const dotenvText = await readFile(filePath, 'utf8');

    return parseDotenv(dotenvText);
  } catch (error) {
    throw new Error(`Could not read ${filePath}`, { cause: error });
  }
}

function nameMatchesExclusion(name: string, pattern: string): boolean {
  const isPrefix = pattern.endsWith('*');

  if (isPrefix) {
    return name.startsWith(pattern.slice(0, -1));
  }

  return name == pattern;
}

/** Whether an env var NAME is denied by an `envExclude` list. */
export function isEnvExcluded(name: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    const isExcluded = nameMatchesExclusion(name, pattern);

    if (isExcluded) {
      return true;
    }
  }

  return false;
}

/** Compare the profile's env against `.env.example` in the same directory and return the keys */
export async function missingKeys(
  appDirectory: string,
  environment: Record<string, string>,
  excludedPatterns: readonly string[] = [],
): Promise<string[]> {
  const joinedPath = join(appDirectory, '.env.example');
  const exampleEnvironment = await loadDotenvFile(joinedPath);

  function isExampleKeyMissing(environmentName: string): boolean {
    const isExcluded = isEnvExcluded(environmentName, excludedPatterns);

    if (isExcluded) {
      return false;
    }

    const presentValue = environment[environmentName];

    if (presentValue == null) {
      return true;
    }

    return presentValue == '';
  }

  return Object.keys(exampleEnvironment).filter(isExampleKeyMissing);
}

/** Whether a single variable NAME looks like a backend secret */
export function isSecretLookingName(name: string): boolean {
  const isObviouslySecret = /(SECRET|PRIVATE|PASSWORD|PASSWD|TOKEN)/i.test(name);

  if (isObviouslySecret) {
    return true;
  }

  const isDatabaseUrl = /DATABASE_URL$/i.test(name);

  if (isDatabaseUrl) {
    return true;
  }

  const endsWithKey = /_KEY$/i.test(name);

  if (endsWithKey == false) {
    return false;
  }

  const isPublishable = /(PUBLISHABLE|PUBLIC|CLIENT|WEB|ANON)/i.test(name);

  if (isPublishable) {
    return false;
  }

  return true;
}

/** Heuristically flag env keys that look like backend secrets */
export function secretLookingKeys(environment: Record<string, string>): string[] {
  return Object.keys(environment).filter(isSecretLookingName);
}

/** Human-readable label for the layer a resolved value won from. */
export const ENV_SOURCE = {
  flag: '--env (flag)',
  secret: 'keychain secret',
  profile: 'profile env:',
  local: '.env.local',
} as const;

/** The resolved build/update/release environment plus where each value came from. */
export type ResolvedEnv = {
  values: Record<string, string>;
  sources: Record<string, string>;
  excluded: string[];
};

function isExplicitBuildSource(environmentSource: string | undefined): boolean {
  if (environmentSource == ENV_SOURCE.secret) {
    return true;
  }

  return environmentSource == ENV_SOURCE.flag;
}

function shouldOmitFromBuild(
  environmentName: string,
  environmentSource: string | undefined,
): boolean {
  const looksSecret = isSecretLookingName(environmentName);

  if (looksSecret == false) {
    return false;
  }

  return isExplicitBuildSource(environmentSource) == false;
}

/** Drop file and profile secrets. Keychain values and `--env` overrides stay. */
export function keepBuildEnvironment(resolved: ResolvedEnv): {
  environment: ResolvedEnv;
  omittedCount: number;
} {
  const values: Record<string, string> = {};
  const sources: Record<string, string> = {};
  let omittedCount = 0;

  for (const environmentName of Object.keys(resolved.values)) {
    const environmentValue = resolved.values[environmentName];

    if (environmentValue == null) {
      continue;
    }

    const environmentSource = resolved.sources[environmentName];
    const omitName = shouldOmitFromBuild(environmentName, environmentSource);

    if (omitName) {
      omittedCount += 1;
      continue;
    }

    values[environmentName] = environmentValue;

    if (environmentSource != null) {
      sources[environmentName] = environmentSource;
    }
  }

  return {
    environment: { values, sources, excluded: resolved.excluded },
    omittedCount,
  };
}

/** Inputs to {@link resolveEnv}. */
type ResolveEnvInput = {
  appDir: string;
  profileName: string;
  profileEnv?: Record<string, string> | undefined;
  envFile?: string | undefined;
  secrets?: Record<string, string> | undefined;
  cliEnv?: Record<string, string> | undefined;
  includeLocal?: boolean | undefined;
  envExclude?: readonly string[] | undefined;
};

type EnvLayer = {
  source: string;
  vars: Record<string, string>;
};

/** Resolve env through the single precedence ladder (lowest -> highest, later overrides earlier) */
export async function resolveEnv(input: ResolveEnvInput): Promise<ResolvedEnv> {
  let baseFile = '.env';

  if (input.envFile != null) {
    baseFile = input.envFile;
  }

  const joinedPath = join(input.appDir, baseFile);
  const layers: EnvLayer[] = [
    { source: baseFile, vars: await loadDotenvFile(joinedPath) },
    {
      source: `.env.${input.profileName}`,
      vars: await loadDotenvFile(join(input.appDir, `.env.${input.profileName}`)),
    },
  ];

  if (input.includeLocal) {
    const joinedPath = join(input.appDir, '.env.local');
    const dotenvFile = await loadDotenvFile(joinedPath);

    layers.push({
      source: ENV_SOURCE.local,
      vars: dotenvFile,
    });
  }

  let profileEnvironment: Record<string, string> = {};

  if (input.profileEnv != null) {
    profileEnvironment = input.profileEnv;
  }

  let secretEnvironment: Record<string, string> = {};

  if (input.secrets != null) {
    secretEnvironment = input.secrets;
  }

  let cliEnvironment: Record<string, string> = {};

  if (input.cliEnv != null) {
    cliEnvironment = input.cliEnv;
  }

  layers.push({ source: ENV_SOURCE.profile, vars: profileEnvironment });
  layers.push({ source: ENV_SOURCE.secret, vars: secretEnvironment });
  layers.push({ source: ENV_SOURCE.flag, vars: cliEnvironment });

  let excludedPatterns: readonly string[] = [];

  if (input.envExclude != null) {
    excludedPatterns = input.envExclude;
  }

  const excludedSeen = new Set<string>();
  const values: Record<string, string> = {};
  const sources: Record<string, string> = {};

  for (const layer of layers) {
    for (const [key, environmentValue] of Object.entries(layer.vars)) {
      const hasExclusions = excludedPatterns.length > 0;

      if (hasExclusions) {
        const isExcluded = isEnvExcluded(key, excludedPatterns);

        if (isExcluded) {
          excludedSeen.add(key);
          continue;
        }
      }

      values[key] = environmentValue;
      sources[key] = layer.source;
    }
  }

  return { values, sources, excluded: [...excludedSeen] };
}

/** Parse repeated `--env KEY=VALUE` flags into a map. */
export function parseCliEnv(pairs: string[]): Record<string, string> {
  const parsedPairs: Record<string, string> = {};

  for (const pair of pairs) {
    const separatorAt = pair.indexOf('=');
    const hasSeparator = separatorAt != -1;

    if (hasSeparator == false) {
      throw makeCliEnvironmentFailure(`Invalid --env "${pair}". Use --env KEY=VALUE.`);
    }

    const key = pair.slice(0, separatorAt).trim();

    const keyIsEmpty = key == '';

    if (keyIsEmpty) {
      throw makeCliEnvironmentFailure(`Invalid --env "${pair}". The key is empty.`);
    }

    parsedPairs[key] = pair.slice(separatorAt + 1);
  }

  return parsedPairs;
}
