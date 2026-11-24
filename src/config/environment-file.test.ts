import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ENV_SOURCE,
  isEnvExcluded,
  loadDotenvFile,
  missingKeys,
  keepBuildEnvironment,
  parseCliEnv,
  parseDotenv,
  readEnv,
  secretLookingKeys,
} from './environment-file.ts';
import { expectDefined } from '../testkit/expect-defined.ts';
const tempDirs: string[] = [];

async function runEnvEffect<Success>(envWork: Promise<Success>): Promise<Success> {
  return envWork;
}

function makeTempDir(): string {
  const systemTemporaryDirectory = tmpdir();
  const joinedPath = join(systemTemporaryDirectory, 'launch-env-');
  const dir = mkdtempSync(joinedPath);

  tempDirs.push(dir);

  return dir;
}

function cleanup() {
  while (tempDirs.length > 0) {
    rmSync(expectDefined(tempDirs.pop(), 'temp dir'), { recursive: true, force: true });
  }
}

afterEach(cleanup);

function describeParseDotenv() {
  function skipsBlanksAndCommentsDropsExportAndTrimsKeys() {
    const parsed = parseDotenv('# comment\n\nexport FOO=bar\n  BAZ = qux  \n');
    expect(parsed).toEqual({ FOO: 'bar', BAZ: 'qux' });
  }

  it(
    'skips blanks and comments, drops `export`, and trims keys',
    skipsBlanksAndCommentsDropsExportAndTrimsKeys,
  );

  function keepsInsideValuesAndStripsMatchingSurroundingQuotes() {
    const parsed = parseDotenv(`DSN="postgres://u:p@h/db?x=1"\nQUOTED='a=b'\nBARE=a=b`);
    expect(parsed['DSN']).toBe('postgres://u:p@h/db?x=1');
    expect(parsed['QUOTED']).toBe('a=b');
    expect(parsed['BARE']).toBe('a=b');
  }

  it(
    'keeps `=` inside values and strips matching surrounding quotes',
    keepsInsideValuesAndStripsMatchingSurroundingQuotes,
  );

  function ignoresLinesWithoutAn() {
    const dotenv = parseDotenv('JUST_A_WORD\nA=1');
    expect(dotenv).toEqual({ A: '1' });
  }

  it('ignores lines without an `=`', ignoresLinesWithoutAn);
}

describe('parseDotenv', describeParseDotenv);

function describeLoadDotenvFile() {
  async function returnsAnEmptyObjectWhenTheFileIsAbsent() {
    const makeDir = makeTempDir();
    const nopePath = join(makeDir, 'nope.env');
    const dotenvFile = loadDotenvFile(nopePath);
    const runEffect = await runEnvEffect(dotenvFile);

    expect(runEffect).toEqual({});
  }

  it('returns an empty object when the file is absent', returnsAnEmptyObjectWhenTheFileIsAbsent);

  async function parsesAnExistingFile() {
    const dir = makeTempDir();
    const path = join(dir, '.env');

    writeFileSync(path, 'API_URL=https://example.com\n');

    const dotenvFile = loadDotenvFile(path);
    const runEffect = await runEnvEffect(dotenvFile);

    expect(runEffect).toEqual({ API_URL: 'https://example.com' });
  }

  it('parses an existing file', parsesAnExistingFile);
}

describe('loadDotenvFile', describeLoadDotenvFile);

function describeMissingKeysFailBeforeAWastedBuild() {
  async function returnsNothingWhenThereIsNoPieceExampleToValidateAgainst() {
    const makeDir = makeTempDir();
    const runEffect = await runEnvEffect(missingKeys(makeDir, { ANYTHING: '1' }));
    expect(runEffect).toEqual([]);
  }

  it(
    'returns nothing when there is no .env.example to validate against',
    returnsNothingWhenThereIsNoPieceExampleToValidateAgainst,
  );

  async function flagsKeysTheExampleDocumentsButThePieceOmitsOrLeavesEmpty() {
    const dir = makeTempDir();
    const joinedPath = join(dir, '.env.example');

    writeFileSync(joinedPath, 'API_URL=\nFEATURE_FLAG=\nPRESENT=\n');
    expect(
      (await runEnvEffect(missingKeys(dir, { PRESENT: 'yes', EMPTY_ONE: '' }))).sort(),
    ).toEqual(['API_URL', 'FEATURE_FLAG']);
  }

  it(
    'flags keys the example documents but the env omits or leaves empty',
    flagsKeysTheExampleDocumentsButThePieceOmitsOrLeavesEmpty,
  );

  async function exemptsAnExcludedKeySoDocumentingABackendOnlySecretDoesnTTripTheGate() {
    const dir = makeTempDir();
    const joinedPath = join(dir, '.env.example');

    writeFileSync(joinedPath, 'API_URL=\nOPENAI_API_KEY=\n');

    // OPENAI_API_KEY is documented but excluded -> not "missing"; API_URL still is.
    const runEffect = await runEnvEffect(missingKeys(dir, {}, ['OPENAI_API_KEY']));

    expect(runEffect).toEqual(['API_URL']);
  }

  it(
    "exempts an excluded key so documenting a backend-only secret doesn't trip the gate",
    exemptsAnExcludedKeySoDocumentingABackendOnlySecretDoesnTTripTheGate,
  );

  async function exemptsKeysMatchedByAnPieceExcludePrefixEvenWhenNoLayerSetsThem() {
    const dir = makeTempDir();
    const joinedPath = join(dir, '.env.example');

    writeFileSync(joinedPath, 'API_URL=\nOPENAI_API_KEY=\nOPENAI_ORG_ID=\n');

    // `OPENAI_*` covers both OPENAI_ keys though neither is set; API_URL is still missing.
    const runEffect = await runEnvEffect(missingKeys(dir, {}, ['OPENAI_*']));

    expect(runEffect).toEqual(['API_URL']);
  }

  it(
    'exempts keys matched by an envExclude prefix even when no layer sets them',
    exemptsKeysMatchedByAnPieceExcludePrefixEvenWhenNoLayerSetsThem,
  );
}

describe('missingKeys - fail before a wasted build', describeMissingKeysFailBeforeAWastedBuild);

function describeIsPieceExcludedExactNamesAndPREFIXWildcards() {
  function matchesExactNamesCaseSensitively() {
    const isExcluded = isEnvExcluded('OPENAI_API_KEY', ['OPENAI_API_KEY']);
    expect(isExcluded).toBe(true);
    expect(isEnvExcluded('OPENAI_API_KEY', ['openai_api_key'])).toBe(false);
    expect(isEnvExcluded('OTHER', ['OPENAI_API_KEY'])).toBe(false);
  }

  it('matches exact names case-sensitively', matchesExactNamesCaseSensitively);

  function treatsATrailingAsAStartAnchoredPrefix() {
    const isExcluded = isEnvExcluded('OPENAI_API_KEY', ['OPENAI_*']);
    expect(isExcluded).toBe(true);
    expect(isEnvExcluded('OPENAI_ORG_ID', ['OPENAI_*'])).toBe(true);
    expect(isEnvExcluded('MY_OPENAI_KEY', ['OPENAI_*'])).toBe(false); // anchored at the start, not mid-string
  }

  it('treats a trailing * as a start-anchored prefix', treatsATrailingAsAStartAnchoredPrefix);

  function hasNoSuffixFormSoAPublishableKEYNameIsNeverCaughtByASecretOrientedPrefix() {
    const isExcluded = isEnvExcluded('EXPO_PUBLIC_POSTHOG_KEY', ['OPENAI_*', 'SENTRY_AUTH_TOKEN']);
    expect(isExcluded).toBe(false);
  }

  it(
    'has no suffix form, so a publishable *_KEY name is never caught by a secret-oriented prefix',
    hasNoSuffixFormSoAPublishableKEYNameIsNeverCaughtByASecretOrientedPrefix,
  );
}

describe(
  'isEnvExcluded - exact names and PREFIX* wildcards',
  describeIsPieceExcludedExactNamesAndPREFIXWildcards,
);

function describeSecretLookingKeysGentleGuardAgainstBundlingASecret() {
  function flagsObviousSecretNamesAndUnqualifiedKEYNames() {
    const flagged = secretLookingKeys({
      STRIPE_SECRET: 'x',
      DB_PASSWORD: 'x',
      SESSION_TOKEN: 'x',
      PRIVATE_THING: 'x',
      API_KEY: 'x',
      DATABASE_URL: 'x',
    });

    expect(flagged.sort()).toEqual([
      'API_KEY',
      'DATABASE_URL',
      'DB_PASSWORD',
      'PRIVATE_THING',
      'SESSION_TOKEN',
      'STRIPE_SECRET',
    ]);
  }

  it(
    'flags obvious secret names and unqualified *_KEY names',
    flagsObviousSecretNamesAndUnqualifiedKEYNames,
  );

  function doesNotFlagPublishablePublicClientKeysOrPlainPiece() {
    const flagged = secretLookingKeys({
      STRIPE_PUBLISHABLE_KEY: 'x',
      EXPO_PUBLIC_API_KEY: 'x',
      CLIENT_KEY: 'x',
      API_URL: 'x',
      APP_NAME: 'x',
    });

    expect(flagged).toEqual([]);
  }

  it(
    'does not flag publishable/public/client keys or plain config',
    doesNotFlagPublishablePublicClientKeysOrPlainPiece,
  );
}

describe(
  'secretLookingKeys - gentle guard against bundling a secret',
  describeSecretLookingKeysGentleGuardAgainstBundlingASecret,
);

function describeKeepBuildEnvironment() {
  function dropsFileSecretsAndKeepsExplicitOnes() {
    const kept = keepBuildEnvironment({
      values: {
        API_TOKEN: 'from-file',
        DATABASE_URL: 'postgres://db.example/app',
        EXPO_PUBLIC_API_KEY: 'pk_visible',
        SIGNING_TOKEN: 'from-keychain',
        ONE_OFF_TOKEN: 'from-flag',
        APP_NAME: 'Demo',
      },
      sources: {
        API_TOKEN: '.env',
        DATABASE_URL: '.env.production',
        EXPO_PUBLIC_API_KEY: '.env',
        SIGNING_TOKEN: ENV_SOURCE.secret,
        ONE_OFF_TOKEN: ENV_SOURCE.flag,
        APP_NAME: '.env',
      },
      excluded: [],
    });

    expect(kept.omittedCount).toBe(2);
    expect(kept.environment.values).toEqual({
      EXPO_PUBLIC_API_KEY: 'pk_visible',
      SIGNING_TOKEN: 'from-keychain',
      ONE_OFF_TOKEN: 'from-flag',
      APP_NAME: 'Demo',
    });
    expect(JSON.stringify(kept)).not.toContain('from-file');
    expect(JSON.stringify(kept)).not.toContain('postgres://');
  }

  it('drops file secrets and keeps keychain and flag values', dropsFileSecretsAndKeepsExplicitOnes);
}

describe('keepBuildEnvironment', describeKeepBuildEnvironment);

function describeResolvePieceTheOnePrecedenceLadder() {
  async function layersLowestHighestPiecePieceProfilePieceLocalProfilePieceSecretsFlags() {
    const dir = makeTempDir();
    const joinedPath = join(dir, '.env');

    writeFileSync(joinedPath, 'A=base\nB=base\nC=base\nD=base\nE=base\nF=base\n');
    writeFileSync(
      join(dir, '.env.production'),
      'B=profileFile\nC=profileFile\nD=profileFile\nE=profileFile\nF=profileFile\n',
    );
    writeFileSync(join(dir, '.env.local'), 'C=local\nD=local\nE=local\nF=local\n');

    const environmentRead = readEnv({
      appDir: dir,
      profileName: 'production',
      includeLocal: true,
      profileEnv: { D: 'profileInline', E: 'profileInline', F: 'profileInline' },
      secrets: { E: 'secret', F: 'secret' },
      cliEnv: { F: 'flag' },
    });
    const commandEnvironment = await runEnvEffect(environmentRead);

    expect(commandEnvironment.values).toEqual({
      A: 'base',
      B: 'profileFile',
      C: 'local',
      D: 'profileInline',
      E: 'secret',
      F: 'flag',
    });
    expect(commandEnvironment.sources).toEqual({
      A: '.env',
      B: '.env.production',
      C: ENV_SOURCE.local,
      D: ENV_SOURCE.profile,
      E: ENV_SOURCE.secret,
      F: ENV_SOURCE.flag,
    });
  }

  it(
    'layers lowest->highest: .env < .env.<profile> < .env.local < profile env: < secrets < flags',
    layersLowestHighestPiecePieceProfilePieceLocalProfilePieceSecretsFlags,
  );

  async function omitsPieceLocalUnlessIncludeLocalIsSet() {
    const dir = makeTempDir();
    const joinedPath = join(dir, '.env');

    writeFileSync(joinedPath, 'X=base\n');
    writeFileSync(join(dir, '.env.local'), 'X=local\n');

    const environmentRead = readEnv({ appDir: dir, profileName: 'production' });
    const runEffect = await runEnvEffect(environmentRead);

    expect(runEffect.values).toEqual({
      X: 'base',
    });
    expect(
      (await runEnvEffect(readEnv({ appDir: dir, profileName: 'production', includeLocal: true })))
        .values,
    ).toEqual({ X: 'local' });
  }

  it('omits .env.local unless includeLocal is set', omitsPieceLocalUnlessIncludeLocalIsSet);

  async function renamesTheBaseFileViaPieceFileAndStillDerivesPieceProfileByName() {
    const dir = makeTempDir();
    const customPath = join(dir, 'custom.env');

    writeFileSync(customPath, 'A=fromCustom\nB=fromCustom\n');

    const joinedPath = join(dir, '.env.staging');

    writeFileSync(joinedPath, 'B=fromProfileFile\n');

    const environmentRead = readEnv({ appDir: dir, profileName: 'staging', envFile: 'custom.env' });
    const commandEnvironment = await runEnvEffect(environmentRead);

    expect(commandEnvironment.values).toEqual({ A: 'fromCustom', B: 'fromProfileFile' });
    expect(commandEnvironment.sources).toEqual({ A: 'custom.env', B: '.env.staging' });
  }

  it(
    'renames the base file via envFile and still derives .env.<profile> by name',
    renamesTheBaseFileViaPieceFileAndStillDerivesPieceProfileByName,
  );

  async function returnsEmptyMapsWhenNothingResolves() {
    const makeDir = makeTempDir();
    const environmentRead = readEnv({ appDir: makeDir, profileName: 'production' });
    const commandEnvironment = await runEnvEffect(environmentRead);

    expect(commandEnvironment.values).toEqual({});
    expect(commandEnvironment.sources).toEqual({});
    expect(commandEnvironment.excluded).toEqual([]);
  }

  it('returns empty maps when nothing resolves', returnsEmptyMapsWhenNothingResolves);

  async function dropsPieceExcludeNamesAfterEveryLayerMergesEvenAnExplicitPieceAndRecordsThem() {
    const dir = makeTempDir();
    const joinedPath = join(dir, '.env');

    writeFileSync(joinedPath, 'KEEP=base\nFROM_FILE=base\n');

    const environmentRead = readEnv({
      appDir: dir,
      profileName: 'production',
      secrets: { FROM_SECRET: 'kc' },
      cliEnv: { FROM_FLAG: 'flag' },
      envExclude: ['FROM_FILE', 'FROM_SECRET', 'FROM_FLAG', 'NEVER_SET'],
    });
    const commandEnvironment = await runEnvEffect(environmentRead);

    // Exclusion wins over precedence: gone no matter which layer set it (file / keychain / flag).
    expect(commandEnvironment.values).toEqual({ KEEP: 'base' });
    expect(commandEnvironment.sources).toEqual({ KEEP: '.env' });
    // Only names actually present are reported dropped - NEVER_SET is silently ignored.
    expect(commandEnvironment.excluded.sort()).toEqual(['FROM_FILE', 'FROM_FLAG', 'FROM_SECRET']);
  }

  it(
    'drops envExclude names after every layer merges - even an explicit --env - and records them',
    dropsPieceExcludeNamesAfterEveryLayerMergesEvenAnExplicitPieceAndRecordsThem,
  );

  async function recordsNoExclusionsWhenPieceExcludeIsAbsentOrEmpty() {
    const dir = makeTempDir();
    const joinedPath = join(dir, '.env');

    writeFileSync(joinedPath, 'A=1\n');

    const environmentRead = readEnv({ appDir: dir, profileName: 'production' });
    const runEffect = await runEnvEffect(environmentRead);

    expect(runEffect.excluded).toEqual([]);
    expect(
      (await runEnvEffect(readEnv({ appDir: dir, profileName: 'production', envExclude: [] })))
        .excluded,
    ).toEqual([]);
  }

  it(
    'records no exclusions when envExclude is absent or empty',
    recordsNoExclusionsWhenPieceExcludeIsAbsentOrEmpty,
  );

  async function supportsPREFIXEntriesSoAFamilyOfBackendKeysCollapsesToOneLine() {
    const dir = makeTempDir();
    const joinedPath = join(dir, '.env');

    writeFileSync(joinedPath, 'OPENAI_API_KEY=x\nOPENAI_ORG_ID=y\nKEEP=z\n');

    const environmentRead = readEnv({
      appDir: dir,
      profileName: 'production',
      envExclude: ['OPENAI_*'],
    });
    const commandEnvironment = await runEnvEffect(environmentRead);

    expect(commandEnvironment.values).toEqual({ KEEP: 'z' });
    expect(commandEnvironment.excluded.sort()).toEqual(['OPENAI_API_KEY', 'OPENAI_ORG_ID']);
  }

  it(
    'supports PREFIX* entries so a family of backend keys collapses to one line',
    supportsPREFIXEntriesSoAFamilyOfBackendKeysCollapsesToOneLine,
  );
}

describe('readEnv - the one precedence ladder', describeResolvePieceTheOnePrecedenceLadder);

function describeParseCliPieceRepeatedPieceKEYVAL() {
  function splitsOnTheFirstAndKeepsInThePiece() {
    const parseCli = parseCliEnv(['A=1', 'DSN=postgres://u:p@h/db?x=1']);

    expect(parseCli).toEqual({
      A: '1',
      DSN: 'postgres://u:p@h/db?x=1',
    });
  }

  it('splits on the first = and keeps = in the value', splitsOnTheFirstAndKeepsInThePiece);

  function throwsOnAPairWithNoOrAnEmptyKey() {
    function callParseCliPiece() {
      return parseCliEnv(['NOPE']);
    }

    expect(callParseCliPiece).toThrow(/Invalid --env/);

    function callParseCliPiece2() {
      return parseCliEnv(['=value']);
    }

    expect(callParseCliPiece2).toThrow(/empty/);
  }

  it('throws on a pair with no = or an empty key', throwsOnAPairWithNoOrAnEmptyKey);
}

describe('parseCliEnv - repeated --env KEY=VAL', describeParseCliPieceRepeatedPieceKEYVAL);
