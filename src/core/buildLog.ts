/**
 * Per-build native log persistence — the backbone of local build observability (`launch builds log`).
 *
 * EAS build logs live in the cloud, expire, and are missing exactly when you need them. Launch builds
 * locally, so the log is right here: while a build runs, `core/progress.ts` routes the native tool
 * output (xcodebuild / Gradle) into a single per-build file keyed by the build's natural id, redacting
 * secrets on the way to disk (`core/redact.ts`). The file outlives the run with no queue and no expiry,
 * so `launch builds log <id>` can print it and the failure diagnostics can re-scan it.
 *
 * The "active build log" is process-wide state, mirroring `progress.ts`'s `--verbose` toggle: the
 * pipeline calls {@link beginBuildLog} once the build id is known (build number resolved) and
 * {@link endBuildLog} when the build engine returns, and `progress.ts` reads {@link currentBuildLog}
 * to decide where to tee. Capture covers the compile/sign/export step — the part that's large and
 * fails — not the earlier prebuild (whose id isn't known yet); those steps keep their own stamped logs.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Platform } from "./types.js";
import { LOGS_DIR, ensureDir } from "./paths.js";
import { redactText } from "./redact.js";

/**
 * The natural-key parts that identify a build independently of where its artifact is stored. A
 * {@link import("./types.js").BuildArtifact} satisfies this shape, so the index and the log agree on
 * one id without the artifact record carrying a log path.
 */
export interface BuildLogKey {
  appName: string;
  version: string;
  buildNumber: number;
  platform: Platform;
}

/** Stable id for a build from its natural keys — the value `builds list` and `builds log` match on. */
export function buildLogId(key: BuildLogKey): string {
  return `${key.appName}-${key.version}-${key.buildNumber}-${key.platform}`;
}

/** Absolute path to a build's persisted, redacted native log (`~/.launch/logs/<id>.log`). */
export function buildLogPath(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "-");
  return join(LOGS_DIR, `${safe}.log`);
}

/**
 * Read a build's persisted log back, redacted a second time on the way out (defense in depth over the
 * scrub already done on write — this pass also catches multi-line PEM blocks). Null when none was
 * captured (e.g. the build ran in CI/stream mode, or predates this feature).
 */
export function readBuildLog(id: string): string | null {
  const path = buildLogPath(id);
  if (!existsSync(path)) return null;
  return redactText(readFileSync(path, "utf8"));
}

/** Process-wide handle to the log the in-progress build's tool output is being tee'd into. */
let activeBuildLog: string | null = null;

/**
 * Begin capturing native tool output for `id` into its per-build log, truncating any prior log for the
 * same id so a rebuild starts clean. Returns the path. Paired with {@link endBuildLog} in a finally.
 */
export function beginBuildLog(id: string): string {
  ensureDir(LOGS_DIR);
  const path = buildLogPath(id);
  writeFileSync(path, "");
  activeBuildLog = path;
  return path;
}

/** Stop routing tool output to a per-build log (the build engine has returned, success or failure). */
export function endBuildLog(): void {
  activeBuildLog = null;
}

/** The active per-build log file, or null when no build is capturing. Read by `core/progress.ts`. */
export function currentBuildLog(): string | null {
  return activeBuildLog;
}
