/**
 * Tests for the `local` credentials provider's iOS resolution and status, now that it reads the Apple
 * account registry. The registry and the signing cache are mocked so these run anywhere with no real
 * secret-store or filesystem access — what we assert is the branching: which account's key is loaded,
 * and how `status` renders the onboarded accounts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AccountRecord, AscKey, ResolvedBuildContext } from '../../core/types.js';

const accounts = vi.hoisted(() => ({
  records: [] as AccountRecord[],
  active: null as string | null,
  keys: new Map<string, AscKey>(),
}));

vi.mock('../../core/accounts.js', async () => {
  // Keep the real, pure formatAccountSummary so the status lines exercise the actual renderer; the
  // stateful registry reads stay stubbed against the in-memory fixtures above.
  const actual =
    await vi.importActual<typeof import('../../core/accounts.js')>('../../core/accounts.js');
  return {
    formatAccountSummary: actual.formatAccountSummary,
    listAccounts: () => accounts.records,
    getActiveKeyId: () => accounts.active,
    loadActiveAscKey: async () =>
      accounts.active ? (accounts.keys.get(accounts.active) ?? null) : null,
    loadAscKeyById: async (keyId: string) => accounts.keys.get(keyId) ?? null,
  };
});

vi.mock('../../apple/credentials.js', () => ({
  loadCachedSigningAssets: () => null,
  describeStoredCredentials: () => ({ certSerial: null, bundleIds: [] }),
}));

vi.mock('../../google/credentials.js', () => ({
  describeStoredAndroidCredentials: async () => ({ keystoreAlias: null, hasServiceAccount: false }),
  loadCachedKeystore: async () => null,
  loadServiceAccount: async () => null,
}));

import { localCredentialsProvider } from './local.js';

/** Minimal iOS build context — only the fields `resolveIos` reads. */
function iosContext(account?: string): ResolvedBuildContext {
  return {
    platform: 'ios',
    app: {
      name: 'pomedero',
      dir: '/tmp/pomedero',
      configPath: '/tmp/pomedero/app.json',
      bundleId: 'com.x.pomedero',
    },
    profile: { name: 'production' },
    env: {},
    explain: false,
    dryRun: false,
    forceClean: false,
    ...(account ? { account } : {}),
  };
}

const KEY_A: AscKey = { keyId: 'AAAA1111', issuerId: 'issuer-a', p8: 'pem-a' };
const KEY_B: AscKey = { keyId: 'BBBB2222', issuerId: 'issuer-b', p8: 'pem-b' };

describe('localCredentialsProvider.resolve (iOS account selection)', () => {
  beforeEach(() => {
    accounts.records = [
      { keyId: 'AAAA1111', issuerId: 'issuer-a', label: 'Personal', addedAt: 't' },
      { keyId: 'BBBB2222', issuerId: 'issuer-b', label: 'Acme', addedAt: 't' },
    ];
    accounts.active = 'AAAA1111';
    accounts.keys = new Map([
      ['AAAA1111', KEY_A],
      ['BBBB2222', KEY_B],
    ]);
  });

  it("loads the active account's key when the context names none", async () => {
    const creds = await localCredentialsProvider.resolve(iosContext());
    expect(creds.platform).toBe('ios');
    if (creds.platform === 'ios') expect(creds.ascKey).toEqual(KEY_A);
  });

  it("loads the context's named account, overriding the active one", async () => {
    const creds = await localCredentialsProvider.resolve(iosContext('BBBB2222'));
    if (creds.platform === 'ios') expect(creds.ascKey).toEqual(KEY_B);
  });

  it('throws an actionable error when no account is available', async () => {
    accounts.active = null;
    await expect(localCredentialsProvider.resolve(iosContext())).rejects.toThrow(
      /launch creds set-key/,
    );
  });
});

describe('localCredentialsProvider.status', () => {
  beforeEach(() => {
    accounts.records = [
      { keyId: 'AAAA1111', issuerId: 'issuer-a', label: 'Personal', teamId: 'TEAM1', addedAt: 't' },
    ];
    accounts.active = 'AAAA1111';
  });

  it('lists each account with the active one marked', async () => {
    const status = await localCredentialsProvider.status();
    expect(status).toContain('iOS accounts (1):');
    expect(status).toContain('Personal ← active');
    expect(status).toContain('team TEAM1');
  });

  it("surfaces the account's apps with a +N overflow", async () => {
    accounts.records = [
      {
        keyId: 'AAAA1111',
        issuerId: 'issuer-a',
        label: 'Personal',
        teamId: 'TEAM1',
        apps: ['OlyWell', 'Zaatar', 'Mealsy', 'Pomedero', 'Looopi'],
        addedAt: 't',
      },
    ];
    const status = await localCredentialsProvider.status();
    expect(status).toContain('OlyWell, Zaatar, Mealsy +2');
  });

  it('flags an unresolved account so the fix is one command away', async () => {
    accounts.records = [
      { keyId: 'AAAA1111', issuerId: 'issuer-a', label: 'Personal', addedAt: 't' },
    ];
    const status = await localCredentialsProvider.status();
    expect(status).toContain('unresolved — run `launch creds refresh`');
  });

  it('reports an empty registry plainly', async () => {
    accounts.records = [];
    accounts.active = null;
    const status = await localCredentialsProvider.status();
    expect(status).toContain('no Apple account imported');
  });
});
