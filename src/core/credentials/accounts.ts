import { FileSystem, type Path } from '@effect/platform';
import { Clock, Data, Effect, Schema } from 'effect';
import type { AccountRecord, AccountsFile, AscKey } from '../types/credentials.js';
import {
  resolveAccountCredentialsDirectory,
  resolveAccountsFilePath,
  resolveLaunchHomeDirectory,
  type LaunchPathsService,
} from '../services/paths.js';
import { deleteSecret, getSecret, setSecret } from './keychain.js';
import { migrateLegacySigningIndex, p12PasswordAccount } from './appleSigning.js';
import { AppStoreIdentityService } from '../services/appStoreIdentity.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import type { MutableDeep } from '../types/mutable.js';
/** Secret-store account holding one Apple account's `.p8` PEM, namespaced by Key ID. */
const p8Account = (keyId: string): string => {
  return `asc-p8:${keyId}`;
};
/** The pre-multi-account secret-store accounts a first-run migration reads and then clears. */
const LEGACY_KEY_ID = 'asc-key-id';
const LEGACY_ISSUER_ID = 'asc-issuer-id';
const LEGACY_P8 = 'asc-p8';
const LEGACY_P12_PASSWORD = 'dist-cert-p12-password';
export type AccountFailure = Readonly<{
  readonly _tag: 'AccountFailure';
  readonly message: string;
}>;
export const makeAccountFailure = Data.tagged<AccountFailure>('AccountFailure');
const AccountRecordSchema: Schema.Schema<AccountRecord> = Schema.Struct({
  keyId: Schema.String,
  issuerId: Schema.String,
  label: Schema.String,
  teamId: Schema.optionalWith(Schema.String, { exact: true }),
  apps: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  addedAt: Schema.String,
  resolvedAt: Schema.optionalWith(Schema.String, { exact: true }),
});
const AccountsFileSchema: Schema.Schema<AccountsFile> = Schema.Struct({
  active: Schema.NullOr(Schema.String),
  accounts: Schema.Array(AccountRecordSchema),
});
type AccountStorageRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;
const emptyAccountsFile = (): AccountsFile => ({ active: null, accounts: [] });
/** ISO-8601 stamp for `addedAt`/`resolvedAt`. */
const currentTimestamp = (): Effect.Effect<string> =>
  Clock.currentTimeMillis.pipe(
    Effect.map((epochMilliseconds) => new Date(epochMilliseconds).toISOString()),
  );
/**
 * Encode a `.p8` PEM as single-line base64 for storage.
 *
 * Why: the macOS `security -w` backend HEX-encodes any value containing newlines on read-back, which
 * silently corrupted multi-line PEMs. Base64 has no newlines, so the value round-trips verbatim on
 * every backend (macOS `security`, Windows Credential Manager, Linux libsecret).
 */
export const encodeP8 = (pem: string): string => {
  return Buffer.from(pem, 'utf8').toString('base64');
};
/**
 * Decode a stored `.p8` back to its PEM, repairing every legacy on-disk form so upgrading never forces
 * a re-import: current single-line base64; a legacy multi-line PEM the macOS backend hex-encoded; and
 * the oldest raw PEM that happened to survive. A value matching none of these is returned verbatim.
 */
export const decodeP8 = (stored: string): string => {
  const fromBase64 = Buffer.from(stored, 'base64').toString('utf8');
  if (fromBase64.includes('PRIVATE KEY')) return fromBase64;
  if (/^(?:[0-9a-fA-F]{2})+$/.test(stored)) {
    const fromHex = Buffer.from(stored, 'hex').toString('utf8');
    if (fromHex.includes('PRIVATE KEY')) return fromHex;
  }
  return stored;
};
/** Read the registry, returning an empty one when the file is absent or malformed. */
const readAccounts = (): Effect.Effect<AccountsFile, never, AccountStorageRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const accountsFilePath = yield* resolveAccountsFilePath();
    const registryExists = yield* fileSystem
      .exists(accountsFilePath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!registryExists) return emptyAccountsFile();
    return yield* fileSystem.readFileString(accountsFilePath).pipe(
      Effect.flatMap((registryText) => Effect.try(() => JSON.parse(registryText))),
      Effect.flatMap(Schema.decodeUnknown(AccountsFileSchema)),
      Effect.map((accountsFile): AccountsFile => accountsFile),
      Effect.orElseSucceed(emptyAccountsFile),
    );
  });
/** Write the registry back to disk (pretty-printed; non-secret metadata only). */
const writeAccounts = (
  accountsFile: AccountsFile,
): Effect.Effect<void, AccountFailure, AccountStorageRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const launchHomeDirectory = yield* resolveLaunchHomeDirectory();
    const accountsFilePath = yield* resolveAccountsFilePath();
    yield* fileSystem.makeDirectory(launchHomeDirectory, { recursive: true });
    yield* fileSystem.writeFileString(accountsFilePath, JSON.stringify(accountsFile, null, 2));
  }).pipe(
    Effect.mapError(() =>
      makeAccountFailure({
        message: 'Could not write the account registry.',
      }),
    ),
  );
/** Every onboarded account, in insertion order. */
export const listAccounts = (): Effect.Effect<
  readonly AccountRecord[],
  never,
  AccountStorageRequirements
> => readAccounts().pipe(Effect.map((accountsFile) => accountsFile.accounts));
/** Key ID of the active account, or null when none is selected. */
export const getActiveKeyId = (): Effect.Effect<string | null, never, AccountStorageRequirements> =>
  readAccounts().pipe(Effect.map((accountsFile) => accountsFile.active));
/** The active account record, or null when none is selected. */
export const getActiveAccount = (): Effect.Effect<
  AccountRecord | null,
  never,
  AccountStorageRequirements
> =>
  Effect.gen(function* () {
    const accountsFile = yield* readAccounts();
    if (accountsFile.active === null) return null;
    const activeAccount = accountsFile.accounts.find(
      (account) => account.keyId === accountsFile.active,
    );
    if (activeAccount === undefined) return null;
    return activeAccount;
  });
/** Find an account by exact Key ID. */
export const findAccount = (
  keyId: string,
): Effect.Effect<AccountRecord | undefined, never, AccountStorageRequirements> =>
  readAccounts().pipe(
    Effect.map((accountsFile) => accountsFile.accounts.find((account) => account.keyId === keyId)),
  );
/** Match an account by its label or Key ID, case-insensitively - the selector form users type. */
export const matchAccount = (
  accounts: readonly AccountRecord[],
  selector: string,
): AccountRecord | undefined => {
  const needle = selector.trim().toLowerCase();
  return accounts.find((account) => {
    if (account.keyId.toLowerCase() === needle) return true;
    return account.label.toLowerCase() === needle;
  });
};
/** Max app names shown inline in {@link formatAccountSummary} before the remainder collapses to `+N`. */
const ACCOUNT_SUMMARY_APP_LIMIT = 3;
/** Options for {@link formatAccountSummary}. */
export type AccountSummaryOptions = {
  includeLabel?: boolean;
};
/**
 * One human-recognizable line for an account, shared by the build step line, the `launch creds`
 * listing, and the account picker hint so all three read identically.
 *
 * It leads with the cached app names the key can see - the thing a person actually recognizes - then
 * the Team ID and Key ID for traceability: `default - Larkspur, Beacon, Cypress +4 - team ... - key ...`.
 * Up to {@link ACCOUNT_SUMMARY_APP_LIMIT} apps show inline and the rest collapse to `+N`; an empty or
 * not-yet-resolved app list is omitted, so the line degrades cleanly to `label - team - key`. Renders
 * only what's cached on the record - never an Apple call.
 */
export const formatAccountSummary = (
  account: AccountRecord,
  options: AccountSummaryOptions = {},
): string => {
  const segments: string[] = [];
  if (options.includeLabel !== false) segments.push(account.label);
  let apps = account.apps;
  if (apps === undefined) apps = [];
  if (apps.length > 0) {
    const extra = apps.length - ACCOUNT_SUMMARY_APP_LIMIT;
    const shown = apps.slice(0, ACCOUNT_SUMMARY_APP_LIMIT).join(', ');
    let appSummary = shown;
    if (extra > 0) appSummary = `${shown} +${extra}`;
    segments.push(appSummary);
  }
  if (account.teamId) segments.push(`team ${account.teamId}`);
  segments.push(`key ${account.keyId}`);
  return segments.join(' - ');
};
/** Inputs to {@link addAccount}: the key material plus any team/apps already resolved from Apple. */
export type AddAccountInput = {
  keyId: string;
  issuerId: string;
  label: string;
  p8: string;
  teamId?: string | null;
  apps?: string[];
};
/**
 * Add (or replace) an account and make it active. The `.p8` goes to the OS secret store; the metadata
 * to the registry. Re-adding an existing Key ID updates it in place (keeping its original `addedAt`),
 * so importing the same key with a new label or a fresh `.p8` never creates a duplicate.
 */
export const addAccount = (
  input: AddAccountInput,
): Effect.Effect<AccountRecord, unknown, AccountStorageRequirements | LaunchSecretStoreService> =>
  Effect.gen(function* () {
    yield* setSecret(p8Account(input.keyId), encodeP8(input.p8));
    const file = yield* readAccounts();
    const existing = file.accounts.find((account) => account.keyId === input.keyId);
    const timestamp = yield* currentTimestamp();
    let hasIdentity = input.teamId !== null && input.teamId !== undefined;
    if (!hasIdentity && input.apps !== undefined) hasIdentity = input.apps.length > 0;
    let addedAt = existing?.addedAt;
    if (addedAt === undefined) addedAt = timestamp;
    const record: MutableDeep<AccountRecord> = {
      keyId: input.keyId,
      issuerId: input.issuerId,
      label: input.label,
      addedAt,
    };
    if (input.teamId !== null && input.teamId !== undefined) record.teamId = input.teamId;
    if (input.apps !== undefined && input.apps.length > 0) record.apps = [...input.apps];
    if (hasIdentity) record.resolvedAt = timestamp;
    let accounts = [...file.accounts, record];
    if (existing) {
      accounts = file.accounts.map((account) => {
        if (account.keyId === input.keyId) return record;
        return account;
      });
    }
    yield* writeAccounts({ active: input.keyId, accounts });
    return record;
  });
/** Refresh an account's cached Team ID / app names in place, preserving prior values a null doesn't replace. */
export const updateAccountIdentity = (
  keyId: string,
  teamId: string | null,
  apps: readonly string[],
): Effect.Effect<void, AccountFailure, AccountStorageRequirements> =>
  Effect.gen(function* () {
    const file = yield* readAccounts();
    const timestamp = yield* currentTimestamp();
    const accounts = file.accounts.map((account) => {
      if (account.keyId !== keyId) return account;
      let next: AccountRecord = { ...account, resolvedAt: timestamp };
      if (teamId != null) next = { ...next, teamId };
      if (apps.length > 0) next = { ...next, apps: [...apps] };
      return next;
    });
    yield* writeAccounts({ active: file.active, accounts });
  });
/** Make `keyId` the active account; throws if it isn't registered. */
export const setActiveKeyId = (
  keyId: string,
): Effect.Effect<void, AccountFailure, AccountStorageRequirements> =>
  Effect.gen(function* () {
    const file = yield* readAccounts();
    if (!file.accounts.some((account) => account.keyId === keyId)) {
      return yield* Effect.fail(makeAccountFailure({ message: `No account with key ${keyId}.` }));
    }
    yield* writeAccounts({ active: keyId, accounts: file.accounts });
  });
/** Rename an account's label; throws if it isn't registered. Caller enforces label uniqueness. */
export const renameAccount = (
  keyId: string,
  newLabel: string,
): Effect.Effect<void, AccountFailure, AccountStorageRequirements> =>
  Effect.gen(function* () {
    const file = yield* readAccounts();
    if (!file.accounts.some((account) => account.keyId === keyId)) {
      return yield* Effect.fail(makeAccountFailure({ message: `No account with key ${keyId}.` }));
    }
    const accounts = file.accounts.map((account) => {
      if (account.keyId === keyId) return { ...account, label: newLabel };
      return account;
    });
    yield* writeAccounts({ active: file.active, accounts });
  });
/**
 * Remove an account completely: its `.p8` and `.p12` password from the secret store, its per-account
 * signing folder, and its registry entry. If it was active, the active pointer falls to the first
 * remaining account (or null when none are left).
 */
export const removeAccount = (
  keyId: string,
): Effect.Effect<void, unknown, AccountStorageRequirements | LaunchSecretStoreService> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* deleteSecret(p8Account(keyId));
    yield* deleteSecret(p12PasswordAccount(keyId));
    const accountDirectory = yield* resolveAccountCredentialsDirectory(keyId);
    yield* fileSystem
      .remove(accountDirectory, { recursive: true, force: true })
      .pipe(Effect.catchAll(() => Effect.void));
    const file = yield* readAccounts();
    const accounts = file.accounts.filter((account) => account.keyId !== keyId);
    let active = file.active;
    if (active === keyId) {
      active = null;
      if (accounts[0] !== undefined) active = accounts[0].keyId;
    }
    yield* writeAccounts({ active, accounts });
  });
/** Load one account's full {@link AscKey} (key from the secret store, ids from the registry), or null. */
export const loadAscKeyById = (
  keyId: string,
): Effect.Effect<AscKey | null, unknown, AccountStorageRequirements | LaunchSecretStoreService> =>
  Effect.gen(function* () {
    const record = yield* findAccount(keyId);
    if (!record) return null;
    const stored = yield* getSecret(p8Account(keyId));
    if (!stored) return null;
    return { keyId, issuerId: record.issuerId, p8: decodeP8(stored) };
  });
/** Load the active account's key, or null when none is selected. */
export const loadActiveAscKey = (): Effect.Effect<
  AscKey | null,
  unknown,
  AccountStorageRequirements | LaunchSecretStoreService
> =>
  Effect.gen(function* () {
    const active = yield* getActiveKeyId();
    if (active) return yield* loadAscKeyById(active);
    return null;
  });
/**
 * The decision tree for which account a build uses, factored out as a pure function so it's unit-
 * testable without the filesystem: an explicit selector wins (error if it matches nothing), else the
 * active account, else the sole account when there's exactly one, else a signal to prompt.
 */
export type BuildAccountDecision =
  | {
      kind: 'use';
      record: AccountRecord;
    }
  | {
      kind: 'pick';
    }
  | {
      kind: 'error';
      message: string;
    };
/** Decide which account a build should use from the registry state + an optional selector. Pure. */
export const decideBuildAccount = (file: AccountsFile, selector?: string): BuildAccountDecision => {
  if (file.accounts.length === 0) {
    return {
      kind: 'error',
      message: 'No Apple account configured. Import one with: launch creds set-key',
    };
  }
  if (selector) {
    const matched = matchAccount(file.accounts, selector);
    if (matched) return { kind: 'use', record: matched };
    return {
      kind: 'error',
      message: `No Apple account matching "${selector}". Run \`launch creds\` to list them.`,
    };
  }
  let active: AccountRecord | undefined;
  if (file.active) active = file.accounts.find((account) => account.keyId === file.active);
  if (active) return { kind: 'use', record: active };
  const sole = file.accounts[0];
  if (file.accounts.length === 1 && sole) return { kind: 'use', record: sole };
  return { kind: 'pick' };
};
/** Options for {@link resolveBuildAccount}. */
export type ResolveBuildAccountOptions = {
  selector?: string | undefined;
  interactive: boolean;
  pick: (accounts: readonly AccountRecord[]) => Effect.Effect<AccountRecord, unknown>;
};
/**
 * Resolve the account a build should use, applying {@link decideBuildAccount} and then either using
 * the result, prompting via `pick` (interactive only), or throwing an actionable error in CI.
 */
export const resolveBuildAccount = (
  options: ResolveBuildAccountOptions,
): Effect.Effect<AccountRecord, AccountFailure | unknown, AccountStorageRequirements> =>
  Effect.gen(function* () {
    const file = yield* readAccounts();
    const decision = decideBuildAccount(file, options.selector);
    if (decision.kind === 'use') return decision.record;
    if (decision.kind === 'error')
      return yield* Effect.fail(makeAccountFailure({ message: decision.message }));
    if (!options.interactive) {
      return yield* Effect.fail(
        makeAccountFailure({
          message:
            'No active Apple account. Pick one with: launch creds use  (or pass --account / set ASC_ACCOUNT).',
        }),
      );
    }
    return yield* options.pick(file.accounts);
  });
/** Validated Apple-side identity for an account: the Team ID and visible app names (best-effort each). */
export type AccountIdentity = {
  teamId: string | null;
  apps: string[];
};
/** Resolve an account's Team ID + accessible app names from Apple (each degrades to null/[] on failure). */
export const resolveAccountIdentity = (
  ascKey: AscKey,
): Effect.Effect<AccountIdentity, never, AppStoreIdentityService> =>
  Effect.gen(function* () {
    const appStoreIdentity = yield* AppStoreIdentityService;
    return yield* appStoreIdentity.resolveIdentity(ascKey);
  });
/**
 * Backfill an account's cached team/apps the first time a live key is in hand (e.g. during a build),
 * skipping accounts already resolved. Best-effort: any Apple-side failure is swallowed so it never
 * disrupts the surrounding flow.
 */
export const refreshIdentityIfStale = (
  account: AccountRecord,
  ascKey: AscKey,
): Effect.Effect<void, never, AccountStorageRequirements | AppStoreIdentityService> =>
  Effect.gen(function* () {
    if (account.resolvedAt) return;
    const identity = yield* resolveAccountIdentity(ascKey);
    yield* updateAccountIdentity(account.keyId, identity.teamId, identity.apps);
  }).pipe(Effect.catchAll(() => Effect.void));
/**
 * One-time, silent upgrade from the pre-multi-account layout. When `accounts.json` is absent but the
 * legacy single-key secret-store entries exist, move them into the registry as a `default` account:
 * namespace the `.p8` and `.p12` password by Key ID, relocate the signing index per-account, then mark
 * it active. Idempotent and best-effort - a partial run simply re-completes on the next invocation.
 */
export const migrateLegacyAccounts = (): Effect.Effect<
  void,
  unknown,
  AccountStorageRequirements | LaunchSecretStoreService
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const accountsFilePath = yield* resolveAccountsFilePath();
    if (yield* fileSystem.exists(accountsFilePath)) return;
    const keyId = yield* getSecret(LEGACY_KEY_ID);
    const issuerId = yield* getSecret(LEGACY_ISSUER_ID);
    const p8 = yield* getSecret(LEGACY_P8);
    if (keyId === null) return; // fresh install - nothing imported the old way
    if (issuerId === null) return; // fresh install - nothing imported the old way
    if (p8 === null) return; // fresh install - nothing imported the old way
    yield* setSecret(p8Account(keyId), encodeP8(decodeP8(p8)));
    const legacyPassword = yield* getSecret(LEGACY_P12_PASSWORD);
    if (legacyPassword) {
      yield* setSecret(p12PasswordAccount(keyId), legacyPassword);
      yield* deleteSecret(LEGACY_P12_PASSWORD);
    }
    yield* migrateLegacySigningIndex(keyId).pipe(Effect.catchAll(() => Effect.void));
    const timestamp = yield* currentTimestamp();
    yield* writeAccounts({
      active: keyId,
      accounts: [{ keyId, issuerId, label: 'default', addedAt: timestamp }],
    });
    yield* deleteSecret(LEGACY_KEY_ID);
    yield* deleteSecret(LEGACY_ISSUER_ID);
    yield* deleteSecret(LEGACY_P8);
  });
