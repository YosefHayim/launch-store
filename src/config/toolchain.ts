import { checkCommandExists, executeCommand } from '../services/platform/exec.js';
import { createLogger, type Logger } from '../services/platform/logger.js';
import { checkIsMacOperatingSystem } from '../services/platform/os.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/platform/prompt.js';
/**
 * A tool a local iOS build needs, and how to install it on macOS.
 * - `brew`: installable non-interactively via `brew install <formula>`.
 * - `guide`: can't be cleanly automated (Xcode); we print the guide text for the user instead.
 */
export type Tool = {
  label: string;
  command: string;
  tier: 'required' | 'recommended';
  install:
    | {
        kind: 'brew';
        formula: string;
      }
    | {
        kind: 'guide';
        how: string;
      };
};
/**
 * The canonical toolchain an iOS build needs. Single source of truth - `doctor` renders this list
 * and {@link ensureToolchain} installs from it, so the two never drift.
 */
export const REQUIRED_TOOLS: Tool[] = [
  {
    label: 'Xcode (xcodebuild)',
    command: 'xcodebuild',
    tier: 'required',
    install: {
      kind: 'guide',
      how: 'Install Xcode from the App Store, then run `xcode-select --install` for the Command Line Tools.',
    },
  },
  {
    label: 'CocoaPods (pod)',
    command: 'pod',
    tier: 'required',
    install: { kind: 'brew', formula: 'cocoapods' },
  },
  {
    label: 'openssl',
    command: 'openssl',
    tier: 'required',
    install: { kind: 'brew', formula: 'openssl' },
  },
  { label: 'Node', command: 'node', tier: 'required', install: { kind: 'brew', formula: 'node' } },
  // Recommended, not required: makes a clean build 50-70% cheaper; absent -> uncached, never a hard fail.
  {
    label: 'ccache',
    command: 'ccache',
    tier: 'recommended',
    install: { kind: 'brew', formula: 'ccache' },
  },
];
/**
 * The toolchain an Android build needs - the executables `launch doctor --platform android` probes.
 * Unlike iOS, none of these are macOS-only (Android builds anywhere), and Xcode has no analog: the
 * JDK supplies `keytool`, gradle runs via the project's own wrapper (checked separately, not here),
 * and `bundletool` estimates the download. `ANDROID_HOME` (the SDK) is an
 * env var, also checked separately in `doctor`.
 */
export const ANDROID_TOOLS: Tool[] = [
  {
    label: 'JDK (keytool)',
    command: 'keytool',
    tier: 'required',
    install: { kind: 'brew', formula: 'openjdk' },
  },
  {
    label: 'bundletool',
    command: 'bundletool',
    tier: 'required',
    install: { kind: 'brew', formula: 'bundletool' },
  },
  { label: 'Node', command: 'node', tier: 'required', install: { kind: 'brew', formula: 'node' } },
];
/** The official Homebrew installer one-liner, run verbatim under `bash -c` so its `$(curl ...)` substitution and `/dev/tty` prompts work. */
const HOMEBREW_INSTALL_COMMAND =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
/** The single-line, actionable fix for a missing tool - `brew install ...` or the guide text. */
export const fixHint = (tool: Tool): string => {
  if (tool.install.kind === 'brew') return `brew install ${tool.install.formula}`;
  return tool.install.how;
};
/**
 * Split missing tools into the ones we can `brew install` as a batch and the ones we can only guide.
 * Pure, so the planning is unit-testable without touching the system.
 */
export const planInstall = (
  missing: Tool[],
): {
  brew: Tool[];
  guided: Tool[];
} => {
  return {
    brew: missing.filter((tool) => tool.install.kind === 'brew'),
    guided: missing.filter((tool) => tool.install.kind === 'guide'),
  };
};
/**
 * The *required* iOS build tools currently absent from `PATH` - the signal for whether a Homebrew install
 * is even relevant. Recommended tools (ccache) are excluded: their absence only slows a build, it isn't a
 * gap worth an install prompt. Unlike `runDoctor`'s overall pass/fail this ignores non-tool preflight state
 * (a missing App Store Connect record, an unsigned agreement) that Homebrew can't fix, so a caller can
 * offer the install only when it would actually do something (issue #117). Probes through the injectable
 * {@link ToolchainIo.exists}, so it's unit-testable with no real PATH lookups.
 */
function isRequiredTool(tool: Tool): boolean {
  return tool.tier == 'required';
}

export async function missingRequiredTools(io?: Pick<ToolchainIo, 'exists'>): Promise<Tool[]> {
  let probe = io;

  if (probe == null) {
    probe = { exists: checkCommandExists };
  }

  const missing = await detectMissing(probe, REQUIRED_TOOLS);

  return missing.filter(isRequiredTool);
}
/**
 * Generate the bash toolchain preflight that runs ON the remote Mac before a build - the remote twin of
 * `launch doctor`, emitted from {@link REQUIRED_TOOLS} so the host and local checks never drift (issue #6).
 *
 * `mode` reflects who owns the host:
 * - `"install"` - the AWS EC2 Mac is ours, so a missing brew-able required tool is installed (and the
 *   recommended ccache best-effort), then re-checked; only an un-installable miss (Xcode) or a failed
 *   install fails the preflight.
 * - `"assert"` - a BYO-SSH host is the user's machine, so nothing is mutated: a missing required tool
 *   fails with the same `brew install ...` hint `launch doctor` prints; a missing ccache only warns.
 *
 * Prints `LAUNCH_PREFLIGHT_OK` on success; on a missing required tool it lists each gap and exits
 * non-zero, so the SSH step fails fast with an actionable message instead of a cryptic mid-build error.
 */
export const remoteToolchainPreflight = (mode: 'install' | 'assert'): string => {
  const canInstall = mode === 'install';
  // Single-quote any message embedded in `echo` so backticks in a hint (e.g. Xcode's) stay literal.
  const q = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`;
  const lines: string[] = ['set -uo pipefail', 'MISSING=0'];
  if (canInstall) {
    // Put Homebrew on PATH in a non-interactive SSH shell before any install attempt.
    lines.push(
      'if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)"; ' +
        'elif [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv 2>/dev/null)"; fi',
    );
  }
  for (const tool of REQUIRED_TOOLS) {
    const present = `command -v ${tool.command} >/dev/null 2>&1`;
    if (canInstall && tool.install.kind === 'brew') {
      lines.push(
        `if ! ${present}; then echo ${q(`-> installing ${tool.label}`)}; ` +
          `if ! brew install ${tool.install.formula}; then echo ${q(`- ${tool.label} install failed; checking again`)}; fi; fi`,
      );
    }
    if (tool.tier === 'required') {
      lines.push(
        `if ! ${present}; then echo ${q(`x ${tool.label} missing - ${fixHint(tool)}`)}; MISSING=1; fi`,
      );
    } else {
      lines.push(
        `if ! ${present}; then echo ${q(`- ${tool.label} (recommended) - ${fixHint(tool)}`)}; fi`,
      );
    }
  }
  lines.push(`if [ "$MISSING" = 1 ]; then echo LAUNCH_PREFLIGHT_FAILED; exit 1; fi`);
  lines.push('echo LAUNCH_PREFLIGHT_OK');
  return lines.join('\n');
};
/**
 * Side-effecting operations {@link ensureToolchain} needs, injected so tests can supply fakes.
 * Production wiring ({@link realIo}) maps these onto the repo's exec helpers, terminal prompts, and console.
 */
export type ToolchainIo = {
  exists(command: string): Promise<boolean>;
  run(command: string, args: readonly string[]): Promise<void>;
  confirm(message: string): Promise<boolean>;
  confirmText(message: string, expected: string): Promise<boolean>;
  log(message: string): Promise<void>;
};

function realIo(logger: Logger, prompt: LaunchPromptService): ToolchainIo {
  return {
    exists: checkCommandExists,
    run: executeCommand,
    async log(message: string): Promise<void> {
      logger.line(message);
    },
    confirm: prompt.confirm,
    async confirmText(message: string, expected: string): Promise<boolean> {
      const answer = await prompt.requiredText(`${message} Type "${expected}" to proceed:`);

      return answer.trim().toLowerCase() == expected.toLowerCase();
    },
  };
}
/** Options for {@link ensureToolchain}. */
type EnsureToolchainOptions = {
  assumeYes?: boolean;
  io?: ToolchainIo;
  platform?: NodeJS.Platform;
};
async function detectMissing(
  io: Pick<ToolchainIo, 'exists'>,
  tools: readonly Tool[],
): Promise<Tool[]> {
  const missing: Tool[] = [];

  for (const tool of tools) {
    const exists = await io.exists(tool.command);

    if (exists == false) {
      missing.push(tool);
    }
  }

  return missing;
}

function isCcache(tool: Tool): boolean {
  return tool.command == 'ccache';
}

function isRecommendedTool(tool: Tool): boolean {
  return tool.tier == 'recommended';
}

function toolLabel(tool: Tool): string {
  return tool.label;
}

function readToolchainIo(options: { io?: ToolchainIo }): ToolchainIo {
  if (options.io != null) {
    return options.io;
  }

  return realIo(createLogger(false), LaunchPrompt);
}

export async function ensureToolchain(options: EnsureToolchainOptions = {}): Promise<boolean> {
  const io = readToolchainIo(options);
  let onMac = checkIsMacOperatingSystem();

  if (options.platform != null) {
    onMac = options.platform == 'darwin';
  }

  let assumeYes = false;

  if (options.assumeYes != null) {
    assumeYes = options.assumeYes;
  }

  if (onMac == false) {
    await io.log('Toolchain auto-install is macOS-only - on this host, build remotely or via EAS.');

    return true;
  }

  const missing = await detectMissing(io, REQUIRED_TOOLS);
  const noneMissing = missing.length == 0;

  if (noneMissing) {
    await io.log('OK All build tools are installed.');

    return true;
  }

  const planned = planInstall(missing);

  for (const tool of planned.guided) {
    await io.log(`x ${tool.label} - ${fixHint(tool)}`);
  }

  const hasBrewTools = planned.brew.length > 0;

  if (hasBrewTools) {
    await installBrewTools(io, planned.brew, assumeYes);
  }

  const ccacheWasMissing = missing.some(isCcache);

  if (ccacheWasMissing) {
    const ccacheExists = await io.exists('ccache');

    if (ccacheExists) {
      await configureCcache(io);
    }
  }

  const stillMissing = await detectMissing(io, REQUIRED_TOOLS);

  for (const tool of stillMissing.filter(isRecommendedTool)) {
    await io.log(`- ${tool.label} (recommended, skipped) - ${fixHint(tool)}`);
  }

  const requiredMissing = stillMissing.filter(isRequiredTool);
  const requiredArePresent = requiredMissing.length == 0;

  if (requiredArePresent) {
    await io.log('OK Toolchain ready.');

    return true;
  }

  await io.log(`Still missing: ${requiredMissing.map(toolLabel).join(', ')}. See the hints above.`);

  return false;
}
/** ccache cap and the sloppiness flags that make caching reliable for Xcode/CocoaPods ObjC/C++ builds. */
const CCACHE_MAX_SIZE = '10G';
const CCACHE_SLOPPINESS =
  'clang_index_store,file_stat_matches,include_file_ctime,include_file_mtime,ivfsoverlay,pch_defines,modules,system_headers,time_macros';
/**
 * Configure ccache once, right after installing it: a generous size cap so warm objects survive between
 * builds, plus the sloppiness flags Xcode/CocoaPods builds need to actually hit the cache (timestamps and
 * the clang index store would otherwise bust every entry). Idempotent - safe to re-run on a later `--fix`.
 */
async function configureCcache(io: ToolchainIo): Promise<void> {
  await io.log(`-> configuring ccache (max-size ${CCACHE_MAX_SIZE}, Xcode-friendly sloppiness)...`);
  await io.run('ccache', ['--max-size', CCACHE_MAX_SIZE]);
  await io.run('ccache', ['--set-config', `sloppiness=${CCACHE_SLOPPINESS}`]);
}
/** The outcome of the inline ccache offer, so a build can log it and persist a decline correctly. */
type CcacheOfferResult = 'installed' | 'declined' | 'skipped-no-brew' | 'skipped-noninteractive';
/**
 * Offer to install + configure ccache inline during a build when it's missing - the convenience twin of
 * `launch doctor --fix`, reusing {@link configureCcache} so the cache is tuned identically (no second
 * source of truth). The caller guarantees ccache is absent and owns the user-facing notices; this only
 * decides and acts:
 * - non-interactive (CI / piped / no TTY) -> `"skipped-noninteractive"` - never block a build on stdin;
 * - Homebrew missing -> `"skipped-no-brew"` - don't chain a brew bootstrap into a build; point at doctor;
 * - declined -> `"declined"` - the caller remembers it so later builds never re-prompt;
 * - accepted -> `brew install ccache` + configure -> `"installed"` - this build's pod-install/xcodebuild pick it up.
 *
 * Never throws on a decline or a failed install: a build without ccache simply runs uncached.
 */
export async function ensureCcacheInstalled(options: {
  interactive: boolean;
  io?: ToolchainIo;
}): Promise<CcacheOfferResult> {
  const io = readToolchainIo(options);

  if (options.interactive == false) {
    return 'skipped-noninteractive';
  }

  const brewExists = await io.exists('brew');

  if (brewExists == false) {
    return 'skipped-no-brew';
  }

  const proceed = await io.confirm(
    "ccache isn't installed - install it via Homebrew now? It makes repeat builds much faster (this build stays uncached).",
  );

  if (proceed == false) {
    return 'declined';
  }

  await io.log('-> brew install ccache...');
  await io.run('brew', ['install', 'ccache']);
  const ccacheExists = await io.exists('ccache');

  if (ccacheExists == false) {
    return 'skipped-no-brew';
  }

  await configureCcache(io);

  return 'installed';
}
/**
 * Ensure Homebrew exists (guided/consented), then install the brew-able tools in one batch.
 * Extracted from {@link ensureToolchain} to keep that function's flow legible.
 */
function brewFormula(tool: Tool): string {
  if (tool.install.kind == 'brew') {
    return tool.install.formula;
  }

  return tool.command;
}

async function installBrewTools(
  io: ToolchainIo,
  brewTools: readonly Tool[],
  assumeYes: boolean,
): Promise<void> {
  const homebrewReady = await ensureHomebrew(io, assumeYes);

  if (homebrewReady == false) {
    await io.log("Homebrew isn't available - install it, then re-run `launch doctor --fix`:");

    for (const tool of brewTools) {
      await io.log(`  ${fixHint(tool)}`);
    }

    return;
  }

  const labels = brewTools.map(toolLabel).join(', ');
  let proceed = assumeYes;

  if (proceed == false) {
    proceed = await io.confirm(
      `Install ${brewTools.length} missing tool(s) via Homebrew? (${labels})`,
    );
  }

  if (proceed == false) {
    await io.log('Skipped. Install them yourself with:');

    for (const tool of brewTools) {
      await io.log(`  ${fixHint(tool)}`);
    }

    return;
  }

  const formulas = brewTools.map(brewFormula);
  await io.log(`-> brew install ${formulas.join(' ')}`);
  await io.run('brew', ['install', ...formulas]);
}
/**
 * Make sure Homebrew is present, installing it only behind an explicit typed-`yes` because its
 * installer pipes a remote script to bash and may prompt for a password. Returns whether brew is
 * usable afterward.
 */
async function ensureHomebrew(io: ToolchainIo, assumeYes: boolean): Promise<boolean> {
  const brewExists = await io.exists('brew');

  if (brewExists) {
    return true;
  }

  let consent = assumeYes;

  if (consent == false) {
    consent = await io.confirmText(
      'Homebrew is required to install the rest. Run the official installer? It pipes a remote script to bash and may prompt for your password.',
      'yes',
    );
  }

  if (consent == false) {
    return false;
  }

  await io.log('-> installing Homebrew (official installer)...');
  await io.run('/bin/bash', ['-c', HOMEBREW_INSTALL_COMMAND]);

  return io.exists('brew');
}
