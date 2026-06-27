/**
 * The Apple-account registry — Launch's multi-account credential store.
 *
 * An App Store Connect API key belongs to exactly one Apple team, so each key *is* an account: this
 * module is the single source of truth for which keys are onboarded, which one is active, and how a
 * build resolves the key to use. Non-secret metadata (Key ID, Issuer ID, label, cached team/apps)
 * lives in `~/.launch/accounts.json`; each account's `.p8` private key stays in the OS secret store
 * under `asc-p8:<keyId>`, and its signing assets in a per-Key-ID folder (see `apple/credentials.ts`).
 *
 * The build pipeline picks an account via {@link resolveBuildAccount} (`--account`/`ASC_ACCOUNT` →
 * active → interactive picker), then loads its key with {@link loadAscKeyById}. Upgrading from the
 * old single-key layout is handled transparently by {@link migrateLegacyAccounts} on first run.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AccountRecord, AccountsFile, AscKey } from './types.js';
import { ACCOUNTS_FILE, LAUNCH_HOME, accountCredentialsDir, ensureDir } from './paths.js';
import { deleteSecret, getSecret, setSecret } from './keychain.js';
import { AppStoreConnectClient } from '../apple/ascClient.js';
import { migrateLegacySigningIndex, p12PasswordAccount } from '../apple/credentials.js';

/** Secret-store account holding one Apple account's `.p8` PEM, namespaced by Key ID. */
function p8Account(keyId: string): string {
  return `asc-p8:${keyId}`;
}

/** The pre-multi-account secret-store accounts a first-run migration reads and then clears. */
const LEGACY_KEY_ID = 'asc-key-id';
const LEGACY_ISSUER_ID = 'asc-issuer-id';
const LEGACY_P8 = 'asc-p8';
const LEGACY_P12_PASSWORD = 'dist-cert-p12-password';

/** ISO-8601 stamp for `addedAt`/`resolvedAt`. */
function nowIso(): string {
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
  if (fromBase64.includes('PRIVATE KEY')) return fromBase64;
  if (/^(?:[0-9a-fA-F]{2})+$/.test(stored)) {
    const fromHex = Buffer.from(stored, 'hex').toString('utf8');
    if (fromHex.includes('PRIVATE KEY')) return fromHex;
  }
  return stored;
}

/** Read the registry, returning an empty one when the file is absent or malformed. */
function readAccounts(): AccountsFile {
  if (!existsSync(ACCOUNTS_FILE)) return { active: null, accounts: [] };
  try {
    const parsed = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) as Partial<AccountsFile>;
    return {
      active: parsed.active ?? null,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
  } catch {
    return { active: null, accounts: [] };
  }
}

/** Write the registry back to disk (pretty-printed; non-secret metadata only). */
function writeAccounts(file: AccountsFile): void {
  ensureDir(LAUNCH_HOME);
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(file, null, 2));
}

/** Every onboarded account, in insertion order. */
export function listAccounts(): AccountRecord[] {
  return readAccounts().accounts;
}

/** Key ID of the active account, or null when none is selected. */
export function getActiveKeyId(): string | null {
  return readAccounts().active;
}

/** The active account record, or null when none is selected. */
export function getActiveAccount(): AccountRecord | null {
  const file = readAccounts();
  return file.active
    ? (file.accounts.find((account) => account.keyId === file.active) ?? null)
    : null;
}

/** Find an account by exact Key ID. */
export function findAccount(keyId: string): AccountRecord | undefined {
  return readAccounts().accounts.find((account) => account.keyId === keyId);
}

/** Match an account by its label or Key ID, case-insensitively — the selector form users type. */
export function matchAccount(
  accounts: AccountRecord[],
  selector: string,
): AccountRecord | undefined {
  const needle = selector.trim().toLowerCase();
  return accounts.find(
    (account) => account.keyId.toLowerCase() === needle || account.label.toLowerCase() === needle,
  );
}

/** Max app names shown inline in {@link formatAccountSummary} before the remainder collapses to `+N`. */
const ACCOUNT_SUMMARY_APP_LIMIT = 3;

/** Options for {@link formatAccountSummary}. */
export interface AccountSummaryOptions {
  /**
   * Whether to lead with the account label. The build step line and `launch creds` listing want it
   * (`default · …`); the interactive picker renders the label separately as the option title, so it
   * passes `false` to keep the hint from repeating it.
   */
  includeLabel?: boolean;
}

/**
 * One human-recognizable line for an account, shared by the build step line, the `launch creds`
 * listing, and the account picker hint so all three read identically.
 *
 * It leads with the cached app names the key can see — the thing a person actually recognizes — then
 * the Team ID and Key ID for traceability: `default · OlyWell, Zaatar, Mealsy +4 · team … · key …`.
 * Up to {@link ACCOUNT_SUMMARY_APP_LIMIT} apps show inline and the rest collapse to `+N`; an empty or
 * not-yet-resolved app list is omitted, so the line degrades cleanly to `label · team · key`. Renders
 * only what's cached on the record — never an Apple call.
 */
export function formatAccountSummary(
  account: AccountRecord,
  options: AccountSummaryOptions = {},
): string {
  const segments: string[] = [];
  if (options.includeLabel !== false) segments.push(account.label);
  const apps = account.apps ?? [];
  if (apps.length > 0) {
    const extra = apps.length - ACCOUNT_SUMMARY_APP_LIMIT;
    const shown = apps.slice(0, ACCOUNT_SUMMARY_APP_LIMIT).join(', ');
    segments.push(extra > 0 ? `${shown} +${extra}` : shown);
  }
  if (account.teamId) segments.push(`team ${account.teamId}`);
  segments.push(`key ${account.keyId}`);
  return segments.join(' · ');
}

/** Inputs to {@link addAccount}: the key material plus any team/apps already resolved from Apple. */
export interface AddAccountInput {
  keyId: string;
  issuerId: string;
  label: string;
  /** PEM contents of the `.p8` private key. Stored (base64) in the OS secret store, never on disk. */
  p8: string;
  /** Resolved Apple Team ID, if known; null/absent leaves the account unresolved. */
  teamId?: string | null;
  /** Resolved accessible app names, if known. */
  apps?: string[];
}

/**
 * Add (or replace) an account and make it active. The `.p8` goes to the OS secret store; the metadata
 * to the registry. Re-adding an existing Key ID updates it in place (keeping its original `addedAt`),
 * so importing the same key with a new label or a fresh `.p8` never creates a duplicate.
 */
export async function addAccount(input: AddAccountInput): Promise<AccountRecord> {
  await setSecret(p8Account(input.keyId), encodeP8(input.p8));
  const file = readAccounts();
  const existing = file.accounts.find((account) => account.keyId === input.keyId);
  const hasIdentity = input.teamId != null || (input.apps?.length ?? 0) > 0;
  const record: AccountRecord = {
    keyId: input.keyId,
    issuerId: input.issuerId,
    label: input.label,
    addedAt: existing?.addedAt ?? nowIso(),
    ...(input.teamId != null ? { teamId: input.teamId } : {}),
    ...(input.apps?.length ? { apps: input.apps } : {}),
    ...(hasIdentity ? { resolvedAt: nowIso() } : {}),
  };
  const accounts = existing
    ? file.accounts.map((account) => (account.keyId === input.keyId ? record : account))
    : [...file.accounts, record];
  writeAccounts({ active: input.keyId, accounts });
  return record;
}

/** Refresh an account's cached Team ID / app names in place, preserving prior values a null doesn't replace. */
export function updateAccountIdentity(keyId: string, teamId: string | null, apps: string[]): void {
  const file = readAccounts();
  const accounts = file.accounts.map((account) => {
    if (account.keyId !== keyId) return account;
    const next: AccountRecord = { ...account, resolvedAt: nowIso() };
    if (teamId != null) next.teamId = teamId;
    if (apps.length > 0) next.apps = apps;
    return next;
  });
  writeAccounts({ active: file.active, accounts });
}

/** Make `keyId` the active account; throws if it isn't registered. */
export function setActiveKeyId(keyId: string): void {
  const file = readAccounts();
  if (!file.accounts.some((account) => account.keyId === keyId)) {
    throw new Error(`No account with key ${keyId}.`);
  }
  writeAccounts({ active: keyId, accounts: file.accounts });
}

/** Rename an account's label; throws if it isn't registered. Caller enforces label uniqueness. */
export function renameAccount(keyId: string, newLabel: string): void {
  const file = readAccounts();
  if (!file.accounts.some((account) => account.keyId === keyId)) {
    throw new Error(`No account with key ${keyId}.`);
  }
  const accounts = file.accounts.map((account) =>
    account.keyId === keyId ? { ...account, label: newLabel } : account,
  );
  writeAccounts({ active: file.active, accounts });
}

/**
 * Remove an account completely: its `.p8` and `.p12` password from the secret store, its per-account
 * signing folder, and its registry entry. If it was active, the active pointer falls to the first
 * remaining account (or null when none are left).
 */
export async function removeAccount(keyId: string): Promise<void> {
  await deleteSecret(p8Account(keyId));
  await deleteSecret(p12PasswordAccount(keyId));
  try {
    rmSync(accountCredentialsDir(keyId), { recursive: true, force: true });
  } catch {
    /* nothing cached for this account — fine */
  }
  const file = readAccounts();
  const accounts = file.accounts.filter((account) => account.keyId !== keyId);
  const active = file.active === keyId ? (accounts[0]?.keyId ?? null) : file.active;
  writeAccounts({ active, accounts });
}

/** Load one account's full {@link AscKey} (key from the secret store, ids from the registry), or null. */
export async function loadAscKeyById(keyId: string): Promise<AscKey | null> {
  const record = findAccount(keyId);
  if (!record) return null;
  const stored = await getSecret(p8Account(keyId));
  if (!stored) return null;
  return { keyId, issuerId: record.issuerId, p8: decodeP8(stored) };
}

/** Load the active account's key, or null when none is selected. */
export async function loadActiveAscKey(): Promise<AscKey | null> {
  const active = getActiveKeyId();
  return active ? loadAscKeyById(active) : null;
}

/**
 * The decision tree for which account a build uses, factored out as a pure function so it's unit-
 * testable without the filesystem: an explicit selector wins (error if it matches nothing), else the
 * active account, else the sole account when there's exactly one, else a signal to prompt.
 */
export type BuildAccountDecision =
  | { kind: 'use'; record: AccountRecord }
  | { kind: 'pick' }
  | { kind: 'error'; message: string };

/** Decide which account a build should use from the registry state + an optional selector. Pure. */
export function decideBuildAccount(file: AccountsFile, selector?: string): BuildAccountDecision {
  if (file.accounts.length === 0) {
    return {
      kind: 'error',
      message: 'No Apple account configured. Import one with: launch creds set-key',
    };
  }
  if (selector) {
    const matched = matchAccount(file.accounts, selector);
    return matched
      ? { kind: 'use', record: matched }
      : {
          kind: 'error',
          message: `No Apple account matching "${selector}". Run \`launch creds\` to list them.`,
        };
  }
  const active = file.active
    ? file.accounts.find((account) => account.keyId === file.active)
    : undefined;
  if (active) return { kind: 'use', record: active };
  const sole = file.accounts[0];
  if (file.accounts.length === 1 && sole) return { kind: 'use', record: sole };
  return { kind: 'pick' };
}

/** Options for {@link resolveBuildAccount}. */
export interface ResolveBuildAccountOptions {
  /** `--account`/`ASC_ACCOUNT` selector (label or Key ID). Undefined falls through to the active account. */
  selector?: string | undefined;
  /** Whether prompting is allowed (a real TTY, not CI). When false and a pick is needed, this throws. */
  interactive: boolean;
  /** Renders the interactive picker among the given accounts and returns the chosen one. */
  pick: (accounts: AccountRecord[]) => Promise<AccountRecord>;
}

/**
 * Resolve the account a build should use, applying {@link decideBuildAccount} and then either using
 * the result, prompting via `pick` (interactive only), or throwing an actionable error in CI.
 */
export async function resolveBuildAccount(
  options: ResolveBuildAccountOptions,
): Promise<AccountRecord> {
  const file = readAccounts();
  const decision = decideBuildAccount(file, options.selector);
  if (decision.kind === 'use') return decision.record;
  if (decision.kind === 'error') throw new Error(decision.message);
  if (!options.interactive) {
    throw new Error(
      'No active Apple account. Pick one with: launch creds use  (or pass --account / set ASC_ACCOUNT).',
    );
  }
  return options.pick(file.accounts);
}

/** Validated Apple-side identity for an account: the Team ID and visible app names (best-effort each). */
export interface AccountIdentity {
  teamId: string | null;
  apps: string[];
}

/** Resolve an account's Team ID + accessible app names from Apple (each degrades to null/[] on failure). */
export async function resolveAccountIdentity(ascKey: AscKey): Promise<AccountIdentity> {
  const client = new AppStoreConnectClient(ascKey);
  const teamId = await client.resolveTeamId().catch(() => null);
  const apps = await client.listAppNames().catch(() => []);
  return { teamId, apps };
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
  if (account.resolvedAt) return;
  try {
    const identity = await resolveAccountIdentity(ascKey);
    updateAccountIdentity(account.keyId, identity.teamId, identity.apps);
  } catch {
    /* a refresh is a nicety, never a gate */
  }
}

/**
 * One-time, silent upgrade from the pre-multi-account layout. When `accounts.json` is absent but the
 * legacy single-key secret-store entries exist, move them into the registry as a `default` account:
 * namespace the `.p8` and `.p12` password by Key ID, relocate the signing index per-account, then mark
 * it active. Idempotent and best-effort — a partial run simply re-completes on the next invocation.
 */
export async function migrateLegacyAccounts(): Promise<void> {
  if (existsSync(ACCOUNTS_FILE)) return;
  const keyId = await getSecret(LEGACY_KEY_ID);
  const issuerId = await getSecret(LEGACY_ISSUER_ID);
  const p8 = await getSecret(LEGACY_P8);
  if (!keyId || !issuerId || !p8) return; // fresh install — nothing imported the old way

  await setSecret(p8Account(keyId), encodeP8(decodeP8(p8)));
  const legacyPassword = await getSecret(LEGACY_P12_PASSWORD);
  if (legacyPassword) {
    await setSecret(p12PasswordAccount(keyId), legacyPassword);
    await deleteSecret(LEGACY_P12_PASSWORD);
  }
  try {
    migrateLegacySigningIndex(keyId);
  } catch {
    /* leave it — the account simply re-provisions its signing assets on the next build */
  }
  writeAccounts({
    active: keyId,
    accounts: [{ keyId, issuerId, label: 'default', addedAt: nowIso() }],
  });
  await deleteSecret(LEGACY_KEY_ID);
  await deleteSecret(LEGACY_ISSUER_ID);
  await deleteSecret(LEGACY_P8);
}
