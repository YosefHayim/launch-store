/**
 * macOS build-toolchain detection and consented auto-install.
 *
 * `launch doctor` historically only *reported* missing tools; this turns it into an interactive
 * installer: detect what an iOS build needs, ask for one consent, install the brew-able tools as a
 * set, then re-verify. The same {@link ensureToolchain} is the function the first-run wizard calls,
 * so detection/install logic lives in exactly one place (DRY).
 *
 * Design choices:
 * - **One consent, whole set.** A fresh Mac is missing several tools at once; ten yes/no prompts is
 *   hostile. We list everything and ask once (`--yes` skips for CI/agents).
 * - **Homebrew is special.** It's the installer for the rest, and its own installer pipes a remote
 *   script to bash + may need `sudo`. We never run that silently — it's gated behind a typed-`yes`.
 * - **Xcode is guided, not silent.** The full Xcode is a multi-GB App Store install and can't be
 *   `brew install`ed; we print the exact step instead of pretending to automate it.
 * - **Injectable IO.** All side effects (PATH probing, shelling out, prompting) go through
 *   {@link ToolchainIo} so the orchestration is unit-testable with no real installs.
 */

import { confirm as clackConfirm, isCancel, text } from "@clack/prompts";
import { exists, run } from "./exec.js";
import { isMac } from "./os.js";

/**
 * A tool a local iOS build needs, and how to install it on macOS.
 * - `brew`: installable non-interactively via `brew install <formula>`.
 * - `guide`: can't be cleanly automated (Xcode); we print the guide text for the user instead.
 */
export interface Tool {
  /** Human label shown in doctor output, e.g. `CocoaPods (pod)`. */
  label: string;
  /** Executable probed on `PATH` to decide if the tool is present. */
  command: string;
  /**
   * Whether the build *needs* this tool or merely *benefits* from it. A missing `required` tool fails
   * the doctor (exit 1) and blocks a build; a missing `recommended` tool (ccache) only warns — the
   * build still runs, just uncached. The split is what lets ccache ship on-by-default without becoming
   * a hard dependency on machines that don't have it yet.
   */
  tier: "required" | "recommended";
  /** How to obtain it when missing. */
  install: { kind: "brew"; formula: string } | { kind: "guide"; how: string };
}

/**
 * The canonical toolchain an iOS build needs. Single source of truth — `doctor` renders this list
 * and {@link ensureToolchain} installs from it, so the two never drift.
 */
export const REQUIRED_TOOLS: Tool[] = [
  {
    label: "Xcode (xcodebuild)",
    command: "xcodebuild",
    tier: "required",
    install: {
      kind: "guide",
      how: "Install Xcode from the App Store, then run `xcode-select --install` for the Command Line Tools.",
    },
  },
  { label: "Ruby", command: "ruby", tier: "required", install: { kind: "brew", formula: "ruby" } },
  { label: "fastlane", command: "fastlane", tier: "required", install: { kind: "brew", formula: "fastlane" } },
  { label: "CocoaPods (pod)", command: "pod", tier: "required", install: { kind: "brew", formula: "cocoapods" } },
  { label: "openssl", command: "openssl", tier: "required", install: { kind: "brew", formula: "openssl" } },
  { label: "Node", command: "node", tier: "required", install: { kind: "brew", formula: "node" } },
  // Recommended, not required: makes a clean build 50–70% cheaper; absent → uncached, never a hard fail.
  { label: "ccache", command: "ccache", tier: "recommended", install: { kind: "brew", formula: "ccache" } },
];

/**
 * The toolchain an Android build needs — the executables `launch doctor --platform android` probes.
 * Unlike iOS, none of these are macOS-only (Android builds anywhere), and Xcode has no analog: the
 * JDK supplies `keytool`, gradle runs via the project's own wrapper (checked separately, not here),
 * `bundletool` estimates the download, and `fastlane` does the upload. `ANDROID_HOME` (the SDK) is an
 * env var, also checked separately in `doctor`.
 */
export const ANDROID_TOOLS: Tool[] = [
  { label: "JDK (keytool)", command: "keytool", tier: "required", install: { kind: "brew", formula: "openjdk" } },
  { label: "fastlane", command: "fastlane", tier: "required", install: { kind: "brew", formula: "fastlane" } },
  { label: "bundletool", command: "bundletool", tier: "required", install: { kind: "brew", formula: "bundletool" } },
  { label: "Node", command: "node", tier: "required", install: { kind: "brew", formula: "node" } },
];

/** The official Homebrew installer one-liner, run verbatim under `bash -c` so its `$(curl …)` substitution and `/dev/tty` prompts work. */
const HOMEBREW_INSTALL_COMMAND =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

/** The single-line, actionable fix for a missing tool — `brew install …` or the guide text. */
export function fixHint(tool: Tool): string {
  return tool.install.kind === "brew" ? `brew install ${tool.install.formula}` : tool.install.how;
}

/**
 * Split missing tools into the ones we can `brew install` as a batch and the ones we can only guide.
 * Pure, so the planning is unit-testable without touching the system.
 */
export function planInstall(missing: Tool[]): { brew: Tool[]; guided: Tool[] } {
  return {
    brew: missing.filter((tool) => tool.install.kind === "brew"),
    guided: missing.filter((tool) => tool.install.kind === "guide"),
  };
}

/**
 * The *required* iOS build tools currently absent from `PATH` — the signal for whether a Homebrew install
 * is even relevant. Recommended tools (ccache) are excluded: their absence only slows a build, it isn't a
 * gap worth an install prompt. Unlike `runDoctor`'s overall pass/fail this ignores non-tool preflight state
 * (a missing App Store Connect record, an unsigned agreement) that Homebrew can't fix, so the wizard can
 * offer the install only when it would actually do something (issue #117). Probes through the injectable
 * {@link ToolchainIo.exists}, so it's unit-testable with no real PATH lookups.
 */
export async function missingRequiredTools(io: Pick<ToolchainIo, "exists"> = { exists }): Promise<Tool[]> {
  const missing = await detectMissing(io, REQUIRED_TOOLS);
  return missing.filter((tool) => tool.tier === "required");
}

/**
 * Generate the bash toolchain preflight that runs ON the remote Mac before a build — the remote twin of
 * `launch doctor`, emitted from {@link REQUIRED_TOOLS} so the host and local checks never drift (issue #6).
 *
 * `mode` reflects who owns the host:
 * - `"install"` — the AWS EC2 Mac is ours, so a missing brew-able required tool is installed (and the
 *   recommended ccache best-effort), then re-checked; only an un-installable miss (Xcode) or a failed
 *   install fails the preflight.
 * - `"assert"` — a BYO-SSH host is the user's machine, so nothing is mutated: a missing required tool
 *   fails with the same `brew install …` hint `launch doctor` prints; a missing ccache only warns.
 *
 * Prints `LAUNCH_PREFLIGHT_OK` on success; on a missing required tool it lists each gap and exits
 * non-zero, so the SSH step fails fast with an actionable message instead of a cryptic mid-build error.
 */
export function remoteToolchainPreflight(mode: "install" | "assert"): string {
  const canInstall = mode === "install";
  // Single-quote any message embedded in `echo` so backticks in a hint (e.g. Xcode's) stay literal.
  const q = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`;
  const lines: string[] = ["set -uo pipefail", "MISSING=0"];
  if (canInstall) {
    // Put Homebrew on PATH in a non-interactive SSH shell before any install attempt.
    lines.push(
      `eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null || true)"`,
    );
  }
  for (const tool of REQUIRED_TOOLS) {
    const present = `command -v ${tool.command} >/dev/null 2>&1`;
    if (canInstall && tool.install.kind === "brew") {
      lines.push(
        `${present} || { echo ${q(`→ installing ${tool.label}`)}; brew install ${tool.install.formula} || true; }`,
      );
    }
    if (tool.tier === "required") {
      lines.push(`${present} || { echo ${q(`✗ ${tool.label} missing — ${fixHint(tool)}`)}; MISSING=1; }`);
    } else {
      lines.push(`${present} || echo ${q(`• ${tool.label} (recommended) — ${fixHint(tool)}`)}`);
    }
  }
  lines.push(`if [ "$MISSING" = 1 ]; then echo LAUNCH_PREFLIGHT_FAILED; exit 1; fi`);
  lines.push("echo LAUNCH_PREFLIGHT_OK");
  return lines.join("\n");
}

/**
 * Side-effecting operations {@link ensureToolchain} needs, injected so tests can supply fakes.
 * Production wiring ({@link realIo}) maps these onto the repo's exec helpers, clack prompts, and console.
 */
export interface ToolchainIo {
  /** Whether `command` is on `PATH`. */
  exists(command: string): Promise<boolean>;
  /** Run a command, streaming output (installs are long and chatty). */
  run(command: string, args: string[]): Promise<void>;
  /** A yes/no consent prompt; returns false on cancel. */
  confirm(message: string): Promise<boolean>;
  /** A higher-friction prompt requiring the user to type `expected` exactly (for the brew curl|bash). */
  confirmText(message: string, expected: string): Promise<boolean>;
  /** Emit a line to the user. */
  log(message: string): void;
}

/** Production {@link ToolchainIo}: real PATH/exec, clack prompts, console output. */
function realIo(): ToolchainIo {
  return {
    exists,
    run,
    log: (message) => {
      console.log(message);
    },
    async confirm(message) {
      const answer = await clackConfirm({ message });
      return !isCancel(answer) && answer;
    },
    async confirmText(message, expected) {
      const answer = await text({ message: `${message} Type "${expected}" to proceed:` });
      return !isCancel(answer) && answer.trim().toLowerCase() === expected.toLowerCase();
    },
  };
}

/** Options for {@link ensureToolchain}. */
export interface EnsureToolchainOptions {
  /** Skip every prompt and proceed with installs — for CI, remote hosts, and agents (`--yes`). */
  assumeYes?: boolean;
  /** Injected IO (tests pass a fake); defaults to {@link realIo}. */
  io?: ToolchainIo;
  /** Host-platform override for tests; production detects the real host via {@link isMac}. */
  platform?: NodeJS.Platform;
}

/** Return the tools from `tools` whose command isn't currently on `PATH`. */
async function detectMissing(io: Pick<ToolchainIo, "exists">, tools: Tool[]): Promise<Tool[]> {
  const missing: Tool[] = [];
  for (const tool of tools) {
    if (!(await io.exists(tool.command))) missing.push(tool);
  }
  return missing;
}

/**
 * Make sure the iOS build toolchain is installed, asking consent before changing anything.
 *
 * Flow: detect missing → guide the un-automatable ones (Xcode) → ensure Homebrew (typed-`yes` for its
 * curl|bash installer) → one consent to `brew install` the rest → re-verify. Returns whether the
 * toolchain ended up complete. A non-macOS host is a no-op success (iOS can't build there anyway —
 * the wizard routes those users to remote/EAS).
 *
 * @returns true when every required tool is present afterward.
 */
export async function ensureToolchain(options: EnsureToolchainOptions = {}): Promise<boolean> {
  const io = options.io ?? realIo();
  const onMac = options.platform ? options.platform === "darwin" : isMac();
  const assumeYes = options.assumeYes ?? false;

  if (!onMac) {
    io.log("Toolchain auto-install is macOS-only — on this host, build remotely or via EAS.");
    return true;
  }

  const missing = await detectMissing(io, REQUIRED_TOOLS);
  if (missing.length === 0) {
    io.log("✓ All build tools are installed.");
    return true;
  }

  const { brew, guided } = planInstall(missing);
  for (const tool of guided) io.log(`✗ ${tool.label} — ${fixHint(tool)}`);

  if (brew.length > 0) {
    await installBrewTools(io, brew, assumeYes);
  }

  // If ccache was among the freshly installed tools, configure it once (size + Xcode-friendly sloppiness).
  if (missing.some((tool) => tool.command === "ccache") && (await io.exists("ccache"))) {
    await configureCcache(io);
  }

  const stillMissing = await detectMissing(io, REQUIRED_TOOLS);
  for (const tool of stillMissing.filter((t) => t.tier === "recommended")) {
    io.log(`• ${tool.label} (recommended, skipped) — ${fixHint(tool)}`);
  }
  const requiredMissing = stillMissing.filter((tool) => tool.tier === "required");
  if (requiredMissing.length === 0) {
    io.log("✓ Toolchain ready.");
    return true;
  }
  io.log(`Still missing: ${requiredMissing.map((tool) => tool.label).join(", ")}. See the hints above.`);
  return false;
}

/** ccache cap and the sloppiness flags that make caching reliable for Xcode/CocoaPods ObjC/C++ builds. */
const CCACHE_MAX_SIZE = "10G";
const CCACHE_SLOPPINESS =
  "clang_index_store,file_stat_matches,include_file_ctime,include_file_mtime,ivfsoverlay,pch_defines,modules,system_headers,time_macros";

/**
 * Configure ccache once, right after installing it: a generous size cap so warm objects survive between
 * builds, plus the sloppiness flags Xcode/CocoaPods builds need to actually hit the cache (timestamps and
 * the clang index store would otherwise bust every entry). Idempotent — safe to re-run on a later `--fix`.
 */
async function configureCcache(io: ToolchainIo): Promise<void> {
  io.log(`→ configuring ccache (max-size ${CCACHE_MAX_SIZE}, Xcode-friendly sloppiness)…`);
  await io.run("ccache", ["--max-size", CCACHE_MAX_SIZE]);
  await io.run("ccache", ["--set-config", `sloppiness=${CCACHE_SLOPPINESS}`]);
}

/** The outcome of the inline ccache offer, so a build can log it and persist a decline correctly. */
export type CcacheOfferResult = "installed" | "declined" | "skipped-no-brew" | "skipped-noninteractive";

/**
 * Offer to install + configure ccache inline during a build when it's missing — the convenience twin of
 * `launch doctor --fix`, reusing {@link configureCcache} so the cache is tuned identically (no second
 * source of truth). The caller guarantees ccache is absent and owns the user-facing notices; this only
 * decides and acts:
 * - non-interactive (CI / piped / no TTY) → `"skipped-noninteractive"` — never block a build on stdin;
 * - Homebrew missing → `"skipped-no-brew"` — don't chain a brew bootstrap into a build; point at doctor;
 * - declined → `"declined"` — the caller remembers it so later builds never re-prompt;
 * - accepted → `brew install ccache` + configure → `"installed"` — this build's pod-install/gym pick it up.
 *
 * Never throws on a decline or a failed install: a build without ccache simply runs uncached.
 */
export async function ensureCcacheInstalled(options: {
  interactive: boolean;
  io?: ToolchainIo;
}): Promise<CcacheOfferResult> {
  const io = options.io ?? realIo();
  if (!options.interactive) return "skipped-noninteractive";
  if (!(await io.exists("brew"))) return "skipped-no-brew";
  const proceed = await io.confirm(
    "ccache isn't installed — install it via Homebrew now? It makes repeat builds much faster (this build stays uncached).",
  );
  if (!proceed) return "declined";
  io.log("→ brew install ccache…");
  await io.run("brew", ["install", "ccache"]);
  if (!(await io.exists("ccache"))) return "skipped-no-brew";
  await configureCcache(io);
  return "installed";
}

/**
 * Ensure Homebrew exists (guided/consented), then install the brew-able tools in one batch.
 * Extracted from {@link ensureToolchain} to keep that function's flow legible.
 */
async function installBrewTools(io: ToolchainIo, brewTools: Tool[], assumeYes: boolean): Promise<void> {
  if (!(await ensureHomebrew(io, assumeYes))) {
    io.log("Homebrew isn't available — install it, then re-run `launch doctor --fix`:");
    for (const tool of brewTools) io.log(`  ${fixHint(tool)}`);
    return;
  }

  const labels = brewTools.map((tool) => tool.label).join(", ");
  const proceed =
    assumeYes || (await io.confirm(`Install ${brewTools.length} missing tool(s) via Homebrew? (${labels})`));
  if (!proceed) {
    io.log("Skipped. Install them yourself with:");
    for (const tool of brewTools) io.log(`  ${fixHint(tool)}`);
    return;
  }

  const formulas = brewTools.map((tool) => (tool.install.kind === "brew" ? tool.install.formula : tool.command));
  io.log(`→ brew install ${formulas.join(" ")}`);
  await io.run("brew", ["install", ...formulas]);
}

/**
 * Make sure Homebrew is present, installing it only behind an explicit typed-`yes` because its
 * installer pipes a remote script to bash and may prompt for a password. Returns whether brew is
 * usable afterward.
 */
async function ensureHomebrew(io: ToolchainIo, assumeYes: boolean): Promise<boolean> {
  if (await io.exists("brew")) return true;

  const consent =
    assumeYes ||
    (await io.confirmText(
      "Homebrew is required to install the rest. Run the official installer? It pipes a remote script to bash and may prompt for your password.",
      "yes",
    ));
  if (!consent) return false;

  io.log("→ installing Homebrew (official installer)…");
  await io.run("/bin/bash", ["-c", HOMEBREW_INSTALL_COMMAND]);
  return io.exists("brew");
}
