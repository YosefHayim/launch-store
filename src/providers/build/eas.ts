/**
 * The Expo EAS adapter — the ONE place Launch leans on the tool it otherwise replaces.
 *
 * For developers with no Mac and no AWS, Launch orchestrates `eas-cli` end-to-end (decision 11): it
 * detects the CLI, ensures an Expo session, drives `eas build --json` (Expo's cloud does the macOS
 * work), downloads the resulting `.ipa`, and can run `eas submit`. All Expo coupling is contained here
 * so that when Expo's frequently-changing CLI output drifts, it's one file to fix — and we fail loudly
 * with actionable guidance rather than silently producing nothing. `eas-cli` is NEVER bundled.
 */

import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedBuildContext, SizeReport, SubmitTarget } from "../../core/types.js";
import { capture, exists, run } from "../../core/exec.js";

/** Where the `eas` binary comes from: the global install if present, else `npx eas-cli`. */
async function easCommand(): Promise<{ cmd: string; prefix: string[] }> {
  if (await exists("eas")) return { cmd: "eas", prefix: [] };
  return { cmd: "npx", prefix: ["--yes", "eas-cli"] };
}

/** Human label of how `eas` will be invoked, for the run header. Also surfaces a missing toolchain early. */
export async function detectEasCli(): Promise<string> {
  const { cmd } = await easCommand();
  return cmd === "eas" ? "eas (global install)" : "npx eas-cli (not globally installed)";
}

/** Ensure an Expo login, prompting `eas login` interactively if needed. Launch stores no Expo credentials. */
export async function ensureExpoSession(): Promise<string> {
  const { cmd, prefix } = await easCommand();
  try {
    return await capture(cmd, [...prefix, "whoami"]);
  } catch {
    await run(cmd, [...prefix, "login"]);
    return capture(cmd, [...prefix, "whoami"]);
  }
}

/** The slice of an `eas build --json` entry Launch reads. */
interface EasBuildEntry {
  artifacts?: { applicationArchiveUrl?: string; buildUrl?: string };
  appBuildVersion?: string | number;
  buildNumber?: string | number;
}

/** Extract the downloadable artifact URL from `eas build --json` output (tolerant of leading log lines). */
export function parseArtifactUrl(jsonText: string): string | null {
  const entry = firstBuildEntry(jsonText);
  return entry?.artifacts?.applicationArchiveUrl ?? entry?.artifacts?.buildUrl ?? null;
}

/** Best-effort build number from `eas build --json` (EAS manages it); 0 when not reported. */
export function parseBuildNumber(jsonText: string): number {
  const entry = firstBuildEntry(jsonText);
  const raw = entry?.appBuildVersion ?? entry?.buildNumber;
  const parsed = typeof raw === "number" ? raw : raw ? Number.parseInt(raw, 10) : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Parse the first build object out of `eas build --json` (an array, possibly after progress log lines). */
function firstBuildEntry(jsonText: string): EasBuildEntry | null {
  const start = jsonText.indexOf("[");
  const end = jsonText.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const builds = JSON.parse(jsonText.slice(start, end + 1)) as EasBuildEntry[];
    return builds[0] ?? null;
  } catch {
    return null;
  }
}

/** Run an EAS cloud build for iOS and download the `.ipa` locally. No per-device thinning report is available. */
export async function easBuildToIpa(
  ctx: ResolvedBuildContext,
  profileName: string,
): Promise<{ ipaPath: string; sizeReport: SizeReport; buildNumber: number }> {
  const { cmd, prefix } = await easCommand();
  const json = await capture(
    cmd,
    [...prefix, "build", "--platform", "ios", "--profile", profileName, "--non-interactive", "--json", "--wait"],
    { cwd: ctx.app.dir, env: ctx.env },
  );
  const url = parseArtifactUrl(json);
  if (!url) {
    throw new Error(
      "No artifact URL in `eas build --json` output — Expo's CLI shape may have changed (see providers/build/eas.ts).",
    );
  }
  const ipaPath = join(mkdtempSync(join(tmpdir(), "launch-eas-")), `${ctx.app.name}.ipa`);
  await downloadFile(url, ipaPath);
  return {
    ipaPath,
    sizeReport: { ipaBytes: statSync(ipaPath).size, entries: [] },
    buildNumber: parseBuildNumber(json),
  };
}

/** Submit an already-built `.ipa` to App Store Connect via `eas submit`. */
export async function easSubmit(ctx: ResolvedBuildContext, ipaPath: string, profileName: string): Promise<void> {
  const { cmd, prefix } = await easCommand();
  await run(
    cmd,
    [...prefix, "submit", "--platform", "ios", "--path", ipaPath, "--profile", profileName, "--non-interactive"],
    {
      cwd: ctx.app.dir,
    },
  );
}

/** Download a URL to a local file. */
async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}) for the EAS artifact.`);
  writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

/** `--target` is accepted for parity with the local submitter; EAS routes to TestFlight/Store via its own config. */
export type EasSubmitTarget = SubmitTarget;
