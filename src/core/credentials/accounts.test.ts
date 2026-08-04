import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { Effect } from 'effect';
import { NodeContext } from '@effect/platform-node';
import type { AccountRecord, AccountsFile } from '../types/credentials.js';
import {
  makeLaunchSecretStoreTest,
  type LaunchSecretStoreService,
} from '../services/secretStore.js';
const secrets = vi.hoisted(() => ({ store: new Map<string, string>() }));
// Redirect HOME before any import evaluates `core/paths.js`, so the real module's `~/.launch` (and
// `accounts.json`) resolve under a throwaway dir. node:os `homedir()` honors $HOME / %USERPROFILE%.
const home = vi.hoisted(() => {
  let temporaryDirectory = process.env['TMPDIR'];
  if (temporaryDirectory === undefined) temporaryDirectory = '/tmp';
  const dir = `${temporaryDirectory}/launch-accounts-test-${process.pid}`;
  process.env['HOME'] = dir;
  process.env['USERPROFILE'] = dir;
  return { dir };
});
vi.mock('./keychain.js', () => ({
  setSecret: (account: string, secretValue: string) =>
    Effect.sync(() => void secrets.store.set(account, secretValue)),
  getSecret: (account: string) => {
    const storedSecret = secrets.store.get(account);
    if (storedSecret === undefined) return Effect.succeed(null);
    return Effect.succeed(storedSecret);
  },
  deleteSecret: (account: string) => Effect.sync(() => void secrets.store.delete(account)),
}));
vi.mock('./appleSigning.js', () => ({
  migrateLegacySigningIndex: vi.fn(() => Effect.void),
  p12PasswordAccount: (keyId: string) => `dist-cert-p12-password:${keyId}`,
}));
import {
  ACCOUNTS_FILE,
  CREDENTIALS_DIR,
  makeLaunchPathsTest,
  type LaunchPathsService,
} from '../services/paths.js';
/** Run an account program with an isolated secret-store capability. */
const runAccountEffect = <TValue, TError>(
  accountEffect: Effect.Effect<
    TValue,
    TError,
    LaunchPathsService | LaunchSecretStoreService | NodeContext.NodeContext
  >,
): Promise<TValue> => {
  return Effect.runPromise(
    accountEffect.pipe(
      Effect.provide(NodeContext.layer),
      Effect.provide(makeLaunchPathsTest(home.dir, home.dir)),
      Effect.provide(makeLaunchSecretStoreTest()),
    ),
  );
};
import {
  addAccount,
  decideBuildAccount,
  decodeP8,
  encodeP8,
  formatAccountSummary,
  getActiveKeyId,
  listAccounts,
  loadAscKeyById,
  matchAccount,
  migrateLegacyAccounts,
  removeAccount,
  renameAccount,
  setActiveKeyId,
  updateAccountIdentity,
} from './accounts.js';
import { migrateLegacySigningIndex } from './appleSigning.js';
/** A realistic multi-line PKCS#8 PEM so the base64 round-trip exercises the real decode path. */
const PEM = [
  '-----BEGIN PRIVATE KEY-----',
  'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49',
  '-----END PRIVATE KEY-----',
].join('\n');
const file = (active: string | null, ...labels: [string, string][]): AccountsFile => {
  return {
    active,
    accounts: labels.map(([keyId, label]) => ({
      keyId,
      label,
      issuerId: `issuer-${keyId}`,
      addedAt: 't',
    })),
  };
};
beforeEach(() => {
  secrets.store.clear();
  rmSync(ACCOUNTS_FILE, { force: true });
  rmSync(CREDENTIALS_DIR, { recursive: true, force: true });
});
afterAll(() => {
  rmSync(home.dir, { recursive: true, force: true });
});
describe('encodeP8 / decodeP8', () => {
  it('round-trips a multi-line PEM through base64 unchanged', () => {
    expect(decodeP8(encodeP8(PEM))).toBe(PEM);
    expect(encodeP8(PEM)).not.toContain('\n');
  });
  it('repairs a legacy hex-encoded PEM (macOS `security -w` corruption)', () => {
    expect(decodeP8(Buffer.from(PEM, 'utf8').toString('hex'))).toBe(PEM);
  });
});
describe('matchAccount', () => {
  const accounts = file(null, ['AAAA1111', 'Personal'], ['BBBB2222', 'Acme']).accounts;
  it('matches by label, case-insensitively', () => {
    expect(matchAccount(accounts, 'acme')?.keyId).toBe('BBBB2222');
  });
  it('matches by Key ID, case-insensitively', () => {
    expect(matchAccount(accounts, 'aaaa1111')?.keyId).toBe('AAAA1111');
  });
  it('returns undefined for an unknown selector', () => {
    expect(matchAccount(accounts, 'nope')).toBeUndefined();
  });
});
describe('formatAccountSummary', () => {
  const base: AccountRecord = {
    keyId: 'KEYABC1234',
    issuerId: 'issuer-x',
    label: 'default',
    addedAt: 't',
  };
  it('degrades to label - team - key when no apps are cached', () => {
    expect(formatAccountSummary({ ...base, teamId: 'ABCDE12345' })).toBe(
      'default - team ABCDE12345 - key KEYABC1234',
    );
  });
  it('omits the team segment when the account is unresolved', () => {
    expect(formatAccountSummary(base)).toBe('default - key KEYABC1234');
  });
  it('lists up to three app names inline with no +N suffix', () => {
    expect(
      formatAccountSummary({
        ...base,
        teamId: 'ABCDE12345',
        apps: ['Larkspur', 'Beacon', 'Cypress'],
      }),
    ).toBe('default - Larkspur, Beacon, Cypress - team ABCDE12345 - key KEYABC1234');
  });
  it('collapses the apps beyond the third into a +N count', () => {
    const apps = [
      'Larkspur',
      'Beacon',
      'Cypress',
      'Mapleleaf',
      'SampleApp',
      'Dockyard',
      'Everglade',
    ];
    expect(formatAccountSummary({ ...base, teamId: 'ABCDE12345', apps })).toBe(
      'default - Larkspur, Beacon, Cypress +4 - team ABCDE12345 - key KEYABC1234',
    );
  });
  it('drops the leading label for the picker hint via includeLabel:false', () => {
    expect(
      formatAccountSummary(
        { ...base, teamId: 'ABCDE12345', apps: ['Larkspur'] },
        { includeLabel: false },
      ),
    ).toBe('Larkspur - team ABCDE12345 - key KEYABC1234');
  });
});
describe('decideBuildAccount', () => {
  it('errors with a fix when no accounts exist', () => {
    expect(decideBuildAccount(file(null))).toEqual({
      kind: 'error',
      message: expect.stringContaining('set-key'),
    });
  });
  it('uses an explicit selector match', () => {
    const decision = decideBuildAccount(
      file('AAAA1111', ['AAAA1111', 'Personal'], ['BBBB2222', 'Acme']),
      'Acme',
    );
    expect(decision).toMatchObject({ kind: 'use', record: { keyId: 'BBBB2222' } });
  });
  it('errors when the selector matches nothing', () => {
    expect(decideBuildAccount(file('AAAA1111', ['AAAA1111', 'Personal']), 'ghost')).toMatchObject({
      kind: 'error',
    });
  });
  it('uses the active account when no selector is given', () => {
    const decision = decideBuildAccount(
      file('BBBB2222', ['AAAA1111', 'Personal'], ['BBBB2222', 'Acme']),
    );
    expect(decision).toMatchObject({ kind: 'use', record: { keyId: 'BBBB2222' } });
  });
  it('uses the sole account when none is active', () => {
    expect(decideBuildAccount(file(null, ['AAAA1111', 'Personal']))).toMatchObject({
      kind: 'use',
      record: { keyId: 'AAAA1111' },
    });
  });
  it('signals a pick when several accounts exist and none is active', () => {
    expect(decideBuildAccount(file(null, ['AAAA1111', 'Personal'], ['BBBB2222', 'Acme']))).toEqual({
      kind: 'pick',
    });
  });
});
describe('registry mutations', () => {
  it('adds an account, stores its key namespaced, and makes it active', async () => {
    await runAccountEffect(
      addAccount({
        keyId: 'AAAA1111',
        issuerId: 'issuer-a',
        label: 'Personal',
        p8: PEM,
        teamId: 'TEAM1',
      }),
    );
    expect(await runAccountEffect(getActiveKeyId())).toBe('AAAA1111');
    expect(secrets.store.get('asc-p8:AAAA1111')).toBeDefined();
    const loaded = await runAccountEffect(loadAscKeyById('AAAA1111'));
    expect(loaded).toEqual({ keyId: 'AAAA1111', issuerId: 'issuer-a', p8: PEM });
    expect((await runAccountEffect(listAccounts()))[0]).toMatchObject({
      label: 'Personal',
      teamId: 'TEAM1',
      resolvedAt: expect.any(String),
    });
  });
  it('re-adding the same Key ID updates in place instead of duplicating', async () => {
    await runAccountEffect(
      addAccount({ keyId: 'AAAA1111', issuerId: 'issuer-a', label: 'Personal', p8: PEM }),
    );
    await runAccountEffect(
      addAccount({ keyId: 'AAAA1111', issuerId: 'issuer-a', label: 'Renamed', p8: PEM }),
    );
    expect(await runAccountEffect(listAccounts())).toHaveLength(1);
    expect((await runAccountEffect(listAccounts()))[0]?.label).toBe('Renamed');
  });
  it('switches the active account and renames labels', async () => {
    await runAccountEffect(
      addAccount({ keyId: 'AAAA1111', issuerId: 'issuer-a', label: 'Personal', p8: PEM }),
    );
    await runAccountEffect(
      addAccount({ keyId: 'BBBB2222', issuerId: 'issuer-b', label: 'Acme', p8: PEM }),
    );
    await runAccountEffect(setActiveKeyId('AAAA1111'));
    expect(await runAccountEffect(getActiveKeyId())).toBe('AAAA1111');
    await runAccountEffect(renameAccount('AAAA1111', 'Home'));
    expect(matchAccount([...(await runAccountEffect(listAccounts()))], 'Home')?.keyId).toBe(
      'AAAA1111',
    );
  });
  it('caches resolved identity in place', async () => {
    await runAccountEffect(
      addAccount({ keyId: 'AAAA1111', issuerId: 'issuer-a', label: 'Personal', p8: PEM }),
    );
    await runAccountEffect(updateAccountIdentity('AAAA1111', 'TEAM9', ['Mapleleaf', 'SampleApp']));
    expect((await runAccountEffect(listAccounts()))[0]).toMatchObject({
      teamId: 'TEAM9',
      apps: ['Mapleleaf', 'SampleApp'],
    });
  });
  it('removes an account, clears its secret, and re-points active to a survivor', async () => {
    await runAccountEffect(
      addAccount({ keyId: 'AAAA1111', issuerId: 'issuer-a', label: 'Personal', p8: PEM }),
    );
    await runAccountEffect(
      addAccount({ keyId: 'BBBB2222', issuerId: 'issuer-b', label: 'Acme', p8: PEM }),
    ); // becomes active
    await runAccountEffect(removeAccount('BBBB2222'));
    expect(secrets.store.has('asc-p8:BBBB2222')).toBe(false);
    expect(await runAccountEffect(listAccounts())).toHaveLength(1);
    expect(await runAccountEffect(getActiveKeyId())).toBe('AAAA1111');
  });
});
describe('migrateLegacyAccounts', () => {
  it("moves a legacy single key into the registry as the active 'default' account", async () => {
    secrets.store.set('asc-key-id', 'KEYXYZ7890');
    secrets.store.set('asc-issuer-id', 'issuer-legacy');
    secrets.store.set('asc-p8', PEM);
    secrets.store.set('dist-cert-p12-password', 'secret-pw');
    await runAccountEffect(migrateLegacyAccounts());
    expect(await runAccountEffect(getActiveKeyId())).toBe('KEYXYZ7890');
    expect((await runAccountEffect(listAccounts()))[0]).toMatchObject({
      keyId: 'KEYXYZ7890',
      label: 'default',
      issuerId: 'issuer-legacy',
    });
    expect(secrets.store.get('asc-p8:KEYXYZ7890')).toBeDefined();
    expect(secrets.store.get('dist-cert-p12-password:KEYXYZ7890')).toBe('secret-pw');
    expect(secrets.store.has('asc-key-id')).toBe(false);
    expect(secrets.store.has('dist-cert-p12-password')).toBe(false);
    expect(vi.mocked(migrateLegacySigningIndex)).toHaveBeenCalledWith('KEYXYZ7890');
    expect(await runAccountEffect(loadAscKeyById('KEYXYZ7890'))).toEqual({
      keyId: 'KEYXYZ7890',
      issuerId: 'issuer-legacy',
      p8: PEM,
    });
  });
  it('is a no-op when nothing was imported the old way', async () => {
    await runAccountEffect(migrateLegacyAccounts());
    expect(await runAccountEffect(listAccounts())).toHaveLength(0);
  });
});
