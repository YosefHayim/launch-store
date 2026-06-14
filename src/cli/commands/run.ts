/**
 * `launch run [id|latest]` — install a previously-built artifact on a connected device (EAS
 * `build:run` parity).
 *
 * It takes a build from the local history (the newest by default, or one named by id) and installs it:
 * an Android `.apk` straight over `adb`, an `.aab` via `bundletool` (build the universal APKs, then
 * install them), and an iOS `.ipa` by unpacking its `Payload/*.app` and handing it to `xcrun
 * devicectl`. Launch's iOS artifacts are signed DEVICE archives (a simulator can't run them), so iOS
 * install targets a real, connected device. The command builds, signs, and uploads nothing — it only
 * installs what `launch build` already produced.
 */

import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import type { BuildArtifact } from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { resolveStorageProvider } from "../../core/storage.js";
import { run } from "../../core/exec.js";
import { findBuild } from "./builds.js";

/** `adb install` args, scoped to a specific device serial when given. `-r` reinstalls over an existing copy. */
export function adbInstallArgs(apkPath: string, serial?: string): string[] {
  return [...(serial ? ["-s", serial] : []), "install", "-r", apkPath];
}

/** `bundletool build-apks` args producing a single universal APK set, overwriting any previous output. */
export function bundletoolBuildApksArgs(aabPath: string, apksPath: string): string[] {
  return ["build-apks", `--bundle=${aabPath}`, `--output=${apksPath}`, "--mode=universal", "--overwrite"];
}

/** `bundletool install-apks` args, scoped to a device serial when given. */
export function bundletoolInstallApksArgs(apksPath: string, serial?: string): string[] {
  return ["install-apks", `--apks=${apksPath}`, ...(serial ? [`--device-id=${serial}`] : [])];
}

/** `xcrun devicectl` args to install a `.app` on a connected device (targeting `--device` when given). */
export function devicectlInstallArgs(appPath: string, device?: string): string[] {
  return ["devicectl", "device", "install", "app", ...(device ? ["--device", device] : []), appPath];
}

/** Install an Android artifact: `.apk` directly over adb, `.aab` via a bundletool universal APK set. */
async function installAndroid(artifactPath: string, serial?: string): Promise<void> {
  if (artifactPath.endsWith(".apk")) {
    await run("adb", adbInstallArgs(artifactPath, serial));
    return;
  }
  const work = mkdtempSync(join(tmpdir(), "launch-run-"));
  const apksPath = join(work, "app.apks");
  await run("bundletool", bundletoolBuildApksArgs(artifactPath, apksPath));
  await run("bundletool", bundletoolInstallApksArgs(apksPath, serial));
}

/** Install an iOS `.ipa`: unpack its `Payload/<App>.app`, then install on a connected device via devicectl. */
async function installIos(artifactPath: string, device?: string): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "launch-run-"));
  await run("unzip", ["-oq", artifactPath, "-d", work]);
  const payload = join(work, "Payload");
  const appBundle = existsSync(payload) ? readdirSync(payload).find((entry) => entry.endsWith(".app")) : undefined;
  if (!appBundle) throw new Error(`No .app inside ${artifactPath} (expected Payload/<App>.app).`);
  if (!device) {
    console.log("• No --device given; devicectl will use the connected device (or error if there are several).");
  }
  await run("xcrun", devicectlInstallArgs(join(payload, appBundle), device));
}

/** Attach the `run` command to the program. */
export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("install a built artifact on a connected device (iOS device or Android device/emulator)")
    .argument("[id|latest]", "a build id from `launch builds list`, a build number, or `latest`", "latest")
    .option("-d, --device <id>", "target device: an Android serial (adb) or an iOS device id (devicectl)")
    .action(async (ref: string, options: { device?: string }) => {
      const { config } = await loadConfig();
      const builds = await resolveStorageProvider(config).list();
      const artifact: BuildArtifact | undefined = findBuild(builds, ref);
      if (!artifact) {
        throw new Error(`No build matches "${ref}". Run \`launch builds list\` to see what's available.`);
      }
      if (!existsSync(artifact.path)) {
        throw new Error(`The artifact for "${ref}" is gone from ${artifact.path}. Rebuild with \`launch build\`.`);
      }

      console.log(`Installing ${artifact.appName} ${artifact.version} (build ${artifact.buildNumber})…`);
      if (artifact.platform === "android") {
        await installAndroid(artifact.path, options.device);
      } else {
        await installIos(artifact.path, options.device);
      }
      console.log("✓ Installed. Launch it from the device's home screen.");
    });
}
