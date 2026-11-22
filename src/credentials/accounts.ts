import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { pathExists } from '../path-exists.ts';
import { LaunchSecretStore } from '../services/credentials/secretStore.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import {
  resolveAccountCredentialsDirectory,
  resolveAccountsFilePath,
  resolveLaunchHomeDirectory,
} from '../services/platform/paths.ts';
import { AppStoreIdentityService } from '../services/stores/appStoreIdentity.ts';
import type { AccountRecord, AccountsFile, AscKey } from '../types/credentials.ts';
import { migrateLegacySigningIndex, p12PasswordAccount } from './appleSigning.ts';

/** Secret-store account holding one Apple account's `.p8` PEM, namespaced by Key ID. */
function p8Account(keyId: string): string {
  return `asc-p8:${keyId}`;
}

/** The pre-multi-account secret-store accounts a first-run migration reads and then clears. */
const LEGACY_KEY_ID = 'asc-key-id';
const LEGACY_ISSUER_ID = 'asc-issuer-id';
const LEGACY_P8 = 'asc-p8';
const LEGACY_P12_PASSWORD = 'dist-cert-p12-password';

type AccountFailure = Readonly<{
  _tag: 'AccountFailure';
  message: string;
}>;

function makeAccountFailure(message: string): AccountFailure {
  return { _tag: 'AccountFailure', message };
}

function emptyAccountsFile(): AccountsFile {
  return { active: null, accounts: [] };
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Encode a `.p8` PEM as single-line base64 for storage.
 *
 * Why: the macOS `security -w` backend HEX-encodes any value containing newlines on read-back, which
 * silently corrupted multi-line PEMs. Base64 has no newlines, so the value round-trips verbatim on
 * every backend (macOS `security`, Windows Credential Manager, Linux libsecret).
 */
export function encodeP8(pem: string): string {
  return Buffer.from(pem, 'utf8').toString('base64');
}

/**
 * Decode a stored `.p8` back to its PEM, repairing every legacy on-disk form so upgrading never forces
 * a re-import: current single-line base64; a legacy multi-line PEM the macOS backend hex-encoded; and
 * the oldest raw PEM that happened to survive. A value matching none of these is returned verbatim.
 */
export function decodeP8(stored: string): string {
  const fromBase64 = Buffer.from(stored, 'base64').toString('utf8');
  const isPem = fromBase64.includes('PRIVATE KEY');

  if (isPem) {
    return fromBase64;
  }

  // Even-length hex, the form the macOS keychain used for multi-line PEMs.
  const isHex = /^(?:[0-9a-fA-F]{2})+$/.test(stored);

  if (isHex == false) {
    return stored;
  }

  const fromHex = Buffer.from(stored, 'hex').toString('utf8');
  const isHexPem = fromHex.includes('PRIVATE KEY');

  if (isHexPem) {
    return fromHex;
  }

  return stored;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (typeof candidate != 'object') {
    return false;
  }

  return candidate != null;
}

function readRequiredString(document: Record<string, unknown>, fieldName: string): string | null {
  const field = document[fieldName];

  if (typeof field != 'string') {
    return null;
  }

  return field;
}

function readOptionalString(
  document: Record<string, unknown>,
  fieldName: string,
): { status: 'missing' | 'invalid' | 'present'; text: string } {
  if (fieldName in document == false) {
    return { status: 'missing', text: '' };
  }

  const text = readRequiredString(document, fieldName);

  if (text == null) {
    return { status: 'invalid', text: '' };
  }

  return { status: 'present', text };
}

function readOptionalStringList(
  document: Record<string, unknown>,
  fieldName: string,
): { status: 'missing' | 'invalid' | 'present'; texts: string[] } {
  if (fieldName in document == false) {
    return { status: 'missing', texts: [] };
  }

  const field = document[fieldName];

  if (Array.isArray(field) == false) {
    return { status: 'invalid', texts: [] };
  }

  const texts: string[] = [];

  for (const listed of field) {
    if (typeof listed != 'string') {
      return { status: 'invalid', texts: [] };
    }

    texts.push(listed);
  }

  return { status: 'present', texts };
}

function decodeAccountRecord(candidate: unknown): AccountRecord | null {
  if (isRecord(candidate) == false) {
    return null;
  }

  const keyId = readRequiredString(candidate, 'keyId');

  if (keyId == null) {
    return null;
  }

  const issuerId = readRequiredString(candidate, 'issuerId');

  if (issuerId == null) {
    return null;
  }

  const label = readRequiredString(candidate, 'label');

  if (label == null) {
    return null;
  }

  const addedAt = readRequiredString(candidate, 'addedAt');

  if (addedAt == null) {
    return null;
  }

  const teamId = readOptionalString(candidate, 'teamId');

  if (teamId.status == 'invalid') {
    return null;
  }

  const apps = readOptionalStringList(candidate, 'apps');

  if (apps.status == 'invalid') {
    return null;
  }

  const resolvedAt = readOptionalString(candidate, 'resolvedAt');

  if (resolvedAt.status == 'invalid') {
    return null;
  }

  const vendorNumber = readOptionalString(candidate, 'vendorNumber');

  if (vendorNumber.status == 'invalid') {
    return null;
  }

  const account: {
    keyId: string;
    issuerId: string;
    label: string;
    addedAt: string;
    teamId?: string;
    apps?: string[];
    resolvedAt?: string;
    vendorNumber?: string;
  } = { keyId, issuerId, label, addedAt };

  if (teamId.status == 'present') {
    account.teamId = teamId.text;
  }

  if (apps.status == 'present') {
    account.apps = apps.texts;
  }

  if (resolvedAt.status == 'present') {
    account.resolvedAt = resolvedAt.text;
  }

  if (vendorNumber.status == 'present') {
    account.vendorNumber = vendorNumber.text;
  }

  return account;
}

function isActiveFieldValid(activeField: unknown): activeField is string | null {
  if (activeField == null) {
    return true;
  }

  return typeof activeField == 'string';
}

function decodeAccountsFile(candidate: unknown): AccountsFile | null {
  if (isRecord(candidate) == false) {
    return null;
  }

  const hasActiveField = 'active' in candidate;

  if (hasActiveField == false) {
    return null;
  }

  const activeField = candidate['active'];

  if (isActiveFieldValid(activeField) == false) {
    return null;
  }

  let active: string | null = null;
  const activeIsString = typeof activeField == 'string';

  if (activeIsString) {
    active = activeField;
  }

  const accountsField = candidate['accounts'];

  if (Array.isArray(accountsField) == false) {
    return null;
  }

  const accounts: AccountRecord[] = [];

  for (const accountField of accountsField) {
    const account = decodeAccountRecord(accountField);

    if (account == null) {
      return null;
    }

    accounts.push(account);
  }

  return { active, accounts };
}

/** Read the registry, returning an empty one when the file is absent or malformed. */
async function readAccounts(): Promise<AccountsFile> {
  const accountsFilePath = resolveAccountsFilePath();
  const registryExists = await pathExists(accountsFilePath);

  if (registryExists == false) {
    return emptyAccountsFile();
  }

  try {
    const registryText = await readFile(accountsFilePath, 'utf8');
    const parsedRegistry: unknown = JSON.parse(registryText);
    const accountsFile = decodeAccountsFile(parsedRegistry);

    if (accountsFile == null) {
      return emptyAccountsFile();
    }

    return accountsFile;
  } catch (error) {
    const isUnreadable = error != null;

    if (isUnreadable) {
      return emptyAccountsFile();
    }

    return emptyAccountsFile();
  }
}

/** Write the registry back to disk (pretty-printed; non-secret metadata only). */
async function writeAccounts(accountsFile: AccountsFile): Promise<void> {
  try {
    const launchHomeDirectory = resolveLaunchHomeDirectory();
    await mkdir(launchHomeDirectory, { recursive: true });
    const accountsFilePath = resolveAccountsFilePath();
    await writeFile(accountsFilePath, JSON.stringify(accountsFile, null, 2));
  } catch (error) {
    const isWriteFailure = error != null;

    if (isWriteFailure) {
      throw makeAccountFailure('Could not write the account registry.');
    }
  }
}

/** Every onboarded account, in insertion order. */
export async function listAccounts(): Promise<readonly AccountRecord[]> {
  const accountsFile = await readAccounts();

  return accountsFile.accounts;
}

/** Key ID of the active account, or null when none is selected. */
export async function getActiveKeyId(): Promise<string | null> {
  const accountsFile = await readAccounts();

  return accountsFile.active;
}

function accountWithKeyId(keyId: string | null) {
  return function hasKeyId(account: AccountRecord): boolean {
    return account.keyId == keyId;
  };
}

/** The active account record, or null when none is selected. */
export async function getActiveAccount(): Promise<AccountRecord | null> {
  const accountsFile = await readAccounts();

  if (accountsFile.active == null) {
    return null;
  }

  const activeAccount = accountsFile.accounts.find(accountWithKeyId(accountsFile.active));

  if (activeAccount == null) {
    return null;
  }

  return activeAccount;
}

/** Find an account by exact Key ID. */
async function findAccount(keyId: string): Promise<AccountRecord | undefined> {
  const accountsFile = await readAccounts();

  return accountsFile.accounts.find(accountWithKeyId(keyId));
}

/** Match an account by its label or Key ID, case-insensitively - the selector form users type. */
export function matchAccount(
  accounts: readonly AccountRecord[],
  selector: string,
): AccountRecord | undefined {
  const needle = selector.trim().toLowerCase();

  function matchesSelector(account: AccountRecord): boolean {
    const keyMatches = account.keyId.toLowerCase() == needle;

    if (keyMatches) {
      return true;
    }

    return account.label.toLowerCase() == needle;
  }

  return accounts.find(matchesSelector);
}

/** Max app names shown inline in {@link formatAccountSummary} before the remainder collapses to `+N`. */
const ACCOUNT_SUMMARY_APP_LIMIT = 3;

/** Options for {@link formatAccountSummary}. */
type AccountSummaryRequest = {
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
export function formatAccountSummary(
  account: AccountRecord,
  summary: AccountSummaryRequest = {},
): string {
  const segments: string[] = [];
  let includeLabel = true;

  if (summary.includeLabel == false) {
    includeLabel = false;
  }

  if (includeLabel) {
    segments.push(account.label);
  }

  let apps: readonly string[] = [];

  if (account.apps != null) {
    apps = account.apps;
  }

  const hasApps = apps.length > 0;

  if (hasApps) {
    const extra = apps.length - ACCOUNT_SUMMARY_APP_LIMIT;
    const shown = apps.slice(0, ACCOUNT_SUMMARY_APP_LIMIT).join(', ');
    let appSummary = shown;

    if (extra > 0) {
      appSummary = `${shown} +${extra}`;
    }

    segments.push(appSummary);
  }

  if (account.teamId != null) {
    if (account.teamId != '') {
      segments.push(`team ${account.teamId}`);
    }
  }

  segments.push(`key ${account.keyId}`);

  return segments.join(' - ');
}

/** Inputs to {@link addAccount}: the key material plus any team/apps already resolved from Apple. */
type AddAccountRequest = {
  keyId: string;
  issuerId: string;
  label: string;
  p8: string;
  teamId?: string | null;
  apps?: string[];
};

function hasSuppliedIdentity(addRequest: AddAccountRequest): boolean {
  if (addRequest.teamId != null) {
    return true;
  }

  if (addRequest.apps == null) {
    return false;
  }

  return addRequest.apps.length > 0;
}

/**
 * Add (or replace) an account and make it active. The `.p8` goes to the OS secret store; the metadata
 * to the registry. Re-adding an existing Key ID updates it in place (keeping its original `addedAt`),
 * so importing the same key with a new label or a fresh `.p8` never creates a duplicate.
 */
export async function addAccount(addRequest: AddAccountRequest): Promise<AccountRecord> {
  await LaunchSecretStore.storeSecret(p8Account(addRequest.keyId), encodeP8(addRequest.p8));

  const accountsFile = await readAccounts();
  const existing = accountsFile.accounts.find(accountWithKeyId(addRequest.keyId));
  const timestamp = currentTimestamp();
  const hasIdentity = hasSuppliedIdentity(addRequest);
  let addedAt = timestamp;

  if (existing != null) {
    addedAt = existing.addedAt;
  }

  const record: {
    keyId: string;
    issuerId: string;
    label: string;
    addedAt: string;
    vendorNumber?: string;
    teamId?: string;
    apps?: string[];
    resolvedAt?: string;
  } = {
    keyId: addRequest.keyId,
    issuerId: addRequest.issuerId,
    label: addRequest.label,
    addedAt,
  };

  if (existing?.vendorNumber != null) {
    record.vendorNumber = existing.vendorNumber;
  }

  if (addRequest.teamId != null) {
    record.teamId = addRequest.teamId;
  }

  if (addRequest.apps != null) {
    if (addRequest.apps.length > 0) {
      record.apps = [...addRequest.apps];
    }
  }

  if (hasIdentity) {
    record.resolvedAt = timestamp;
  }

  function replaceExisting(account: AccountRecord): AccountRecord {
    if (account.keyId == addRequest.keyId) {
      return record;
    }

    return account;
  }

  let accounts: readonly AccountRecord[] = [...accountsFile.accounts, record];

  if (existing != null) {
    accounts = accountsFile.accounts.map(replaceExisting);
  }

  await writeAccounts({ active: addRequest.keyId, accounts });

  return record;
}

/** Refresh an account's cached Team ID / app names in place, preserving prior values a null doesn't replace. */
export async function updateAccountIdentity(
  keyId: string,
  teamId: string | null,
  apps: readonly string[],
): Promise<void> {
  const accountsFile = await readAccounts();
  const timestamp = currentTimestamp();

  function refreshAccount(account: AccountRecord): AccountRecord {
    if (account.keyId != keyId) {
      return account;
    }

    let nextAccount: AccountRecord = { ...account, resolvedAt: timestamp };

    if (teamId != null) {
      nextAccount = { ...nextAccount, teamId };
    }

    if (apps.length > 0) {
      nextAccount = { ...nextAccount, apps: [...apps] };
    }

    return nextAccount;
  }

  const accounts = accountsFile.accounts.map(refreshAccount);
  await writeAccounts({ active: accountsFile.active, accounts });
}

function requireSavedAccount(accountsFile: AccountsFile, keyId: string): void {
  const isAccountSaved = accountsFile.accounts.some(accountWithKeyId(keyId));

  if (isAccountSaved) {
    return;
  }

  throw makeAccountFailure(`No account with key ${keyId}.`);
}

export async function setAccountVendorNumber(keyId: string, vendorNumber: string): Promise<void> {
  const accountsFile = await readAccounts();
  requireSavedAccount(accountsFile, keyId);

  function withVendorNumber(account: AccountRecord): AccountRecord {
    if (account.keyId == keyId) {
      return { ...account, vendorNumber };
    }

    return account;
  }

  const accounts = accountsFile.accounts.map(withVendorNumber);
  await writeAccounts({ active: accountsFile.active, accounts });
}

/** Make `keyId` the active account; throws if it isn't registered. */
export async function setActiveKeyId(keyId: string): Promise<void> {
  const accountsFile = await readAccounts();
  requireSavedAccount(accountsFile, keyId);
  await writeAccounts({ active: keyId, accounts: accountsFile.accounts });
}

/** Rename an account's label; throws if it isn't registered. Caller enforces label uniqueness. */
export async function renameAccount(keyId: string, newLabel: string): Promise<void> {
  const accountsFile = await readAccounts();
  requireSavedAccount(accountsFile, keyId);

  function withLabel(account: AccountRecord): AccountRecord {
    if (account.keyId == keyId) {
      return { ...account, label: newLabel };
    }

    return account;
  }

  const accounts = accountsFile.accounts.map(withLabel);
  await writeAccounts({ active: accountsFile.active, accounts });
}

function nextActiveKeyId(
  currentActive: string | null,
  removedKeyId: string,
  remainingAccounts: readonly AccountRecord[],
): string | null {
  if (currentActive != removedKeyId) {
    return currentActive;
  }

  const firstRemaining = remainingAccounts[0];

  if (firstRemaining == null) {
    return null;
  }

  return firstRemaining.keyId;
}

/**
 * Remove an account completely: its `.p8` and `.p12` password from the secret store, its per-account
 * signing folder, and its registry entry. If it was active, the active pointer falls to the first
 * remaining account (or null when none are left).
 */
export async function removeAccount(keyId: string): Promise<void> {
  await LaunchSecretStore.deleteSecret(p8Account(keyId));
  await LaunchSecretStore.deleteSecret(p12PasswordAccount(keyId));

  const accountDirectory = resolveAccountCredentialsDirectory(keyId);

  try {
    await rm(accountDirectory, { recursive: true, force: true });
  } catch (error) {
    // A missing signing folder still leaves the registry entry to remove.
    const isAlreadyGone = error != null;

    if (isAlreadyGone == false) {
      throw error;
    }
  }

  const accountsFile = await readAccounts();

  function isOtherAccount(account: AccountRecord): boolean {
    return account.keyId != keyId;
  }

  const accounts = accountsFile.accounts.filter(isOtherAccount);
  const active = nextActiveKeyId(accountsFile.active, keyId, accounts);
  await writeAccounts({ active, accounts });
}

/** Load one account's full {@link AscKey} (key from the secret store, ids from the registry), or null. */
export async function loadAscKeyById(keyId: string): Promise<AscKey | null> {
  const record = await findAccount(keyId);

  if (record == null) {
    return null;
  }

  const stored = await LaunchSecretStore.readSecret(p8Account(keyId));

  if (stored == null) {
    return null;
  }

  if (stored == '') {
    return null;
  }

  return { keyId, issuerId: record.issuerId, p8: decodeP8(stored) };
}

/** Load the key of the account `ASC_ACCOUNT` names (label or Key ID), failing when none matches. */
async function loadSelectedAscKey(selector: string): Promise<AscKey | null> {
  const accounts = await listAccounts();
  const selected = matchAccount(accounts, selector);

  if (selected == null) {
    throw makeAccountFailure(
      `No Apple account matching "${selector}". Run \`launch creds\` to list them.`,
    );
  }

  return loadAscKeyById(selected.keyId);
}

/** Load the `ASC_ACCOUNT` account's key, else the active account's, or null when none is selected. */
export async function loadActiveAscKey(): Promise<AscKey | null> {
  const selector = readLaunchEnvironment().values.appleAccount;

  if (selector != null) {
    return loadSelectedAscKey(selector);
  }

  const active = await getActiveKeyId();

  if (active != null) {
    if (active != '') {
      return loadAscKeyById(active);
    }
  }

  return null;
}

export async function loadAscKeyForAccount(
  accountSelector: string | undefined,
): Promise<AscKey | null> {
  const isAccountSelected = accountSelector != null;

  if (isAccountSelected) {
    return loadSelectedAscKey(accountSelector);
  }

  return loadActiveAscKey();
}

/**
 * The decision tree for which account a build uses, factored out as a pure function so it's unit-
 * testable without the filesystem: an explicit selector wins (error if it matches nothing), else the
 * active account, else the sole account when there's exactly one, else a signal to prompt.
 */
type BuildAccountDecision =
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

function hasSelector(selector: string | undefined): selector is string {
  if (selector == null) {
    return false;
  }

  return selector != '';
}

/** Decide which account a build should use from the registry state + an optional selector. Pure. */
export function decideBuildAccount(
  accountsFile: AccountsFile,
  selector?: string,
): BuildAccountDecision {
  const hasNoAccounts = accountsFile.accounts.length == 0;

  if (hasNoAccounts) {
    return {
      kind: 'error',
      message: 'No Apple account configured. Import one with: launch creds set-key',
    };
  }

  if (hasSelector(selector)) {
    const matched = matchAccount(accountsFile.accounts, selector);

    if (matched != null) {
      return { kind: 'use', record: matched };
    }

    return {
      kind: 'error',
      message: `No Apple account matching "${selector}". Run \`launch creds\` to list them.`,
    };
  }

  let active: AccountRecord | undefined;

  if (accountsFile.active != null) {
    if (accountsFile.active != '') {
      active = accountsFile.accounts.find(accountWithKeyId(accountsFile.active));
    }
  }

  if (active != null) {
    return { kind: 'use', record: active };
  }

  const sole = accountsFile.accounts[0];
  const isSoleAccount = accountsFile.accounts.length == 1;

  if (isSoleAccount) {
    if (sole != null) {
      return { kind: 'use', record: sole };
    }
  }

  return { kind: 'pick' };
}

/** Options for {@link resolveBuildAccount}. */
type ResolveBuildAccountRequest = {
  selector?: string | undefined;
  interactive: boolean;
  pick: (accounts: readonly AccountRecord[]) => Promise<AccountRecord>;
};

/**
 * Resolve the account a build should use, applying {@link decideBuildAccount} and then either using
 * the result, prompting via `pick` (interactive only), or throwing an actionable error in CI.
 */
export async function resolveBuildAccount(
  accountRequest: ResolveBuildAccountRequest,
): Promise<AccountRecord> {
  const accountsFile = await readAccounts();
  const decision = decideBuildAccount(accountsFile, accountRequest.selector);

  if (decision.kind == 'use') {
    return decision.record;
  }

  if (decision.kind == 'error') {
    throw makeAccountFailure(decision.message);
  }

  if (accountRequest.interactive == false) {
    throw makeAccountFailure(
      'No active Apple account. Pick one with: launch creds use  (or pass --account / set ASC_ACCOUNT).',
    );
  }

  return accountRequest.pick(accountsFile.accounts);
}

function hasResolvedIdentity(account: AccountRecord): boolean {
  if (account.resolvedAt == null) {
    return false;
  }

  return account.resolvedAt != '';
}

/**
 * Backfill an account's cached team/apps the first time a live key is in hand (e.g. during a build),
 * skipping accounts already resolved. Best-effort: any Apple-side failure is swallowed so it never
 * disrupts the surrounding flow.
 */
export async function refreshIdentityIfStale(
  account: AccountRecord,
  ascKey: AscKey,
): Promise<void> {
  if (hasResolvedIdentity(account)) {
    return;
  }

  try {
    const identity = await AppStoreIdentityService.resolveIdentity(ascKey);
    await updateAccountIdentity(account.keyId, identity.teamId, identity.apps);
  } catch (error) {
    const isAppleUnavailable = error != null;

    if (isAppleUnavailable) {
      return;
    }
  }
}

/**
 * One-time, silent upgrade from the pre-multi-account layout. When `accounts.json` is absent but the
 * legacy single-key secret-store entries exist, move them into the registry as a `default` account:
 * namespace the `.p8` and `.p12` password by Key ID, relocate the signing index per-account, then mark
 * it active. Idempotent and best-effort - a partial run simply re-completes on the next invocation.
 */
export async function migrateLegacyAccounts(): Promise<void> {
  const accountsFilePath = resolveAccountsFilePath();
  const registryExists = await pathExists(accountsFilePath);

  if (registryExists) {
    return;
  }

  const keyId = await LaunchSecretStore.readSecret(LEGACY_KEY_ID);
  const issuerId = await LaunchSecretStore.readSecret(LEGACY_ISSUER_ID);
  const p8 = await LaunchSecretStore.readSecret(LEGACY_P8);

  if (keyId == null) {
    return;
  }

  if (issuerId == null) {
    return;
  }

  if (p8 == null) {
    return;
  }

  await LaunchSecretStore.storeSecret(p8Account(keyId), encodeP8(decodeP8(p8)));

  const legacyPassword = await LaunchSecretStore.readSecret(LEGACY_P12_PASSWORD);

  if (legacyPassword != null) {
    if (legacyPassword != '') {
      await LaunchSecretStore.storeSecret(p12PasswordAccount(keyId), legacyPassword);
      await LaunchSecretStore.deleteSecret(LEGACY_P12_PASSWORD);
    }
  }

  try {
    await migrateLegacySigningIndex(keyId);
  } catch (error) {
    // A partial migration re-completes on the next invocation.
    const isMigrationIncomplete = error != null;

    if (isMigrationIncomplete == false) {
      throw error;
    }
  }

  const timestamp = currentTimestamp();
  await writeAccounts({
    active: keyId,
    accounts: [{ keyId, issuerId, label: 'default', addedAt: timestamp }],
  });
  await LaunchSecretStore.deleteSecret(LEGACY_KEY_ID);
  await LaunchSecretStore.deleteSecret(LEGACY_ISSUER_ID);
  await LaunchSecretStore.deleteSecret(LEGACY_P8);
}
