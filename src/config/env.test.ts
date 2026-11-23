import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ENV_SOURCE,
  envInjectionRows,
  formatEnvTable,
  isEnvExcluded,
  loadDotenvFile,
  missingKeys,
  parseCliEnv,
  parseDotenv,
  resolveEnv,
  secretLookingKeys,
} from './env.ts';
import { expectDefined } from '../testkit/assertions-testkit.ts';
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
    });

    expect(flagged.sort()).toEqual([
      'API_KEY',
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

    const resolve = resolveEnv({
      appDir: dir,
      profileName: 'production',
      includeLocal: true,
      profileEnv: { D: 'profileInline', E: 'profileInline', F: 'profileInline' },
      secrets: { E: 'secret', F: 'secret' },
      cliEnv: { F: 'flag' },
    });
    const resolved = await runEnvEffect(resolve);

    expect(resolved.values).toEqual({
      A: 'base',
      B: 'profileFile',
      C: 'local',
      D: 'profileInline',
      E: 'secret',
      F: 'flag',
    });
    expect(resolved.sources).toEqual({
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

    const resolve = resolveEnv({ appDir: dir, profileName: 'production' });
    const runEffect = await runEnvEffect(resolve);

    expect(runEffect.values).toEqual({
      X: 'base',
    });
    expect(
      (
        await runEnvEffect(
          resolveEnv({ appDir: dir, profileName: 'production', includeLocal: true }),
        )
      ).values,
    ).toEqual({ X: 'local' });
  }

  it('omits .env.local unless includeLocal is set', omitsPieceLocalUnlessIncludeLocalIsSet);

  async function renamesTheBaseFileViaPieceFileAndStillDerivesPieceProfileByName() {
    const dir = makeTempDir();
    const customPath = join(dir, 'custom.env');

    writeFileSync(customPath, 'A=fromCustom\nB=fromCustom\n');

    const joinedPath = join(dir, '.env.staging');

    writeFileSync(joinedPath, 'B=fromProfileFile\n');

    const resolve = resolveEnv({ appDir: dir, profileName: 'staging', envFile: 'custom.env' });
    const resolved = await runEnvEffect(resolve);

    expect(resolved.values).toEqual({ A: 'fromCustom', B: 'fromProfileFile' });
    expect(resolved.sources).toEqual({ A: 'custom.env', B: '.env.staging' });
  }

  it(
    'renames the base file via envFile and still derives .env.<profile> by name',
    renamesTheBaseFileViaPieceFileAndStillDerivesPieceProfileByName,
  );

  async function returnsEmptyMapsWhenNothingResolves() {
    const makeDir = makeTempDir();
    const resolve = resolveEnv({ appDir: makeDir, profileName: 'production' });
    const resolved = await runEnvEffect(resolve);

    expect(resolved.values).toEqual({});
    expect(resolved.sources).toEqual({});
    expect(resolved.excluded).toEqual([]);
  }

  it('returns empty maps when nothing resolves', returnsEmptyMapsWhenNothingResolves);

  async function dropsPieceExcludeNamesAfterEveryLayerMergesEvenAnExplicitPieceAndRecordsThem() {
    const dir = makeTempDir();
    const joinedPath = join(dir, '.env');

    writeFileSync(joinedPath, 'KEEP=base\nFROM_FILE=base\n');

    const resolve = resolveEnv({
      appDir: dir,
      profileName: 'production',
      secrets: { FROM_SECRET: 'kc' },
      cliEnv: { FROM_FLAG: 'flag' },
      envExclude: ['FROM_FILE', 'FROM_SECRET', 'FROM_FLAG', 'NEVER_SET'],
    });
    const resolved = await runEnvEffect(resolve);

    // Exclusion wins over precedence: gone no matter which layer set it (file / keychain / flag).
    expect(resolved.values).toEqual({ KEEP: 'base' });
    expect(resolved.sources).toEqual({ KEEP: '.env' });
    // Only names actually present are reported dropped - NEVER_SET is silently ignored.
    expect(resolved.excluded.sort()).toEqual(['FROM_FILE', 'FROM_FLAG', 'FROM_SECRET']);
  }

  it(
    'drops envExclude names after every layer merges - even an explicit --env - and records them',
    dropsPieceExcludeNamesAfterEveryLayerMergesEvenAnExplicitPieceAndRecordsThem,
  );

  async function recordsNoExclusionsWhenPieceExcludeIsAbsentOrEmpty() {
    const dir = makeTempDir();
    const joinedPath = join(dir, '.env');

    writeFileSync(joinedPath, 'A=1\n');

    const resolve = resolveEnv({ appDir: dir, profileName: 'production' });
    const runEffect = await runEnvEffect(resolve);

    expect(runEffect.excluded).toEqual([]);
    expect(
      (await runEnvEffect(resolveEnv({ appDir: dir, profileName: 'production', envExclude: [] })))
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

    const resolve = resolveEnv({
      appDir: dir,
      profileName: 'production',
      envExclude: ['OPENAI_*'],
    });
    const resolved = await runEnvEffect(resolve);

    expect(resolved.values).toEqual({ KEEP: 'z' });
    expect(resolved.excluded.sort()).toEqual(['OPENAI_API_KEY', 'OPENAI_ORG_ID']);
  }

  it(
    'supports PREFIX* entries so a family of backend keys collapses to one line',
    supportsPREFIXEntriesSoAFamilyOfBackendKeysCollapsesToOneLine,
  );
}

describe('resolveEnv - the one precedence ladder', describeResolvePieceTheOnePrecedenceLadder);
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
function describeFormatPieceTableMaskedProvenanceForPrintPiece() {
  function masksSecretLookingNamesAndKeychainValuesShowsTheRestLabelsSources() {
    const table = formatEnvTable({
      values: {
        API_URL: 'https://example.test',
        API_TOKEN: 'tok_distinct',
        FEATURE: 'kc_distinct',
      },
      sources: { API_URL: '.env', API_TOKEN: ENV_SOURCE.flag, FEATURE: ENV_SOURCE.secret },
      excluded: [],
    });

    expect(table).toContain('https://example.test'); // non-secret value shown in full
    expect(table).not.toContain('tok_distinct'); // secret-looking name masked even though it's a flag
    expect(table).not.toContain('kc_distinct'); // keychain-sourced value masked even with an innocuous name
    expect(table).toContain('------');
    expect(table).toContain('.env');
  }

  it(
    'masks secret-looking names and keychain values, shows the rest, labels sources',
    masksSecretLookingNamesAndKeychainValuesShowsTheRestLabelsSources,
  );

  function reportsWhenNothingResolved() {
    const formatTable = formatEnvTable({ values: {}, sources: {}, excluded: [] });
    expect(formatTable).toBe('(no env vars resolved)');
  }

  it('reports when nothing resolved', reportsWhenNothingResolved);
}

describe(
  'formatEnvTable - masked provenance for --print-env',
  describeFormatPieceTableMaskedProvenanceForPrintPiece,
);
function describePieceInjectionRowsKeyPieceProvenanceForTheInBuildLogNoValues() {
  function returnsOneSortedKEYPiecePiecePerVarAndNeverThePiece() {
    const rows = envInjectionRows({
      values: { EXPO_PUBLIC_CDN: 'https://real.cdn', API_KEY: 'tok_distinct', APP_NAME: 'Acme' },
      sources: { EXPO_PUBLIC_CDN: ENV_SOURCE.flag, API_KEY: ENV_SOURCE.secret, APP_NAME: '.env' },
      excluded: [],
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^API_KEY\s+keychain secret$/); // sorted by key, source labelled
    expect(rows[1]).toMatch(/^APP_NAME\s+\.env$/);
    expect(rows[2]).toMatch(/^EXPO_PUBLIC_CDN\s+--env \(flag\)$/);

    // The build log proves WHICH vars + source - never a value, so there's nothing to leak.
    const joined = rows.join('\n');

    expect(joined).not.toContain('tok_distinct');
    expect(joined).not.toContain('https://real.cdn');
    expect(joined).not.toContain('Acme');
  }

  it(
    'returns one sorted KEY -> source row per var and never the value',
    returnsOneSortedKEYPiecePiecePerVarAndNeverThePiece,
  );

  function padsKeysSoThePieceColumnAligns() {
    const rows = envInjectionRows({
      values: { A: '1', LONGER_KEY: '2' },
      sources: { A: '.env', LONGER_KEY: '.env' },
      excluded: [],
    });

    expect(rows[0]?.indexOf('.env')).toBe(rows[1]?.indexOf('.env'));
  }

  it('pads keys so the source column aligns', padsKeysSoThePieceColumnAligns);

  function isEmptyWhenNoPieceResolved() {
    const injectionRows = envInjectionRows({ values: {}, sources: {}, excluded: [] });
    expect(injectionRows).toEqual([]);
  }

  it('is empty when no env resolved', isEmptyWhenNoPieceResolved);
}

describe(
  'envInjectionRows - key->source provenance for the in-build log (no values)',
  describePieceInjectionRowsKeyPieceProvenanceForTheInBuildLogNoValues,
);
