import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSecretStore, resetSecretStore } from '../services/credentials/secret-store.ts';
import { resetLaunchEnvironment, useLaunchEnvironment } from '../services/platform/environment.ts';
import {
  resetLaunchDirectories,
  resolveAccountsFilePath,
  resolveCredentialsDirectory,
  useLaunchDirectories,
} from '../services/platform/paths.ts';
import type { AccountRecord, AccountsFile } from '../types/credentials.ts';
import {
  addAccount,
  decideBuildAccount,
  decodeP8,
  encodeP8,
  formatAccountSummary,
  getActiveKeyId,
  listAccounts,
  loadActiveAscKey,
  loadAscKeyForAccount,
  loadAscKeyById,
  matchAccount,
  migrateLegacyAccounts,
  removeAccount,
  renameAccount,
  setAccountVendorNumber,
  setActiveKeyId,
  updateAccountIdentity,
} from './accounts.ts';
import { migrateLegacySigningIndex } from './apple-signing-assets.ts';
const secrets = vi.hoisted(function hoistSecrets() {
  return { store: new Map<string, string>() };
});
const systemTemporaryDirectory = tmpdir();
const launchAccountsTestPath = join(systemTemporaryDirectory, 'launch-accounts-test-');
const homeDirectory = mkdtempSync(launchAccountsTestPath);

vi.mock('./apple-signing-assets.ts', function mockAppleSigningAssets() {
  return {
    migrateLegacySigningIndex: vi.fn(() => Promise.resolve()),
    p12PasswordAccount: (keyId: string) => `dist-cert-p12-password:${keyId}`,
  };
});

function runAccountEffect<Value>(accountWork: Promise<Value>): Promise<Value> {
  return accountWork;
}

function loadActiveKeyWith(environmentVariables: Readonly<Record<string, string | undefined>>) {
  useLaunchEnvironment(environmentVariables);

  return loadActiveAscKey();
}
/** A realistic multi-line PKCS#8 PEM so the base64 round-trip exercises the real decode path. */
const PEM = [
  '-----BEGIN PRIVATE KEY-----',
  'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49',
  '-----END PRIVATE KEY-----',
].join('\n');
function file(active: string | null, ...labels: [string, string][]): AccountsFile {
  function createSavedAccount([keyId, label]: [string, string]) {
    return {
      keyId,
      label,
      issuerId: `issuer-${keyId}`,
      addedAt: 't',
    };
  }

  return {
    active,
    accounts: labels.map(createSavedAccount),
  };
}
function prepare() {
  secrets.store.clear();
  useLaunchDirectories({ homeDirectory, workingDirectory: homeDirectory });
  useSecretStore(secrets.store);
  resetLaunchEnvironment();

  const accountsFilePath = resolveAccountsFilePath();

  rmSync(accountsFilePath, { force: true });

  const credentialsDirectory = resolveCredentialsDirectory();

  rmSync(credentialsDirectory, { recursive: true, force: true });
}

beforeEach(prepare);
function cleanupAll() {
  resetLaunchDirectories();
  resetSecretStore();
  resetLaunchEnvironment();
  rmSync(homeDirectory, { recursive: true, force: true });
}

afterAll(cleanupAll);
function describeEncodeP8DecodeP8() {
  function roundTripsAMultiLinePEMThroughBase64Unchanged() {
    expect(decodeP8(encodeP8(PEM))).toBe(PEM);
    expect(encodeP8(PEM)).not.toContain('\n');
  }

  it(
    'round-trips a multi-line PEM through base64 unchanged',
    roundTripsAMultiLinePEMThroughBase64Unchanged,
  );

  function repairsALegacyHexEncodedPEMMacOSSecurityWCorruption() {
    expect(decodeP8(Buffer.from(PEM, 'utf8').toString('hex'))).toBe(PEM);
  }

  it(
    'repairs a legacy hex-encoded PEM (macOS `security -w` corruption)',
    repairsALegacyHexEncodedPEMMacOSSecurityWCorruption,
  );
}

describe('encodeP8 / decodeP8', describeEncodeP8DecodeP8);
function describePieceAccount() {
  const accounts = file(null, ['AAAA1111', 'Personal'], ['BBBB2222', 'Acme']).accounts;

  function matchesByLabelCaseInsensitively() {
    const account = matchAccount(accounts, 'acme');
    expect(account?.keyId).toBe('BBBB2222');
  }

  it('matches by label, case-insensitively', matchesByLabelCaseInsensitively);

  function matchesByKeyIDCaseInsensitively() {
    const account = matchAccount(accounts, 'aaaa1111');
    expect(account?.keyId).toBe('AAAA1111');
  }

  it('matches by Key ID, case-insensitively', matchesByKeyIDCaseInsensitively);

  function returnsUndefinedForAnUnknownSelector() {
    const account = matchAccount(accounts, 'nope');
    expect(account).toBeUndefined();
  }

  it('returns undefined for an unknown selector', returnsUndefinedForAnUnknownSelector);
}

describe('matchAccount', describePieceAccount);
function describeFormatAccountSummary() {
  const base: AccountRecord = {
    keyId: 'KEYABC1234',
    issuerId: 'issuer-x',
    label: 'default',
    addedAt: 't',
  };

  function degradesToLabelTeamKeyWhenNoAppsAreCached() {
    const accountSummary = formatAccountSummary({ ...base, teamId: 'ABCDE12345' });
    expect(accountSummary).toBe('default - team ABCDE12345 - key KEYABC1234');
  }

  it(
    'degrades to label - team - key when no apps are cached',
    degradesToLabelTeamKeyWhenNoAppsAreCached,
  );

  function omitsTheTeamSegmentWhenTheAccountIsUnresolved() {
    const accountSummary = formatAccountSummary(base);
    expect(accountSummary).toBe('default - key KEYABC1234');
  }

  it(
    'omits the team segment when the account is unresolved',
    omitsTheTeamSegmentWhenTheAccountIsUnresolved,
  );

  function listsUpToThreeAppNamesInlineWithNoNSuffix() {
    const accountSummary = formatAccountSummary({
      ...base,
      teamId: 'ABCDE12345',
      apps: ['Larkspur', 'Beacon', 'Cypress'],
    });

    expect(accountSummary).toBe(
      'default - Larkspur, Beacon, Cypress - team ABCDE12345 - key KEYABC1234',
    );
  }

  it(
    'lists up to three app names inline with no +N suffix',
    listsUpToThreeAppNamesInlineWithNoNSuffix,
  );

  function collapsesTheAppsBeyondTheThirdIntoANCount() {
    const apps = [
      'Larkspur',
      'Beacon',
      'Cypress',
      'Mapleleaf',
      'SampleApp',
      'Dockyard',
      'Everglade',
    ];
    const accountSummary = formatAccountSummary({ ...base, teamId: 'ABCDE12345', apps });

    expect(accountSummary).toBe(
      'default - Larkspur, Beacon, Cypress +4 - team ABCDE12345 - key KEYABC1234',
    );
  }

  it(
    'collapses the apps beyond the third into a +N count',
    collapsesTheAppsBeyondTheThirdIntoANCount,
  );

  function dropsTheLeadingLabelForThePickerHintViaIncludeLabelFalse() {
    const accountSummary = formatAccountSummary(
      { ...base, teamId: 'ABCDE12345', apps: ['Larkspur'] },
      { includeLabel: false },
    );

    expect(accountSummary).toBe('Larkspur - team ABCDE12345 - key KEYABC1234');
  }

  it(
    'drops the leading label for the picker hint via includeLabel:false',
    dropsTheLeadingLabelForThePickerHintViaIncludeLabelFalse,
  );
}

describe('formatAccountSummary', describeFormatAccountSummary);
function describeDecideBuildAccount() {
  function errorsWithAFixWhenNoAccountsExist() {
    expect(decideBuildAccount(file(null))).toEqual({
      kind: 'error',
      message: expect.stringContaining('set-key'),
    });
  }

  it('errors with a fix when no accounts exist', errorsWithAFixWhenNoAccountsExist);

  function usesAnExplicitSelectorPiece() {
    const decision = decideBuildAccount(
      file('AAAA1111', ['AAAA1111', 'Personal'], ['BBBB2222', 'Acme']),
      'Acme',
    );

    expect(decision).toMatchObject({ kind: 'use', record: { keyId: 'BBBB2222' } });
  }

  it('uses an explicit selector match', usesAnExplicitSelectorPiece);

  function errorsWhenTheSelectorMatchesNothing() {
    expect(decideBuildAccount(file('AAAA1111', ['AAAA1111', 'Personal']), 'ghost')).toMatchObject({
      kind: 'error',
    });
  }

  it('errors when the selector matches nothing', errorsWhenTheSelectorMatchesNothing);

  function usesTheActiveAccountWhenNoSelectorIsGiven() {
    const decision = decideBuildAccount(
      file('BBBB2222', ['AAAA1111', 'Personal'], ['BBBB2222', 'Acme']),
    );
    expect(decision).toMatchObject({ kind: 'use', record: { keyId: 'BBBB2222' } });
  }

  it(
    'uses the active account when no selector is given',
    usesTheActiveAccountWhenNoSelectorIsGiven,
  );

  function usesTheSoleAccountWhenNoneIsActive() {
    expect(decideBuildAccount(file(null, ['AAAA1111', 'Personal']))).toMatchObject({
      kind: 'use',
      record: { keyId: 'AAAA1111' },
    });
  }

  it('uses the sole account when none is active', usesTheSoleAccountWhenNoneIsActive);

  function signalsAPickWhenSeveralAccountsExistAndNoneIsActive() {
    expect(decideBuildAccount(file(null, ['AAAA1111', 'Personal'], ['BBBB2222', 'Acme']))).toEqual({
      kind: 'pick',
    });
  }

  it(
    'signals a pick when several accounts exist and none is active',
    signalsAPickWhenSeveralAccountsExistAndNoneIsActive,
  );
}

describe('decideBuildAccount', describeDecideBuildAccount);
function describeRegistryMutations() {
  async function addsAnAccountStoresItsKeyNamespacedAndMakesItActive() {
    const account = addAccount({
      keyId: 'AAAA1111',
      issuerId: 'issuer-a',
      label: 'Personal',
      p8: PEM,
      teamId: 'TEAM1',
    });

    await runAccountEffect(account);

    const activeKeyId = getActiveKeyId();
    const accountEffect = await runAccountEffect(activeKeyId);

    expect(accountEffect).toBe('AAAA1111');
    expect(secrets.store.get('asc-p8:AAAA1111')).toBeDefined();

    const ascKeyById = loadAscKeyById('AAAA1111');
    const loaded = await runAccountEffect(ascKeyById);

    expect(loaded).toEqual({ keyId: 'AAAA1111', issuerId: 'issuer-a', p8: PEM });

    const accounts = listAccounts();

    expect((await runAccountEffect(accounts))[0]).toMatchObject({
      label: 'Personal',
      teamId: 'TEAM1',
      resolvedAt: expect.any(String),
    });
  }

  it(
    'adds an account, stores its key namespaced, and makes it active',
    addsAnAccountStoresItsKeyNamespacedAndMakesItActive,
  );

  async function reAddingTheSameKeyIDUpdatesInPlaceInsteadOfDuplicating() {
    const account = addAccount({
      keyId: 'AAAA1111',
      issuerId: 'issuer-a',
      label: 'Personal',
      p8: PEM,
    });

    await runAccountEffect(account);
    await runAccountEffect(
      addAccount({ keyId: 'AAAA1111', issuerId: 'issuer-a', label: 'Renamed', p8: PEM }),
    );

    const accounts = listAccounts();
    const accountEffect = await runAccountEffect(accounts);

    expect(accountEffect).toHaveLength(1);
    expect((await runAccountEffect(listAccounts()))[0]?.label).toBe('Renamed');
  }

  it(
    're-adding the same Key ID updates in place instead of duplicating',
    reAddingTheSameKeyIDUpdatesInPlaceInsteadOfDuplicating,
  );

  async function switchesTheActiveAccountAndRenamesLabels() {
    const account = addAccount({
      keyId: 'AAAA1111',
      issuerId: 'issuer-a',
      label: 'Personal',
      p8: PEM,
    });

    await runAccountEffect(account);
    await runAccountEffect(
      addAccount({ keyId: 'BBBB2222', issuerId: 'issuer-b', label: 'Acme', p8: PEM }),
    );
    await runAccountEffect(setActiveKeyId('AAAA1111'));

    const activeKeyId = getActiveKeyId();
    const accountEffect = await runAccountEffect(activeKeyId);

    expect(accountEffect).toBe('AAAA1111');
    await runAccountEffect(renameAccount('AAAA1111', 'Home'));

    const accounts = listAccounts();

    expect(matchAccount([...(await runAccountEffect(accounts))], 'Home')?.keyId).toBe('AAAA1111');
  }

  it('switches the active account and renames labels', switchesTheActiveAccountAndRenamesLabels);

  async function cachesResolvedIdentityInPlace() {
    const account = addAccount({
      keyId: 'AAAA1111',
      issuerId: 'issuer-a',
      label: 'Personal',
      p8: PEM,
    });

    await runAccountEffect(account);

    const accountIdentity = updateAccountIdentity('AAAA1111', 'TEAM9', ['Mapleleaf', 'SampleApp']);

    await runAccountEffect(accountIdentity);

    const accounts = listAccounts();
    const accountEffect = await runAccountEffect(accounts);

    expect(accountEffect[0]).toMatchObject({
      teamId: 'TEAM9',
      apps: ['Mapleleaf', 'SampleApp'],
    });
  }

  it('caches resolved identity in place', cachesResolvedIdentityInPlace);

  async function removesAnAccountClearsItsSecretAndRePointsActiveToASurvivor() {
    const account = addAccount({
      keyId: 'AAAA1111',
      issuerId: 'issuer-a',
      label: 'Personal',
      p8: PEM,
    });

    await runAccountEffect(account);
    await runAccountEffect(
      addAccount({ keyId: 'BBBB2222', issuerId: 'issuer-b', label: 'Acme', p8: PEM }),
    ); // becomes active
    await runAccountEffect(removeAccount('BBBB2222'));
    expect(secrets.store.has('asc-p8:BBBB2222')).toBe(false);

    const accounts = listAccounts();
    const accountEffect = await runAccountEffect(accounts);

    expect(accountEffect).toHaveLength(1);

    const activeKeyId = getActiveKeyId();

    expect(await runAccountEffect(activeKeyId)).toBe('AAAA1111');
  }

  it(
    'removes an account, clears its secret, and re-points active to a survivor',
    removesAnAccountClearsItsSecretAndRePointsActiveToASurvivor,
  );
}

describe('registry mutations', describeRegistryMutations);
async function addTwoAccounts() {
  const account = addAccount({
    keyId: 'AAAA1111',
    issuerId: 'issuer-a',
    label: 'Personal',
    p8: PEM,
  });

  await runAccountEffect(account);
  await runAccountEffect(
    addAccount({ keyId: 'BBBB2222', issuerId: 'issuer-b', label: 'Acme', p8: PEM }),
  );
}
function describeLoadActiveAscKey() {
  async function loadsTheActiveAccountWithoutASCACCOUNT() {
    await addTwoAccounts();
    const activeKeyWith = await loadActiveKeyWith({});
    expect(activeKeyWith?.keyId).toBe('BBBB2222');
  }

  it('loads the active account without ASC_ACCOUNT', loadsTheActiveAccountWithoutASCACCOUNT);

  async function loadsTheAccountASCACCOUNTNamesByLabelOrKeyIDInsteadOfTheActiveOne() {
    await addTwoAccounts();
    const activeKeyWith = await loadActiveKeyWith({ ASC_ACCOUNT: 'personal' });
    expect(activeKeyWith?.keyId).toBe('AAAA1111');
    expect((await loadActiveKeyWith({ ASC_ACCOUNT: 'AAAA1111' }))?.keyId).toBe('AAAA1111');
  }

  it(
    'loads the account ASC_ACCOUNT names by label or Key ID instead of the active one',
    loadsTheAccountASCACCOUNTNamesByLabelOrKeyIDInsteadOfTheActiveOne,
  );

  async function failsWhenASCACCOUNTMatchesNoAccount() {
    await addTwoAccounts();

    const activeKeyWith = loadActiveKeyWith({ ASC_ACCOUNT: 'nobody' });

    await expect(activeKeyWith).rejects.toMatchObject({
      message: expect.stringMatching(/No Apple account matching.*nobody/),
    });
  }

  it('fails when ASC_ACCOUNT matches no account', failsWhenASCACCOUNTMatchesNoAccount);
}

describe('loadActiveAscKey', describeLoadActiveAscKey);
function describeLoadAscKeyForAccount() {
  function loadKeyForAccountWith(
    accountSelector: string | undefined,
    environmentVariables: Readonly<Record<string, string | undefined>>,
  ) {
    useLaunchEnvironment(environmentVariables);

    return loadAscKeyForAccount(accountSelector);
  }
  async function loadsTheAccountTheFlagNamesEvenWhenAnotherAccountIsActive() {
    await addTwoAccounts();

    const ascKey = await loadKeyForAccountWith('personal', {});

    expect(ascKey?.keyId).toBe('AAAA1111');
  }

  it(
    'loads the account the flag names, even when another account is active',
    loadsTheAccountTheFlagNamesEvenWhenAnotherAccountIsActive,
  );

  async function fallsBackToTheActiveAccountWhenNoFlagIsGiven() {
    await addTwoAccounts();

    const ascKey = await loadKeyForAccountWith(undefined, {});

    expect(ascKey?.keyId).toBe('BBBB2222');
  }

  it(
    'falls back to the active account when no flag is given',
    fallsBackToTheActiveAccountWhenNoFlagIsGiven,
  );

  async function letsTheFlagWinOverASCACCOUNT() {
    await addTwoAccounts();

    const ascKey = await loadKeyForAccountWith('AAAA1111', { ASC_ACCOUNT: 'BBBB2222' });

    expect(ascKey?.keyId).toBe('AAAA1111');
  }

  it('lets the flag win over ASC_ACCOUNT', letsTheFlagWinOverASCACCOUNT);

  async function failsWhenTheFlagMatchesNoAccount() {
    await addTwoAccounts();

    const keyForAccountWith = loadKeyForAccountWith('nobody', {});

    await expect(keyForAccountWith).rejects.toMatchObject({
      message: expect.stringMatching(/No Apple account matching.*nobody/),
    });
  }

  it('fails when the flag matches no account', failsWhenTheFlagMatchesNoAccount);
}

describe('loadAscKeyForAccount', describeLoadAscKeyForAccount);
function describeMigrateLegacyAccounts() {
  async function movesALegacySingleKeyIntoTheRegistryAsTheActiveDefaultAccount() {
    secrets.store.set('asc-key-id', 'KEYXYZ7890');
    secrets.store.set('asc-issuer-id', 'issuer-legacy');
    secrets.store.set('asc-p8', PEM);
    secrets.store.set('dist-cert-p12-password', 'secret-pw');
    await runAccountEffect(migrateLegacyAccounts());

    const activeKeyId = getActiveKeyId();
    const accountEffect = await runAccountEffect(activeKeyId);

    expect(accountEffect).toBe('KEYXYZ7890');

    const accounts = listAccounts();

    expect((await runAccountEffect(accounts))[0]).toMatchObject({
      keyId: 'KEYXYZ7890',
      label: 'default',
      issuerId: 'issuer-legacy',
    });
    expect(secrets.store.get('asc-p8:KEYXYZ7890')).toBeDefined();
    expect(secrets.store.get('dist-cert-p12-password:KEYXYZ7890')).toBe('secret-pw');
    expect(secrets.store.has('asc-key-id')).toBe(false);
    expect(secrets.store.has('dist-cert-p12-password')).toBe(false);
    expect(vi.mocked(migrateLegacySigningIndex)).toHaveBeenCalledWith('KEYXYZ7890');

    const ascKeyById = loadAscKeyById('KEYXYZ7890');

    expect(await runAccountEffect(ascKeyById)).toEqual({
      keyId: 'KEYXYZ7890',
      issuerId: 'issuer-legacy',
      p8: PEM,
    });
  }

  it(
    "moves a legacy single key into the registry as the active 'default' account",
    movesALegacySingleKeyIntoTheRegistryAsTheActiveDefaultAccount,
  );

  async function isANoOpWhenNothingWasImportedTheOldWay() {
    await runAccountEffect(migrateLegacyAccounts());
    const accounts = listAccounts();
    const accountEffect = await runAccountEffect(accounts);
    expect(accountEffect).toHaveLength(0);
  }

  it('is a no-op when nothing was imported the old way', isANoOpWhenNothingWasImportedTheOldWay);
}

describe('migrateLegacyAccounts', describeMigrateLegacyAccounts);
function describeSetAccountVendorNumber() {
  function addApple(keyId: string) {
    return addAccount({ keyId, issuerId: `issuer-${keyId}`, label: `label-${keyId}`, p8: PEM });
  }
  async function savesTheVendorNumberOnTheAccount() {
    const apple = addApple('AAAA1111');

    await runAccountEffect(apple);

    await runAccountEffect(setAccountVendorNumber('AAAA1111', '88001122'));

    const accounts = await runAccountEffect(listAccounts());

    expect(accounts[0]?.vendorNumber).toBe('88001122');
  }

  it('saves the vendor number on the account', savesTheVendorNumberOnTheAccount);

  async function keepsTheVendorNumberWhenTheSameKeyIsAddedAgain() {
    const apple = addApple('AAAA1111');

    await runAccountEffect(apple);
    await runAccountEffect(setAccountVendorNumber('AAAA1111', '88001122'));

    await runAccountEffect(addApple('AAAA1111'));

    const accounts = await runAccountEffect(listAccounts());

    expect(accounts[0]?.vendorNumber).toBe('88001122');
  }

  it(
    'keeps the vendor number when the same key is added again',
    keepsTheVendorNumberWhenTheSameKeyIsAddedAgain,
  );

  async function leavesTheVendorNumberMissingOnAnAccountThatNeverHadOne() {
    const apple = addApple('AAAA1111');

    await runAccountEffect(apple);

    const accounts = await runAccountEffect(listAccounts());

    expect(accounts[0]?.vendorNumber).toBeUndefined();
  }

  it(
    'leaves the vendor number missing on an account that never had one',
    leavesTheVendorNumberMissingOnAnAccountThatNeverHadOne,
  );

  async function failsForAnUnknownKeyId() {
    const accountEffect = runAccountEffect(setAccountVendorNumber('NOPE', '1'));
    await expect(accountEffect).rejects.toMatchObject({
      _tag: 'AccountFailure',
    });
  }

  it('fails for an unknown key id', failsForAnUnknownKeyId);
}

describe('setAccountVendorNumber', describeSetAccountVendorNumber);
