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
    install: {
      kind: "guide",
      how: "Install Xcode from the App Store, then run `xcode-select --install` for the Command Line Tools.",
    },
  },
  { label: "Ruby", command: "ruby", install: { kind: "brew", formula: "ruby" } },
  { label: "fastlane", command: "fastlane", install: { kind: "brew", formula: "fastlane" } },
  { label: "CocoaPods (pod)", command: "pod", install: { kind: "brew", formula: "cocoapods" } },
  { label: "openssl", command: "openssl", install: { kind: "brew", formula: "openssl" } },
  { label: "Node", command: "node", install: { kind: "brew", formula: "node" } },
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
  /** Host platform; defaults to `process.platform`. */
  platform?: NodeJS.Platform;
}

/** Return the tools from `tools` whose command isn't currently on `PATH`. */
async function detectMissing(io: ToolchainIo, tools: Tool[]): Promise<Tool[]> {
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
  // MERGE: once the AWS-EC2 branch lands core/os.ts, replace this with `isMac()` from there.
  const platform = options.platform ?? process.platform;
  const assumeYes = options.assumeYes ?? false;

  if (platform !== "darwin") {
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

  const stillMissing = await detectMissing(io, REQUIRED_TOOLS);
  if (stillMissing.length === 0) {
    io.log("✓ Toolchain ready.");
    return true;
  }
  io.log(`Still missing: ${stillMissing.map((tool) => tool.label).join(", ")}. See the hints above.`);
  return false;
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
