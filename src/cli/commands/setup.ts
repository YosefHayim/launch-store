/**
 * `launch setup ios` — a provisioning report for an iOS app: the active Apple account, whether the
 * App ID (bundle id) is registered, the capabilities enabled on it, the cached distribution
 * certificate + App Store profile, and the devices registered for ad-hoc builds. One place to answer
 * "is this app ready to sign, and with what?" before a build.
 *
 * It complements `launch creds setup` (which *provisions* the cert + profile): by default this command
 * only inspects and reports. Pass `--provision` to additionally ensure the signing assets — it
 * delegates to the same {@link ensureSigningCredentials} `creds setup` uses, so the provisioning logic
 * has no second copy here. `--json` emits the report for agents and scripts.
 *
 * Several of these reads are role-gated on the App Store Connect API key: a key whose role can't read a
 * resource gets a 403, which {@link withRole} turns into an actionable message naming the missing
 * access instead of a bare status code.
 */

import type { Command } from "commander";
import type { AscKey } from "../../core/types.js";
import { getActiveAccount, listAccounts, loadAscKeyById, matchAccount } from "../../core/accounts.js";
import { loadConfig } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { type SetupOptions, runSetup } from "../../core/setup.js";
import { parsePlatform } from "../../core/platform.js";
import { interactiveConfirm, selectApp } from "../../core/pipeline.js";
import { AppStoreConnectClient, AscRequestError } from "../../apple/ascClient.js";
import {
  describeStoredCredentials,
  ensureSigningCredentials,
  loadCachedSigningAssets,
} from "../../apple/credentials.js";

/** Flags accepted by `launch setup ios`. */
interface SetupIosOptions {
  /** Apple account to inspect (label or Key ID); defaults to the active account. */
  account?: string;
  /** Which app to inspect (by `name`) instead of prompting when the project defines several. */
  app?: string;
  /** Also ensure the distribution cert + App Store profile exist (delegates to `creds setup`'s logic). */
  provision?: boolean;
  /** Emit the report as JSON for agents/scripts. */
  json?: boolean;
  /** Non-interactive: auto-confirm Apple resource creation under `--provision` (for CI/agents). */
  yes?: boolean;
}

/** A device registered for ad-hoc (internal) distribution, as shown in the report. */
interface DeviceLine {
  name: string;
  udid: string;
  disabled: boolean;
}

/** One embedded app-extension target and whether its App Store profile is already cached locally. */
interface ExtensionLine {
  bundleId: string;
  provisioned: boolean;
}

/**
 * The full provisioning picture for one app under one Apple account — the shape emitted by `--json`
 * and rendered by {@link formatReport}. The certificate + profile come from Launch's local credential
 * cache (no network); `bundleIdRegistered`, `capabilities`, and `devices` are read live from App Store
 * Connect (and so are subject to the key's role — see {@link withRole}).
 */
export interface ProvisioningReport {
  account: { label: string; keyId: string; teamId: string | null };
  app: { name: string; bundleId: string };
  /** Whether the App ID exists in the Apple account — a build can't be signed until it does. */
  bundleIdRegistered: boolean;
  /** Apple capability types enabled on the App ID (e.g. `PUSH_NOTIFICATIONS`), sorted. */
  capabilities: string[];
  /** Cached distribution-certificate serial, or null when none is provisioned yet. */
  certificateSerial: string | null;
  /** Cached App Store provisioning-profile name, or null when none is provisioned yet. */
  profileName: string | null;
  /**
   * Embedded app-extension targets declared in config (`ios.extensions`), each with whether its own
   * App Store profile is already cached. Empty for an app with no extensions. Every entry must be
   * provisioned before a build can export, since one missing profile fails `xcodebuild` (exit 65).
   */
  extensions: ExtensionLine[];
  /** Devices registered for ad-hoc (internal) distribution. */
  devices: DeviceLine[];
}

/** Build the actionable message for a role-gated 403 on a given App Store Connect feature. */
export function roleErrorMessage(feature: string): string {
  return `Your App Store Connect API key's role can't read ${feature} (Apple returned 403). Grant the key a role with that access in Users & Access → Integrations, or use a key that has it.`;
}

/**
 * Run a role-gated App Store Connect read, turning a 403 into an actionable {@link roleErrorMessage}
 * that names the inaccessible `feature`. Any other error propagates unchanged.
 */
async function withRole<T>(feature: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AscRequestError && error.status === 403) throw new Error(roleErrorMessage(feature));
    throw error;
  }
}

/** Render the report as the human-readable summary printed when `--json` is off. */
export function formatReport(report: ProvisioningReport): string {
  const team = report.account.teamId ? `, team ${report.account.teamId}` : "";
  const lines = [
    `iOS provisioning — ${report.app.name} (${report.app.bundleId})`,
    `  account:      ${report.account.label} (key ${report.account.keyId}${team})`,
    `  App ID:       ${report.bundleIdRegistered ? "registered" : "NOT registered — run 'launch setup ios --provision'"}`,
    `  capabilities: ${report.capabilities.length ? report.capabilities.join(", ") : "none enabled"}`,
    `  certificate:  ${report.certificateSerial ?? "none cached — run 'launch creds setup'"}`,
    `  profile:      ${report.profileName ?? "none cached — run 'launch creds setup'"}`,
  ];
  if (report.extensions.length) {
    lines.push(`  extensions:   ${report.extensions.length} declared`);
    for (const extension of report.extensions) {
      const status = extension.provisioned ? "profile cached" : "not provisioned — run 'launch setup ios --provision'";
      lines.push(`                  • ${extension.bundleId} — ${status}`);
    }
  }
  lines.push(
    `  devices:      ${report.devices.length ? `${report.devices.length} registered` : "none (add with 'launch device add <udid>')"}`,
  );
  for (const device of report.devices) {
    lines.push(`                  • ${device.name} — ${device.udid}${device.disabled ? " (disabled)" : ""}`);
  }
  return lines.join("\n");
}

/** A resolved Apple account plus its decrypted key — what {@link reportSetupIos} works against. */
interface ResolvedAccount {
  label: string;
  keyId: string;
  teamId: string | null;
  ascKey: AscKey;
}

/** Resolve the Apple account to inspect (explicit `--account`, else active), with an actionable error. */
async function resolveAccountKey(options: SetupIosOptions): Promise<ResolvedAccount> {
  const account = options.account ? matchAccount(listAccounts(), options.account) : getActiveAccount();
  if (!account) {
    throw new Error(
      options.account
        ? `No Apple account matching "${options.account}". See \`launch creds status\`.`
        : "No active Apple account. Import one: launch creds set-key",
    );
  }
  const ascKey = await loadAscKeyById(account.keyId);
  if (!ascKey) throw new Error(`Account "${account.label}" has no stored key. Re-import: launch creds set-key`);
  return { label: account.label, keyId: account.keyId, teamId: account.teamId ?? null, ascKey };
}

/** Gather and print the iOS provisioning report — the body of `launch setup ios`. */
async function reportSetupIos(options: SetupIosOptions): Promise<void> {
  const account = await resolveAccountKey(options);
  const { apps } = await loadConfig();
  const app = await selectApp(apps, options.app);
  const bundleId = app.bundleId;
  if (!bundleId) throw new Error(`No iOS bundle identifier for ${app.name}. Set ios.bundleIdentifier in app.json.`);

  const client = new AppStoreConnectClient(account.ascKey);

  if (options.provision) {
    await ensureSigningCredentials({
      platform: "ios",
      bundleId,
      appName: app.name,
      ascKey: account.ascKey,
      log: createLogger(false),
      dryRun: false,
      confirmCreate: options.yes === true ? () => Promise.resolve(true) : interactiveConfirm,
      extensions: app.iosExtensions ?? [],
    });
  }

  const bundle = await withRole("App IDs", () => client.findBundleId(bundleId));
  const capabilities = bundle
    ? (await withRole("App ID capabilities", () => client.listBundleIdCapabilities(bundle.id)))
        .map((capability) => capability.capabilityType)
        .sort((a, b) => a.localeCompare(b))
    : [];
  const devices = await withRole("registered devices", () => client.listDevices());
  const signing = loadCachedSigningAssets(account.keyId, bundleId);
  const cachedBundleIds = new Set(describeStoredCredentials(account.keyId).bundleIds);

  const report: ProvisioningReport = {
    account: { label: account.label, keyId: account.keyId, teamId: account.teamId },
    app: { name: app.name, bundleId },
    bundleIdRegistered: bundle !== null,
    capabilities,
    certificateSerial: signing?.certSerial ?? null,
    profileName: signing?.profileName ?? null,
    extensions: (app.iosExtensions ?? []).map((extensionBundleId) => ({
      bundleId: extensionBundleId,
      provisioned: cachedBundleIds.has(extensionBundleId),
    })),
    devices: devices.map((device) => ({
      name: device.name,
      udid: device.udid,
      disabled: device.status === "DISABLED",
    })),
  };

  console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
}

/** Flags accepted by the bare `launch setup` auto-setup action (the parent command). */
interface SetupCommandOptions {
  /** Which platform to get ready (`--platform`); defaults to iOS. */
  platform?: string;
  /** Skip prompts and install missing tools (`--yes`) — for CI/agents. */
  yes?: boolean;
  /** Run the dry-run rehearsal at the end; `--no-rehearse` sets this false. */
  rehearse?: boolean;
}

/** Validate the platform flag and normalize the command flags into {@link SetupOptions}. */
function toSetupOptions(options: SetupCommandOptions): SetupOptions {
  return {
    platform: parsePlatform(options.platform ?? "ios"),
    yes: options.yes === true,
    rehearse: options.rehearse !== false,
  };
}

/**
 * Attach the `setup` command to the program. Bare `launch setup` runs the hands-off auto-setup
 * ({@link runSetup}: scaffold, install tools, verify, rehearse); `launch setup ios` is the detailed
 * iOS provisioning report below.
 */
export function registerSetupCommand(program: Command): void {
  const setup = program
    .command("setup")
    .description("set Launch up automatically and verify everything's ready to ship")
    .option("--platform <p>", "ios (default), android, tvos, macos, or visionos")
    .option("--yes", "non-interactive: install missing tools without asking (CI/agents)", false)
    .option("--no-rehearse", "skip the dry-run pipeline rehearsal at the end")
    .action((options: SetupCommandOptions) => runSetup(toSetupOptions(options)));
  setup
    .command("ios")
    .description("report iOS signing & provisioning status (account, App ID, capabilities, cert, profile, devices)")
    .option("--account <name>", "Apple account to inspect (label or Key ID; default: active)")
    .option("-a, --app <name>", "which app to inspect (default: the only app, or prompt)")
    .option("--provision", "also ensure the distribution cert + App Store profile (like 'launch creds setup')", false)
    .option("--json", "emit the report as JSON (for agents/scripts)", false)
    .option("--yes", "non-interactive: auto-confirm Apple resource creation under --provision", false)
    .action((options: SetupIosOptions) => reportSetupIos(options));
}
