/**
 * `launch device add|list` — manage the devices an ad-hoc (internal) build can install on.
 *
 * Apple's only non-enterprise install-link path requires every tester device's UDID to be on the
 * ad-hoc provisioning profile. Launch registers them over the App Store Connect API (no Developer
 * portal trip, no 2FA), and `launch build ios --distribution internal` then mints a profile covering
 * every registered device. Android needs none of this — its APK installs directly.
 */

import type { Command } from "commander";
import { loadActiveAscKey } from "../../core/accounts.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";

/** Resolve the App Store Connect client for the active account, or fail with the fix. */
async function client(): Promise<AppStoreConnectClient> {
  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error("No active Apple account. Run `launch creds set-key` first.");
  return new AppStoreConnectClient(ascKey);
}

/** Attach the `device` command (with `add` / `list` subcommands) to the program. */
export function registerDeviceCommand(program: Command): void {
  const device = program.command("device").description("manage iOS devices for ad-hoc (internal) distribution");

  device
    .command("add")
    .description("register a device UDID so internal builds can install on it")
    .argument("<udid>", "the device UDID (Settings → General → About, or Xcode → Devices)")
    .argument("[name]", "a label for the device (default: the UDID)")
    .action(async (udid: string, name: string | undefined) => {
      const registered = await (await client()).registerDevice(udid, name ?? udid);
      console.log(`✓ Registered ${registered.name} (${registered.udid})`);
      console.log("• It'll be included on the next `launch build ios --distribution internal`.");
    });

  device
    .command("list")
    .description("list the devices registered for ad-hoc distribution")
    .action(async () => {
      const devices = await (await client()).listDevices();
      if (devices.length === 0) {
        console.log("No registered devices. Add one with `launch device add <udid> [name]`.");
        return;
      }
      for (const entry of devices) {
        const disabled = entry.status === "DISABLED" ? " (disabled)" : "";
        console.log(`• ${entry.name} — ${entry.udid}${disabled}`);
      }
      console.log(`\n${devices.length} device(s).`);
    });
}
