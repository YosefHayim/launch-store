/**
 * `launch creds [status|set-key|setup|use|rename|remove|refresh|push-key]` — manage credentials for
 * either platform and switch between multiple Apple accounts.
 *
 * - `set-key` onboards an account's API credential and makes it active. iOS: an App Store Connect API
 *   key (`.p8` + Key ID + Issuer ID), auto-discovering the `AuthKey_*.p8` in `~/Downloads`, validated
 *   against Apple and tagged with a label. Android (`--platform android`): a Play service-account JSON.
 *   Both store the secret in the OS secret store and run non-interactively from flags/env (CI/agents).
 * - `setup` runs the one-time provisioning for the active (or `--account`) iOS app / Android keystore.
 * - `use` switches the active Apple account — `use <label>` directly, or a merged picker (onboarded
 *   accounts plus un-imported `.p8`s found on disk) when run with no argument.
 * - `rename` / `remove` / `refresh` manage the account registry; `status` reports every account.
 * - `push-key [import|status|export]` is the APNs auth-key vault: import a download-once `.p8` Apple
 *   has no API to mint, list what's vaulted, or re-export one to disk. See `core/pushKeyStore.ts`.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { cancel, confirm, isCancel, password, select, text } from '@clack/prompts';
import type { AccountRecord, AscKey, Platform } from '../../core/types.js';
import { parsePlatform } from '../../core/platform.js';
import {
  type AccountIdentity,
  addAccount,
  formatAccountSummary,
  getActiveKeyId,
  getActiveAccount,
  listAccounts,
  loadAscKeyById,
  matchAccount,
  removeAccount,
  renameAccount,
  resolveAccountIdentity,
  setActiveKeyId,
  updateAccountIdentity,
} from '../../core/accounts.js';
import { loadConfig } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import { pickOne } from '../../core/prompt.js';
import { findPushKey, importPushKey, listPushKeys, loadPushKey } from '../../core/pushKeyStore.js';
import { interactiveConfirm, selectApp } from '../../core/pipeline.js';
import { AppStoreConnectClient } from '../../apple/ascClient.js';
import { ensureSigningCredentials } from '../../apple/credentials.js';
import { extractKeyId, findAuthKeyFiles, reconcileKeyId } from '../../apple/keyfile.js';
import {
  type KeystoreImport,
  ensureUploadKeystore,
  storeServiceAccount,
} from '../../google/credentials.js';
import { localCredentialsProvider } from '../../providers/credentials/local.js';

const log = createLogger(false);

/**
 * Inputs for the `creds` subcommands, from flags and/or env. Any field left unset is inferred (Key ID
 * from the filename), discovered (the `.p8` in `~/Downloads`), or prompted for — unless `yes` forces
 * non-interactive (then a missing required value fails with the exact flag/env to set).
 */
export interface CredsOptions {
  /** Which platform's credentials to act on. Defaults to `ios`. */
  platform?: string;
  /** App Store Connect Key ID; defaults to the one in the `AuthKey_<KEYID>.p8` filename. */
  keyId?: string;
  /** Issuer ID UUID; falls back to `ASC_ISSUER_ID`, then a prompt. */
  issuerId?: string;
  /** Path to the `.p8`; falls back to `ASC_API_KEY_PATH`, then auto-discovery in `~/Downloads`. */
  p8?: string;
  /** Human label for the account being added (iOS `set-key`); falls back to a prompt, then the Key ID. */
  label?: string;
  /** Account selector (label or Key ID) for `setup` — which Apple account to provision against. */
  account?: string;
  /**
   * App handle to provision for `setup` (by `name`), so a specific app is (re)provisioned without a
   * prompt — what the shared app selector's "pass --app <name>" hint refers to. Defaults to the sole
   * discovered app, or (interactively) a picker.
   */
  app?: string;
  /** Android: path to an existing keystore to import (BYO) instead of generating a fresh one. */
  import?: string;
  /** Android: key alias inside the imported keystore. */
  alias?: string;
  /** Non-interactive: fail (with the flag/env to set) instead of prompting. For CI, remote, agents. */
  yes?: boolean;
  /** APNs Team ID for `push-key import`; defaults to the active account's resolved Team ID. */
  teamId?: string;
  /** Output path for `push-key export` — where to write the `.p8`; else prompted (or required in CI). */
  out?: string;
  /** Overwrite the existing file on `push-key export` (a deliberate guard around a secret). */
  force?: boolean;
}

/**
 * Directories scanned for an `AuthKey_*.p8` when no explicit path is given, most-likely first:
 * the browser's Downloads (Apple's "Download" button lands here), the locations Apple's own tools
 * read keys from, Launch's own credentials dir, and the project (`./private_keys`, then cwd).
 */
const SEARCH_DIRS = [
  join(homedir(), 'Downloads'),
  join(homedir(), '.appstoreconnect', 'private_keys'),
  join(homedir(), '.launch', 'credentials'),
  join(process.cwd(), 'private_keys'),
  process.cwd(),
];

/**
 * Whether `file` sits directly in one of the {@link SEARCH_DIRS} Launch scans — i.e. a sync'd/backed-up
 * "dumping ground" (chiefly `~/Downloads`) where a private key shouldn't be left lying around once it's
 * safely in the keychain. A key the user deliberately placed elsewhere (an explicit `--p8 ~/vault/…`)
 * is NOT in a discovery dir, so it's never offered for deletion. Exported for the unit test.
 */
export function isInDiscoveryDir(file: string): boolean {
  const parent = resolve(dirname(file));
  return SEARCH_DIRS.some((dir) => resolve(dir) === parent);
}

/**
 * After a secret has been imported into the OS keychain (now the source of truth), offer to remove the
 * plaintext source file when it's sitting in a discovery directory. Honors the project invariant that
 * secrets live only in the keychain — it never relocates the file into `~/.launch`, only deletes it.
 *
 * Interactive: prompt, defaulting to delete. Non-interactive: keep it and print the exact path, so a key
 * is never deleted without consent (and the user still learns it's safe to remove).
 */
async function offerToRemoveImportedSecret(
  file: string,
  label: string,
  canPrompt: boolean,
): Promise<void> {
  if (!isInDiscoveryDir(file)) return;
  if (!canPrompt) {
    log.line(
      `The plaintext ${label} is still at ${tildify(file)} — it's in your keychain now, so you can delete it.`,
    );
    return;
  }
  const remove = await confirm({
    message: `Remove the plaintext ${label} from ${tildify(file)}? It's now stored securely in your keychain.`,
    initialValue: true,
  });
  if (isCancel(remove)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  if (!remove) {
    log.line(`Kept ${tildify(file)}.`);
    return;
  }
  rmSync(file, { force: true });
  log.line(`Removed ${tildify(file)}.`);
}

/** Prompt for a required value, exiting cleanly if the user cancels. */
async function ask(message: string, placeholder?: string): Promise<string> {
  const value = await text({
    message,
    validate: (v) => (v?.trim() ? undefined : 'Required.'),
    ...(placeholder ? { placeholder } : {}),
  });
  if (isCancel(value)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  return value.trim();
}

/** Prompt for a required secret (masked, never trimmed), exiting cleanly if the user cancels. */
async function askSecret(message: string): Promise<string> {
  const value = await password({ message, validate: (v) => (v === '' ? 'Required.' : undefined) });
  if (isCancel(value)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  return value;
}

/** Expand a leading `~` to the home directory. */
function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

/** Collapse the home directory back to `~` for friendlier display. */
function tildify(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** Fail a non-interactive run with the exact flag/env the caller should set. */
function requireValue(label: string, how: string): never {
  throw new Error(
    `${label} is required. Pass ${how}, or run \`launch creds set-key\` in an interactive terminal.`,
  );
}

/**
 * Resolve which `.p8` to import: an explicit `--p8`/`ASC_API_KEY_PATH` wins; otherwise auto-discover
 * `AuthKey_*.p8` in `~/Downloads` (and the cwd). One match is used directly; several are disambiguated
 * by a prompt (or the newest when non-interactive); none triggers a prompt (or a clear error).
 */
async function resolveP8Path(options: CredsOptions, canPrompt: boolean): Promise<string> {
  const explicit = options.p8 ?? process.env['ASC_API_KEY_PATH'];
  if (explicit) {
    const path = expandHome(explicit);
    if (!existsSync(path)) throw new Error(`No .p8 file at ${explicit}.`);
    return path;
  }

  const found = SEARCH_DIRS.flatMap(findAuthKeyFiles);
  const [first, ...rest] = found;
  if (first && rest.length === 0) {
    log.line(`Found API key ${tildify(first)}.`);
    return first;
  }
  if (first) {
    return pickOne<string>({
      message: 'Multiple API keys found — pick one:',
      options: found.map((path) => ({ value: path, label: tildify(path) })),
      canPrompt,
      nonInteractive: {
        kind: 'fallback',
        value: first,
        note: `Multiple API keys found; using ${tildify(first)}. Pass --p8 to choose another.`,
      },
    });
  }

  if (!canPrompt)
    requireValue('A .p8 key file', '--p8 <path> or ASC_API_KEY_PATH (none found in ~/Downloads)');
  const typed = await ask('Path to the .p8 file', '~/Downloads/AuthKey_XXXX.p8');
  const path = expandHome(typed);
  if (!existsSync(path)) throw new Error(`No .p8 file at ${typed}.`);
  return path;
}

/** Resolve a unique label for an account, prompting when possible and rejecting a clash with another key. */
async function resolveLabel(
  options: CredsOptions,
  keyId: string,
  canPrompt: boolean,
): Promise<string> {
  const proposed =
    options.label ?? (canPrompt ? await ask('Label for this account', 'e.g. Personal') : keyId);
  const label = proposed.trim() || keyId;
  const clash = listAccounts().find(
    (a) => a.label.toLowerCase() === label.toLowerCase() && a.keyId !== keyId,
  );
  if (clash)
    throw new Error(
      `Label "${label}" is already used by key ${clash.keyId}. Choose another with --label.`,
    );
  return label;
}

/**
 * Validate a key against Apple and resolve its Team ID + app names. A definitive auth rejection (401/403)
 * fails the import — the key would never work. Any other failure (offline, transient) is tolerated: the
 * account is saved unresolved, to be filled in by a later `launch creds refresh` or the next build.
 */
async function validateAndResolve(ascKey: AscKey): Promise<AccountIdentity> {
  try {
    await new AppStoreConnectClient(ascKey).assertReady();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/\((401|403)\)/.test(message)) {
      throw new Error(
        `That key was rejected by Apple (${message}). Check the Key ID, Issuer ID, and .p8 all match.`,
      );
    }
    log.warn(
      `Could not verify the key with Apple (${message}). Saving it unresolved — run \`launch creds refresh\` later.`,
    );
    return { teamId: null, apps: [] };
  }
  return resolveAccountIdentity(ascKey);
}

/** Onboard an iOS account from a specific `.p8`: capture Key ID/Issuer ID/label, validate, store, activate. */
async function importIosKeyFromPath(
  p8Path: string,
  options: CredsOptions,
  canPrompt: boolean,
): Promise<void> {
  const keyId =
    reconcileKeyId(options.keyId ?? process.env['ASC_KEY_ID'], extractKeyId(p8Path)) ??
    (canPrompt
      ? await ask('App Store Connect Key ID', 'e.g. F5763D97BY')
      : requireValue('Key ID', '--key-id or ASC_KEY_ID'));

  const issuerId =
    options.issuerId ??
    process.env['ASC_ISSUER_ID'] ??
    (canPrompt
      ? await ask('Issuer ID', 'the UUID from Users & Access → Integrations')
      : requireValue('Issuer ID', '--issuer-id or ASC_ISSUER_ID'));

  const label = await resolveLabel(options, keyId, canPrompt);
  const p8 = readFileSync(p8Path, 'utf8');
  const identity = await validateAndResolve({ keyId, issuerId, p8 });
  await addAccount({ keyId, issuerId, label, p8, teamId: identity.teamId, apps: identity.apps });

  const teamLine = identity.teamId ? `, team ${identity.teamId}` : '';
  const appsLine = identity.apps.length
    ? ` · sees ${identity.apps.slice(0, 3).join(', ')}${identity.apps.length > 3 ? '…' : ''}`
    : '';
  log.line(
    `Added Apple account "${label}" (key ${keyId}${teamLine}) and set it active.${appsLine}`,
  );

  // Only offer to delete the source .p8 once Apple has verified the stored copy works (teamId resolved).
  // Apple lets you download a .p8 exactly once, so we never remove an unverified key's only copy.
  if (identity.teamId)
    await offerToRemoveImportedSecret(p8Path, 'App Store Connect key', canPrompt);
}

/** Import an App Store Connect API key (the iOS `set-key`), discovering the `.p8` first. */
async function setKey(options: CredsOptions): Promise<void> {
  const canPrompt = options.yes !== true && process.stdin.isTTY;
  const p8Path = await resolveP8Path(options, canPrompt);
  await importIosKeyFromPath(p8Path, options, canPrompt);
}

/** Import a Play service-account JSON into the OS secret store (the Android `set-key`). */
async function setAndroidKey(value: string | undefined, options: CredsOptions): Promise<void> {
  const canPrompt = options.yes !== true && process.stdin.isTTY;
  const given =
    value ??
    process.env['PLAY_SERVICE_ACCOUNT'] ??
    (canPrompt
      ? await ask('Path to the Play service-account JSON', '~/Downloads/service-account.json')
      : requireValue(
          'A service-account JSON path',
          'the path as an argument or PLAY_SERVICE_ACCOUNT',
        ));
  const path = expandHome(given);
  if (!existsSync(path)) throw new Error(`No service-account JSON at ${given}.`);
  await storeServiceAccount(readFileSync(path, 'utf8'));
  log.line(`Stored Play service account (${tildify(path)}) in the secret store.`);
  // The JSON is re-downloadable from the Google Cloud console, so no verification gate is needed here.
  await offerToRemoveImportedSecret(path, 'Play service-account key', canPrompt);
}

/** A short hint string for an account row in the picker: the apps it can see, plus team and key ids. */
function accountHint(keyId: string): string | undefined {
  const account = listAccounts().find((a) => a.keyId === keyId);
  return account ? formatAccountSummary(account, { includeLabel: false }) : undefined;
}

/** Find `.p8` keys on disk whose Key ID isn't onboarded yet — the "add new" candidates in the picker. */
function discoverUnimportedKeys(importedKeyIds: Set<string>): { path: string; keyId: string }[] {
  const seen = new Set<string>();
  const candidates: { path: string; keyId: string }[] = [];
  for (const path of SEARCH_DIRS.flatMap(findAuthKeyFiles)) {
    const keyId = extractKeyId(path);
    if (!keyId || importedKeyIds.has(keyId) || seen.has(keyId)) continue;
    seen.add(keyId);
    candidates.push({ path, keyId });
  }
  return candidates;
}

/**
 * The interactive Apple-account chooser shared by `launch creds use` and the no-args wizard. Lists the
 * onboarded accounts (marking the active one), any un-imported `.p8`s found on disk as quick-add rows,
 * and an explicit "+ Add another Apple account…" row that runs full onboarding. Activates the chosen
 * account and returns it. The add row is always present, so it works even before any account exists.
 */
export async function chooseAccountInteractive(options: CredsOptions = {}): Promise<AccountRecord> {
  const accounts = listAccounts();
  const active = getActiveKeyId();
  const unimported = discoverUnimportedKeys(new Set(accounts.map((a) => a.keyId)));
  const ADD_NEW = 'add:new';

  const rows = [
    ...accounts.map((a) => {
      const hint = accountHint(a.keyId);
      return {
        value: `acct:${a.keyId}`,
        label: `${a.label}${a.keyId === active ? ' (active)' : ''}`,
        ...(hint ? { hint } : {}),
      };
    }),
    ...unimported.map((u) => ({
      value: `file:${u.path}`,
      label: `${tildify(u.path)} — not imported`,
      hint: `key ${u.keyId} · add`,
    })),
    { value: ADD_NEW, label: '+ Add another Apple account…', hint: 'import a new .p8 key' },
  ];

  const choice = await select({ message: 'Choose an Apple account:', options: rows });
  if (isCancel(choice)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  if (choice.startsWith('acct:')) {
    const keyId = choice.slice('acct:'.length);
    setActiveKeyId(keyId);
    const account = accounts.find((a) => a.keyId === keyId);
    log.line(`Active Apple account: ${account?.label ?? keyId} (key ${keyId}).`);
  } else if (choice === ADD_NEW) {
    await setKey(options);
  } else {
    await importIosKeyFromPath(choice.slice('file:'.length), options, true);
  }
  const chosen = getActiveAccount();
  if (!chosen) throw new Error('No active Apple account after selection.');
  return chosen;
}

/** Switch the active Apple account: a direct selector, or the merged picker when none is given. */
async function useAccount(selector: string | undefined, options: CredsOptions): Promise<void> {
  if (selector) {
    const matched = matchAccount(listAccounts(), selector);
    if (!matched)
      throw new Error(
        `No Apple account matching "${selector}". Run \`launch creds\` to list them.`,
      );
    setActiveKeyId(matched.keyId);
    log.line(`Active Apple account: ${matched.label} (key ${matched.keyId}).`);
    return;
  }
  if (options.yes === true || !process.stdin.isTTY) {
    throw new Error('Pass an account label or Key ID: launch creds use <account>.');
  }
  await chooseAccountInteractive(options);
}

/** Rename an account's label, rejecting a clash with another account. */
function renameAccountCommand(selector: string | undefined, newLabel: string | undefined): void {
  if (!selector || !newLabel) throw new Error('Usage: launch creds rename <account> <new-label>.');
  const matched = matchAccount(listAccounts(), selector);
  if (!matched) throw new Error(`No Apple account matching "${selector}".`);
  const label = newLabel.trim();
  const clash = listAccounts().find(
    (a) => a.label.toLowerCase() === label.toLowerCase() && a.keyId !== matched.keyId,
  );
  if (clash) throw new Error(`Label "${label}" is already used by key ${clash.keyId}.`);
  renameAccount(matched.keyId, label);
  log.line(`Renamed account ${matched.keyId} to "${label}".`);
}

/** Remove an account (key + signing assets + registry entry), confirming first in an interactive run. */
async function removeAccountCommand(
  selector: string | undefined,
  options: CredsOptions,
): Promise<void> {
  if (!selector) throw new Error('Usage: launch creds remove <account>.');
  const matched = matchAccount(listAccounts(), selector);
  if (!matched) throw new Error(`No Apple account matching "${selector}".`);
  const canPrompt = options.yes !== true && process.stdin.isTTY;
  if (canPrompt) {
    const ok = await interactiveConfirm(
      `Remove account "${matched.label}" (key ${matched.keyId})? This deletes its stored key and signing assets.`,
    );
    if (!ok) {
      log.line('Left unchanged.');
      return;
    }
  }
  await removeAccount(matched.keyId);
  log.line(`Removed Apple account "${matched.label}".`);
}

/** Re-fetch Team ID + app names from Apple for one account (by selector) or all of them. */
async function refreshAccounts(selector: string | undefined): Promise<void> {
  const all = listAccounts();
  const targets = selector ? all.filter((a) => a === matchAccount(all, selector)) : all;
  if (targets.length === 0) {
    throw new Error(
      selector ? `No Apple account matching "${selector}".` : 'No Apple accounts to refresh.',
    );
  }
  for (const account of targets) {
    // biome-ignore lint/performance/noAwaitInLoops: serial per-app store call — one request per app; kept sequential to respect the store API rate limit
    const ascKey = await loadAscKeyById(account.keyId);
    if (!ascKey) {
      log.warn(`Skipped "${account.label}": no stored key (re-import with launch creds set-key).`);
      continue;
    }
    const identity = await resolveAccountIdentity(ascKey);
    updateAccountIdentity(account.keyId, identity.teamId, identity.apps);
    const appsLine = identity.apps.length ? ` · ${identity.apps.length} app(s)` : '';
    log.line(`Refreshed "${account.label}": ${identity.teamId ?? 'team unresolved'}${appsLine}.`);
  }
}

/** Provision (or reuse) the distribution certificate + provisioning profile for the chosen iOS account/app. */
export async function setupIos(options: CredsOptions, platform: Platform = 'ios'): Promise<void> {
  const selector = options.account ?? process.env['ASC_ACCOUNT'];
  const account = selector ? matchAccount(listAccounts(), selector) : getActiveAccount();
  if (!account) {
    throw new Error(
      selector
        ? `No Apple account matching "${selector}".`
        : 'No active Apple account. Import one: launch creds set-key',
    );
  }
  const ascKey = await loadAscKeyById(account.keyId);
  if (!ascKey)
    throw new Error(
      `Account "${account.label}" has no stored key. Re-import: launch creds set-key`,
    );
  const { apps } = await loadConfig();
  const app = await selectApp(apps, options.app);
  if (!app.bundleId)
    throw new Error(
      `No iOS bundle identifier for ${app.name}. Set ios.bundleIdentifier in app.json.`,
    );
  const signing = await ensureSigningCredentials({
    platform,
    bundleId: app.bundleId,
    appName: app.name,
    ascKey,
    log: createLogger(false),
    dryRun: false,
    confirmCreate: interactiveConfirm,
  });
  log.line(
    `Ready (${account.label}): distribution cert ${signing.certSerial}, profile ${signing.profileName} (team ${signing.teamId}).`,
  );
}

/** Resolve a BYO `--import` keystore into a {@link KeystoreImport}, prompting/falling back for the secrets. */
async function resolveKeystoreImport(options: CredsOptions): Promise<KeystoreImport | undefined> {
  if (!options.import) return undefined;
  const path = expandHome(options.import);
  if (!existsSync(path)) throw new Error(`No keystore at ${options.import}.`);
  const canPrompt = options.yes !== true && process.stdin.isTTY;
  const alias =
    options.alias ??
    (canPrompt
      ? await ask('Key alias inside the keystore', 'upload')
      : requireValue('--alias', '--alias <alias>'));
  const storePassword =
    process.env['ANDROID_KEYSTORE_PASSWORD'] ??
    (canPrompt
      ? await askSecret('Keystore (store) password')
      : requireValue('Keystore password', 'ANDROID_KEYSTORE_PASSWORD'));
  const keyPassword = process.env['ANDROID_KEY_PASSWORD'] ?? storePassword;
  return { path, alias, storePassword, keyPassword };
}

/** Generate (or import) the upload keystore for an Android app (the Android `setup`). */
async function setupAndroid(options: CredsOptions): Promise<void> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, options.app);
  const keystoreImport = await resolveKeystoreImport(options);
  const keystore = await ensureUploadKeystore({
    appName: app.name,
    log: createLogger(false),
    dryRun: false,
    confirmCreate: interactiveConfirm,
    ...(keystoreImport ? { import: keystoreImport } : {}),
  });
  log.line(`Ready: upload keystore at ${tildify(keystore.path)} (alias ${keystore.alias}).`);
}

/** `launch creds push-key [import|status|export]` — the APNs push-key vault (import-only; Apple has no create API). */
async function pushKeyCommand(
  sub: string | undefined,
  value: string | undefined,
  options: CredsOptions,
): Promise<void> {
  switch (sub) {
    case 'import':
      await importPushKeyCommand(value, options);
      return;
    case undefined:
    case 'status':
      statusPushKeys();
      return;
    case 'export':
      await exportPushKeyCommand(value, options);
      return;
    default:
      throw new Error(`Unknown push-key action "${sub}". Use import, status, or export.`);
  }
}

/**
 * Import an APNs `.p8` into the vault. The Key ID comes from the `AuthKey_<KEYID>.p8` filename (or
 * `--key-id`); the Team ID defaults to the active account's. The source `.p8` is NOT offered for
 * deletion — like the ASC key it's download-once from Apple, and unlike the ASC key there's no API to
 * verify the stored copy works, so removing the only plaintext copy would be unsafe.
 */
async function importPushKeyCommand(
  pathArg: string | undefined,
  options: CredsOptions,
): Promise<void> {
  const canPrompt = options.yes !== true && process.stdin.isTTY;
  const given =
    pathArg ??
    options.p8 ??
    (canPrompt
      ? await ask('Path to the APNs key (.p8)', '~/Downloads/AuthKey_XXXX.p8')
      : requireValue('A .p8 path', 'the path as an argument'));
  const path = expandHome(given);
  if (!existsSync(path)) throw new Error(`No .p8 file at ${given}.`);

  const keyId =
    reconcileKeyId(options.keyId, extractKeyId(path)) ??
    (canPrompt
      ? await ask('APNs Key ID', 'e.g. ABC123DEFG')
      : requireValue('Key ID', '--key-id (or name the file AuthKey_<KEYID>.p8)'));
  const teamId = options.teamId ?? getActiveAccount()?.teamId;
  const label = options.label ?? keyId;

  await importPushKey({
    keyId,
    p8: readFileSync(path, 'utf8'),
    label,
    ...(teamId ? { teamId } : {}),
  });
  log.line(`Imported APNs key ${keyId}${teamId ? ` (team ${teamId})` : ''} into the vault.`);
  log.line(
    `The .p8 stays in your keychain. Keep ${tildify(path)} too — Apple lets you download it only once.`,
  );
}

/** List the APNs keys in the vault. */
function statusPushKeys(): void {
  const keys = listPushKeys();
  if (keys.length === 0) {
    log.line(
      'No APNs keys in the vault. Import one with `launch creds push-key import <path-to-.p8>`.',
    );
    return;
  }
  for (const key of keys) {
    const parts = [
      key.label && key.label !== key.keyId ? key.label : undefined,
      key.teamId ? `team ${key.teamId}` : undefined,
    ].filter((part): part is string => Boolean(part));
    log.line(`• ${key.keyId}${parts.length ? ` — ${parts.join(' · ')}` : ''}`);
  }
  log.line(`\n${keys.length} APNs key(s).`);
}

/** Export a vaulted APNs `.p8` back to disk (chmod 600), with a consent prompt and an overwrite guard. */
async function exportPushKeyCommand(
  keyIdArg: string | undefined,
  options: CredsOptions,
): Promise<void> {
  if (!keyIdArg) throw new Error('Usage: launch creds push-key export <keyId> --out <path>.');
  const record = findPushKey(keyIdArg);
  if (!record)
    throw new Error(
      `No APNs key "${keyIdArg}" in the vault. List them with \`launch creds push-key status\`.`,
    );
  const pem = await loadPushKey(record.keyId);
  if (!pem) throw new Error(`APNs key ${record.keyId} has no stored secret — re-import it.`);

  const canPrompt = options.yes !== true && process.stdin.isTTY;
  const dest =
    options.out ??
    (canPrompt
      ? await ask('Write the .p8 to', `~/AuthKey_${record.keyId}.p8`)
      : requireValue('An output path', '--out <path>'));
  const path = expandHome(dest);
  if (existsSync(path) && options.force !== true) {
    throw new Error(`${tildify(path)} already exists. Pass --force to overwrite.`);
  }
  if (canPrompt) {
    const ok = await interactiveConfirm(
      `Write the secret APNs key ${record.keyId} to ${tildify(path)}? Treat the file like a password.`,
    );
    if (!ok) {
      log.line('Left unchanged.');
      return;
    }
  }
  writeFileSync(path, pem, { mode: 0o600 });
  log.line(`Wrote APNs key ${record.keyId} to ${tildify(path)} (chmod 600). Keep it secret.`);
}

/** Attach the `creds` command to the program. */
export function registerCredsCommand(program: Command): void {
  program
    .command('creds')
    .description('inspect credentials, onboard/switch Apple accounts, or provision signing assets')
    .argument(
      '[action]',
      'status | set-key | setup | use | rename | remove | refresh | push-key',
      'status',
    )
    .argument(
      '[value]',
      'account selector / Android set-key path / push-key sub-action (import|status|export)',
    )
    .argument('[value2]', 'rename: new label · push-key: import .p8 path or export Key ID')
    .option('--platform <p>', 'ios (default), android, tvos, macos, or visionos')
    .option(
      '--key-id <id>',
      'iOS: App Store Connect Key ID (else read from the AuthKey_*.p8 filename)',
    )
    .option('--issuer-id <id>', 'iOS: Issuer ID UUID (else ASC_ISSUER_ID, else prompted)')
    .option(
      '--p8 <path>',
      'iOS: path to the .p8 (else auto-discovered in ~/Downloads, else ASC_API_KEY_PATH)',
    )
    .option(
      '--label <name>',
      'iOS set-key: human label for the account (else prompted, else the Key ID)',
    )
    .option(
      '--account <name>',
      'iOS setup: account to provision against (label or Key ID; default: active)',
    )
    .option(
      '-a, --app <name>',
      'setup: app handle to provision for (default: the only app, or prompt)',
    )
    .option(
      '--import <keystore>',
      'Android setup: import an existing upload keystore instead of generating one',
    )
    .option('--alias <alias>', 'Android setup: key alias inside the imported keystore')
    .option(
      '--team-id <id>',
      "push-key import: Apple Team ID for the APNs key (default: active account's team)",
    )
    .option('--out <path>', 'push-key export: file path to write the .p8 to')
    .option('--force', 'push-key export: overwrite the output file if it already exists')
    .option('--yes', 'non-interactive: fail instead of prompting (CI, remote, agents)')
    .action(
      async (
        action: string,
        value: string | undefined,
        value2: string | undefined,
        options: CredsOptions,
      ) => {
        const platform = parsePlatform(options.platform ?? 'ios');
        switch (action) {
          case 'status':
          case 'accounts':
            log.line(await localCredentialsProvider.status());
            return;
          case 'set-key':
            await (platform === 'android' ? setAndroidKey(value, options) : setKey(options));
            return;
          case 'setup':
            await (platform === 'android' ? setupAndroid(options) : setupIos(options, platform));
            return;
          case 'use':
            await useAccount(value, options);
            return;
          case 'rename':
            renameAccountCommand(value, value2);
            return;
          case 'remove':
          case 'logout':
            await removeAccountCommand(value, options);
            return;
          case 'refresh':
            await refreshAccounts(value);
            return;
          case 'push-key':
            await pushKeyCommand(value, value2, options);
            return;
          default:
            throw new Error(
              `Unknown action "${action}". Use status, set-key, setup, use, rename, remove, refresh, or push-key.`,
            );
        }
      },
    );
}
