/**
 * The `fastlane` build engine — v1's iOS compile/sign/export path.
 *
 * Drives fastlane `gym` to archive and export a signed `.ipa` using MANUAL signing with the exact
 * distribution certificate + provisioning profile Launch resolved (so there's no surprise about
 * which identity signs the build). It exports with app thinning so Xcode emits the App Thinning
 * Size Report — the source of the per-device download/install numbers Launch shows before any upload.
 * Implements {@link BuildEngine}; a raw-`xcodebuild` engine could replace it behind the same call.
 */

import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AppleCredentials,
  BuildEngine,
  ResolvedBuildContext,
  SigningAssets,
  SizeReport,
  SizeReportEntry,
} from "../../core/types.js";
import { run } from "../../core/exec.js";

/** Locate the generated Xcode workspace and derive its scheme from the `ios/` directory. */
function findWorkspace(iosDir: string): { workspace: string; scheme: string } {
  if (!existsSync(iosDir)) throw new Error(`No ios/ directory at ${iosDir} — did prebuild run?`);
  const workspace = readdirSync(iosDir).find((entry) => entry.endsWith(".xcworkspace"));
  if (!workspace) throw new Error(`No .xcworkspace found in ${iosDir}.`);
  return { workspace: join(iosDir, workspace), scheme: workspace.replace(/\.xcworkspace$/, "") };
}

/** Convert a size like `46.1` + `MB` into bytes. */
function toBytes(value: number, unit: string): number {
  const scale: Record<string, number> = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Math.round(value * (scale[unit.toUpperCase()] ?? 1));
}

/**
 * Parse Xcode's "App Thinning Size Report.txt" into per-device entries. The report lists each
 * device variant followed by a size line giving compressed (≈ download) and uncompressed (≈ install)
 * sizes. Unrecognized lines are ignored, so a format drift degrades to fewer entries, not a crash.
 */
export function parseThinningReport(text: string): SizeReportEntry[] {
  const entries: SizeReportEntry[] = [];
  const blocks = text.split(/Variant:/).slice(1);
  for (const block of blocks) {
    const device = /(iPhone[\d,]+|iPad[\d,]+|Universal)/.exec(block)?.[1] ?? "Universal";
    const size = /App size:\s*([\d.]+)\s*(KB|MB|GB)\s*compressed,\s*([\d.]+)\s*(KB|MB|GB)\s*uncompressed/i.exec(block);
    if (!size) continue;
    const [, downloadValue, downloadUnit, installValue, installUnit] = size;
    if (!downloadValue || !downloadUnit || !installValue || !installUnit) continue;
    entries.push({
      device,
      downloadBytes: toBytes(Number.parseFloat(downloadValue), downloadUnit),
      installBytes: toBytes(Number.parseFloat(installValue), installUnit),
    });
  }
  return entries;
}

/** Build the export-options plist for manual App Store signing with the resolved profile + cert. */
export function exportOptionsPlist(signing: SigningAssets): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    "<key>method</key><string>app-store</string>",
    "<key>signingStyle</key><string>manual</string>",
    `<key>teamID</key><string>${signing.teamId}</string>`,
    `<key>signingCertificate</key><string>${signing.certName}</string>`,
    "<key>provisioningProfiles</key><dict>",
    `<key>${signing.bundleId}</key><string>${signing.profileName}</string>`,
    "</dict>",
    "<key>thinning</key><string>&lt;thin-for-all-variants&gt;</string>",
    "</dict></plist>",
  ].join("\n");
}

export const fastlaneBuildEngine: BuildEngine = {
  name: "fastlane",

  async build(
    ctx: ResolvedBuildContext,
    creds: AppleCredentials,
  ): Promise<{ artifactPath: string; sizeReport: SizeReport }> {
    if (ctx.dryRun) {
      return { artifactPath: "(dry-run, not built)", sizeReport: { ipaBytes: 0, entries: [] } };
    }
    const signing = creds.signing;
    if (!signing) throw new Error("No signing assets resolved — run `launch creds setup` first.");

    const iosDir = join(ctx.app.dir, "ios");
    const { workspace, scheme } = findWorkspace(iosDir);
    const outputDir = mkdtempSync(join(tmpdir(), "launch-build-"));
    const plistPath = join(outputDir, "ExportOptions.plist");
    writeFileSync(plistPath, exportOptionsPlist(signing));

    await run(
      "fastlane",
      [
        "gym",
        "--workspace",
        workspace,
        "--scheme",
        scheme,
        "--output_directory",
        outputDir,
        "--output_name",
        `${ctx.app.name}.ipa`,
        "--export_options",
        plistPath,
        "--codesigning_identity",
        signing.certName,
        // Force manual signing during the archive step with the resolved team + profile.
        "--xcargs",
        `DEVELOPMENT_TEAM=${signing.teamId} CODE_SIGN_STYLE=Manual PROVISIONING_PROFILE_SPECIFIER=${signing.profileName}`,
        "--clean",
      ],
      // The API key lets gym's signing/upload helpers talk to Apple without a 2FA prompt.
      {
        cwd: ctx.app.dir,
        env: {
          APP_STORE_CONNECT_API_KEY_KEY_ID: creds.ascKey.keyId,
          APP_STORE_CONNECT_API_KEY_ISSUER_ID: creds.ascKey.issuerId,
        },
      },
    );

    const ipa = readdirSync(outputDir).find((entry) => entry.endsWith(".ipa"));
    if (!ipa) throw new Error(`gym finished but produced no .ipa in ${outputDir}.`);
    const artifactPath = join(outputDir, ipa);

    const reportPath = join(outputDir, "App Thinning Size Report.txt");
    const entries = existsSync(reportPath) ? parseThinningReport(readFileSync(reportPath, "utf8")) : [];
    return { artifactPath, sizeReport: { ipaBytes: statSync(artifactPath).size, entries } };
  },
};
