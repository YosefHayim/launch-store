/**
 * `launch creds [status|set-key|setup]` — inspect or provision credentials for either platform.
 *
 * - `set-key` imports the platform's API credential. iOS: an App Store Connect API key (`.p8` + Key ID
 *   + Issuer ID), auto-discovering the `AuthKey_*.p8` in `~/Downloads`. Android (`--platform android`):
 *   a Play service-account JSON, passed as the argument (or `PLAY_SERVICE_ACCOUNT`). Both store the
 *   secret in the OS secret store and run non-interactively from flags/env (CI/agents).
 * - `setup` runs the one-time provisioning. iOS: registers the App ID and creates/reuses the
 *   distribution certificate + App Store profile. Android: generates (or imports with `--import` +
 *   `--alias`) the upload keystore, so a later `launch build` just reuses it.
 * - `status` reports what's stored for both platforms.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { cancel, isCancel, password, select, text } from "@clack/prompts";
import { loadConfig } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { interactiveConfirm, selectApp } from "../../core/pipeline.js";
import { ensureSigningCredentials } from "../../apple/credentials.js";
import { extractKeyId, findAuthKeyFiles, reconcileKeyId } from "../../apple/keyfile.js";
import { type KeystoreImport, ensureUploadKeystore, storeServiceAccount } from "../../google/credentials.js";
import { loadAscKey, localCredentialsProvider, storeAscKey } from "../../providers/credentials/local.js";

/**
 * Inputs for the `creds` subcommands, from flags and/or env. Any field left unset is inferred (Key ID
 * from the filename), discovered (the `.p8` in `~/Downloads`), or prompted for — unless `yes` forces
 * non-interactive (then a missing required value fails with the exact flag/env to set).
 */
interface CredsOptions {
  /** Which platform's credentials to act on. Defaults to `ios`. */
  platform?: string;
  /** App Store Connect Key ID; defaults to the one in the `AuthKey_<KEYID>.p8` filename. */
  keyId?: string;
  /** Issuer ID UUID; falls back to `ASC_ISSUER_ID`, then a prompt. */
  issuerId?: string;
  /** Path to the `.p8`; falls back to `ASC_API_KEY_PATH`, then auto-discovery in `~/Downloads`. */
  p8?: string;
  /** Android: path to an existing keystore to import (BYO) instead of generating a fresh one. */
  import?: string;
  /** Android: key alias inside the imported keystore. */
  alias?: string;
  /** Non-interactive: fail (with the flag/env to set) instead of prompting. For CI, remote, agents. */
  yes?: boolean;
}

/**
 * Directories scanned for an `AuthKey_*.p8` when no explicit path is given, most-likely first:
 * the browser's Downloads (Apple's "Download" button lands here), the locations Apple's own tools
 * read keys from, Launch's own credentials dir, and the project (`./private_keys`, then cwd).
 */
const SEARCH_DIRS = [
  join(homedir(), "Downloads"),
  join(homedir(), ".appstoreconnect", "private_keys"),
  join(homedir(), ".launch", "credentials"),
  join(process.cwd(), "private_keys"),
  process.cwd(),
];

/** Prompt for a required value, exiting cleanly if the user cancels. */
async function ask(message: string, placeholder?: string): Promise<string> {
  const value = await text({
    message,
    validate: (v) => (v.trim() === "" ? "Required." : undefined),
    ...(placeholder ? { placeholder } : {}),
  });
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  return value.trim();
}

/** Prompt for a required secret (masked, never trimmed), exiting cleanly if the user cancels. */
async function askSecret(message: string): Promise<string> {
  const value = await password({ message, validate: (v) => (v === "" ? "Required." : undefined) });
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  return value;
}

/** Expand a leading `~` to the home directory. */
function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

/** Collapse the home directory back to `~` for friendlier display. */
function tildify(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** Fail a non-interactive run with the exact flag/env the caller should set. */
function requireValue(label: string, how: string): never {
  throw new Error(`${label} is required. Pass ${how}, or run \`launch creds set-key\` in an interactive terminal.`);
}

/**
 * Resolve which `.p8` to import: an explicit `--p8`/`ASC_API_KEY_PATH` wins; otherwise auto-discover
 * `AuthKey_*.p8` in `~/Downloads` (and the cwd). One match is used directly; several are disambiguated
 * by a prompt (or the newest when non-interactive); none triggers a prompt (or a clear error).
 */
async function resolveP8Path(options: CredsOptions, canPrompt: boolean): Promise<string> {
  const explicit = options.p8 ?? process.env["ASC_API_KEY_PATH"];
  if (explicit) {
    const path = expandHome(explicit);
    if (!existsSync(path)) throw new Error(`No .p8 file at ${explicit}.`);
    return path;
  }

  const found = SEARCH_DIRS.flatMap(findAuthKeyFiles);
  const [first, ...rest] = found;
  if (first && rest.length === 0) {
    console.log(`Found API key ${tildify(first)}.`);
    return first;
  }
  if (first) {
    if (!canPrompt) {
      console.log(`Multiple API keys found; using ${tildify(first)}. Pass --p8 to choose another.`);
      return first;
    }
    const choice = await select({
      message: "Multiple API keys found — pick one:",
      options: found.map((path) => ({ value: path, label: tildify(path) })),
    });
    if (isCancel(choice)) {
      cancel("Cancelled.");
      process.exit(0);
    }
    // clack's `select` generics infer a weak value type; the chosen value is one of our path strings.
    return String(choice);
  }

  if (!canPrompt) requireValue("A .p8 key file", "--p8 <path> or ASC_API_KEY_PATH (none found in ~/Downloads)");
  const typed = await ask("Path to the .p8 file", "~/Downloads/AuthKey_XXXX.p8");
  const path = expandHome(typed);
  if (!existsSync(path)) throw new Error(`No .p8 file at ${typed}.`);
  return path;
}

/** Import an App Store Connect API key into the Keychain, inferring what it can and prompting for the rest. */
async function setKey(options: CredsOptions): Promise<void> {
  const canPrompt = options.yes !== true && process.stdin.isTTY;
  const p8Path = await resolveP8Path(options, canPrompt);

  const keyId =
    reconcileKeyId(options.keyId ?? process.env["ASC_KEY_ID"], extractKeyId(p8Path)) ??
    (canPrompt
      ? await ask("App Store Connect Key ID", "e.g. F5763D97BY")
      : requireValue("Key ID", "--key-id or ASC_KEY_ID"));

  const issuerId =
    options.issuerId ??
    process.env["ASC_ISSUER_ID"] ??
    (canPrompt
      ? await ask("Issuer ID", "the UUID from Users & Access → Integrations")
      : requireValue("Issuer ID", "--issuer-id or ASC_ISSUER_ID"));

  await storeAscKey(keyId, issuerId, readFileSync(p8Path, "utf8"));
  console.log(`Stored API key ${keyId} (${tildify(p8Path)}) in the Keychain.`);
}

/** Import a Play service-account JSON into the OS secret store (the Android `set-key`). */
async function setAndroidKey(value: string | undefined, options: CredsOptions): Promise<void> {
  const canPrompt = options.yes !== true && process.stdin.isTTY;
  const given =
    value ??
    process.env["PLAY_SERVICE_ACCOUNT"] ??
    (canPrompt
      ? await ask("Path to the Play service-account JSON", "~/Downloads/service-account.json")
      : requireValue("A service-account JSON path", "the path as an argument or PLAY_SERVICE_ACCOUNT"));
  const path = expandHome(given);
  if (!existsSync(path)) throw new Error(`No service-account JSON at ${given}.`);
  await storeServiceAccount(readFileSync(path, "utf8"));
  console.log(`Stored Play service account (${tildify(path)}) in the secret store.`);
}

/** Provision (or reuse) the distribution certificate + provisioning profile for an iOS app. */
async function setupIos(): Promise<void> {
  const ascKey = await loadAscKey();
  if (!ascKey) throw new Error("Import an API key first: launch creds set-key");
  const { apps } = await loadConfig();
  const app = await selectApp(apps, undefined);
  if (!app.bundleId) throw new Error(`No iOS bundle identifier for ${app.name}. Set ios.bundleIdentifier in app.json.`);
  const signing = await ensureSigningCredentials({
    bundleId: app.bundleId,
    appName: app.name,
    ascKey,
    log: createLogger(false),
    dryRun: false,
    confirmCreate: interactiveConfirm,
  });
  console.log(
    `Ready: distribution cert ${signing.certSerial}, profile ${signing.profileName} (team ${signing.teamId}).`,
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
    (canPrompt ? await ask("Key alias inside the keystore", "upload") : requireValue("--alias", "--alias <alias>"));
  const storePassword =
    process.env["ANDROID_KEYSTORE_PASSWORD"] ??
    (canPrompt
      ? await askSecret("Keystore (store) password")
      : requireValue("Keystore password", "ANDROID_KEYSTORE_PASSWORD"));
  const keyPassword = process.env["ANDROID_KEY_PASSWORD"] ?? storePassword;
  return { path, alias, storePassword, keyPassword };
}

/** Generate (or import) the upload keystore for an Android app (the Android `setup`). */
async function setupAndroid(options: CredsOptions): Promise<void> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, undefined);
  const keystoreImport = await resolveKeystoreImport(options);
  const keystore = await ensureUploadKeystore({
    appName: app.name,
    log: createLogger(false),
    dryRun: false,
    confirmCreate: interactiveConfirm,
    ...(keystoreImport ? { import: keystoreImport } : {}),
  });
  console.log(`Ready: upload keystore at ${tildify(keystore.path)} (alias ${keystore.alias}).`);
}

/** Attach the `creds` command to the program. */
export function registerCredsCommand(program: Command): void {
  program
    .command("creds")
    .description("inspect, import the API credential, or provision signing assets (iOS or Android)")
    .argument("[action]", "status | set-key | setup", "status")
    .argument("[value]", "Android set-key: path to the Play service-account JSON")
    .option("--platform <p>", "ios (default) or android")
    .option("--key-id <id>", "iOS: App Store Connect Key ID (else read from the AuthKey_*.p8 filename)")
    .option("--issuer-id <id>", "iOS: Issuer ID UUID (else ASC_ISSUER_ID, else prompted)")
    .option("--p8 <path>", "iOS: path to the .p8 (else auto-discovered in ~/Downloads, else ASC_API_KEY_PATH)")
    .option("--import <keystore>", "Android setup: import an existing upload keystore instead of generating one")
    .option("--alias <alias>", "Android setup: key alias inside the imported keystore")
    .option("--yes", "non-interactive: fail instead of prompting (CI, remote, agents)")
    .action(async (action: string, value: string | undefined, options: CredsOptions) => {
      const platform = options.platform ?? "ios";
      if (platform !== "ios" && platform !== "android") {
        throw new Error(`Unknown --platform "${platform}". Use "ios" or "android".`);
      }
      switch (action) {
        case "status":
          console.log(await localCredentialsProvider.status());
          return;
        case "set-key":
          await (platform === "android" ? setAndroidKey(value, options) : setKey(options));
          return;
        case "setup":
          await (platform === "android" ? setupAndroid(options) : setupIos());
          return;
        default:
          throw new Error(`Unknown action "${action}". Use "status", "set-key", or "setup".`);
      }
    });
}
