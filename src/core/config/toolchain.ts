import { Effect } from 'effect';
import {
  checkCommandExists,
  executeCommand,
  provideNodeCommandServices,
} from '../services/exec.js';
import { createLogger, type Logger } from '../services/logger.js';
import { checkIsMacOperatingSystem } from '../services/os.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
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
  { label: 'Ruby', command: 'ruby', tier: 'required', install: { kind: 'brew', formula: 'ruby' } },
  {
    label: 'fastlane',
    command: 'fastlane',
    tier: 'required',
    install: { kind: 'brew', formula: 'fastlane' },
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
 * `bundletool` estimates the download, and `fastlane` does the upload. `ANDROID_HOME` (the SDK) is an
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
    label: 'fastlane',
    command: 'fastlane',
    tier: 'required',
    install: { kind: 'brew', formula: 'fastlane' },
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
 * (a missing App Store Connect record, an unsigned agreement) that Homebrew can't fix, so the wizard can
 * offer the install only when it would actually do something (issue #117). Probes through the injectable
 * {@link ToolchainIo.exists}, so it's unit-testable with no real PATH lookups.
 */
export const missingRequiredTools = (
  io?: Pick<ToolchainIo, 'exists'>,
): Effect.Effect<Tool[], unknown> =>
  Effect.gen(function* () {
    if (io !== undefined) {
      const missing = yield* detectMissing(io, REQUIRED_TOOLS);
      return missing.filter((tool) => tool.tier === 'required');
    }
    const missing = yield* detectMissing(
      {
        exists: (executable) => provideNodeCommandServices(checkCommandExists(executable)),
      },
      REQUIRED_TOOLS,
    );
    return missing.filter((tool) => tool.tier === 'required');
  });
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
 * Production wiring ({@link realIo}) maps these onto the repo's exec helpers, clack prompts, and console.
 */
export type ToolchainIo = {
  exists(command: string): Effect.Effect<boolean, unknown>;
  run(command: string, args: string[]): Effect.Effect<void, unknown>;
  confirm(message: string): Effect.Effect<boolean, unknown>;
  confirmText(message: string, expected: string): Effect.Effect<boolean, unknown>;
  log(message: string): Effect.Effect<void, unknown>;
};
/** Production {@link ToolchainIo}: real PATH/exec, clack prompts, logger-seam output. */
const realIo = (logger: Logger, prompt: LaunchPromptService): ToolchainIo => {
  return {
    exists: (executable) => provideNodeCommandServices(checkCommandExists(executable)),
    run: (executable, commandArguments) =>
      provideNodeCommandServices(executeCommand(executable, commandArguments)),
    log: (message) => logger.line(message),
    confirm: (message) => prompt.confirm(message),
    confirmText(message, expected) {
      return prompt
        .requiredText(`${message} Type "${expected}" to proceed:`)
        .pipe(Effect.map((answer) => answer.trim().toLowerCase() === expected.toLowerCase()));
    },
  };
};
/** Options for {@link ensureToolchain}. */
export type EnsureToolchainOptions = {
  assumeYes?: boolean;
  io?: ToolchainIo;
  platform?: NodeJS.Platform;
};
/** Return the tools from `tools` whose command isn't currently on `PATH`. */
const detectMissing = (
  io: Pick<ToolchainIo, 'exists'>,
  tools: Tool[],
): Effect.Effect<Tool[], unknown> =>
  Effect.filter(tools, (tool) => io.exists(tool.command).pipe(Effect.map((exists) => !exists)), {
    concurrency: 1,
  });
export const ensureToolchain = (
  options: EnsureToolchainOptions = {},
): Effect.Effect<boolean, unknown, Logger | LaunchPromptService> =>
  Effect.gen(function* () {
    let io = options.io;
    if (io === undefined) {
      const logger = yield* createLogger(false);
      const prompt = yield* LaunchPrompt;
      io = realIo(logger, prompt);
    }
    let onMac = yield* checkIsMacOperatingSystem;
    if (options.platform !== undefined) onMac = options.platform === 'darwin';
    let assumeYes = false;
    if (options.assumeYes !== undefined) assumeYes = options.assumeYes;
    if (!onMac) {
      yield* io.log(
        'Toolchain auto-install is macOS-only - on this host, build remotely or via EAS.',
      );
      return true;
    }
    const missing = yield* detectMissing(io, REQUIRED_TOOLS);
    if (missing.length === 0) {
      yield* io.log('OK All build tools are installed.');
      return true;
    }
    const { brew, guided } = planInstall(missing);
    for (const tool of guided) yield* io.log(`x ${tool.label} - ${fixHint(tool)}`);
    if (brew.length > 0) {
      yield* installBrewTools(io, brew, assumeYes);
    }
    // If ccache was among the freshly installed tools, configure it once (size + Xcode-friendly sloppiness).
    if (missing.some((tool) => tool.command === 'ccache') && (yield* io.exists('ccache'))) {
      yield* configureCcache(io);
    }
    const stillMissing = yield* detectMissing(io, REQUIRED_TOOLS);
    for (const tool of stillMissing.filter((t) => t.tier === 'recommended')) {
      yield* io.log(`- ${tool.label} (recommended, skipped) - ${fixHint(tool)}`);
    }
    const requiredMissing = stillMissing.filter((tool) => tool.tier === 'required');
    if (requiredMissing.length === 0) {
      yield* io.log('OK Toolchain ready.');
      return true;
    }
    yield* io.log(
      `Still missing: ${requiredMissing.map((tool) => tool.label).join(', ')}. See the hints above.`,
    );
    return false;
  });
/** ccache cap and the sloppiness flags that make caching reliable for Xcode/CocoaPods ObjC/C++ builds. */
const CCACHE_MAX_SIZE = '10G';
const CCACHE_SLOPPINESS =
  'clang_index_store,file_stat_matches,include_file_ctime,include_file_mtime,ivfsoverlay,pch_defines,modules,system_headers,time_macros';
/**
 * Configure ccache once, right after installing it: a generous size cap so warm objects survive between
 * builds, plus the sloppiness flags Xcode/CocoaPods builds need to actually hit the cache (timestamps and
 * the clang index store would otherwise bust every entry). Idempotent - safe to re-run on a later `--fix`.
 */
const configureCcache = (io: ToolchainIo): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    yield* io.log(
      `-> configuring ccache (max-size ${CCACHE_MAX_SIZE}, Xcode-friendly sloppiness)...`,
    );
    yield* io.run('ccache', ['--max-size', CCACHE_MAX_SIZE]);
    yield* io.run('ccache', ['--set-config', `sloppiness=${CCACHE_SLOPPINESS}`]);
  });
/** The outcome of the inline ccache offer, so a build can log it and persist a decline correctly. */
export type CcacheOfferResult =
  | 'installed'
  | 'declined'
  | 'skipped-no-brew'
  | 'skipped-noninteractive';
/**
 * Offer to install + configure ccache inline during a build when it's missing - the convenience twin of
 * `launch doctor --fix`, reusing {@link configureCcache} so the cache is tuned identically (no second
 * source of truth). The caller guarantees ccache is absent and owns the user-facing notices; this only
 * decides and acts:
 * - non-interactive (CI / piped / no TTY) -> `"skipped-noninteractive"` - never block a build on stdin;
 * - Homebrew missing -> `"skipped-no-brew"` - don't chain a brew bootstrap into a build; point at doctor;
 * - declined -> `"declined"` - the caller remembers it so later builds never re-prompt;
 * - accepted -> `brew install ccache` + configure -> `"installed"` - this build's pod-install/gym pick it up.
 *
 * Never throws on a decline or a failed install: a build without ccache simply runs uncached.
 */
export const ensureCcacheInstalled = (options: {
  interactive: boolean;
  io?: ToolchainIo;
}): Effect.Effect<CcacheOfferResult, unknown, Logger | LaunchPromptService> =>
  Effect.gen(function* () {
    let io = options.io;
    if (io === undefined) {
      const logger = yield* createLogger(false);
      const prompt = yield* LaunchPrompt;
      io = realIo(logger, prompt);
    }
    if (!options.interactive) return 'skipped-noninteractive';
    if (!(yield* io.exists('brew'))) return 'skipped-no-brew';
    const proceed = yield* io.confirm(
      "ccache isn't installed - install it via Homebrew now? It makes repeat builds much faster (this build stays uncached).",
    );
    if (!proceed) return 'declined';
    yield* io.log('-> brew install ccache...');
    yield* io.run('brew', ['install', 'ccache']);
    if (!(yield* io.exists('ccache'))) return 'skipped-no-brew';
    yield* configureCcache(io);
    return 'installed';
  });
/**
 * Ensure Homebrew exists (guided/consented), then install the brew-able tools in one batch.
 * Extracted from {@link ensureToolchain} to keep that function's flow legible.
 */
const installBrewTools = (
  io: ToolchainIo,
  brewTools: Tool[],
  assumeYes: boolean,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    if (!(yield* ensureHomebrew(io, assumeYes))) {
      yield* io.log("Homebrew isn't available - install it, then re-run `launch doctor --fix`:");
      for (const tool of brewTools) yield* io.log(`  ${fixHint(tool)}`);
      return;
    }
    const labels = brewTools.map((tool) => tool.label).join(', ');
    let proceed = assumeYes;
    if (!proceed)
      proceed = yield* io.confirm(
        `Install ${brewTools.length} missing tool(s) via Homebrew? (${labels})`,
      );
    if (!proceed) {
      yield* io.log('Skipped. Install them yourself with:');
      for (const tool of brewTools) yield* io.log(`  ${fixHint(tool)}`);
      return;
    }
    const formulas = brewTools.map((tool) => {
      if (tool.install.kind === 'brew') return tool.install.formula;
      return tool.command;
    });
    yield* io.log(`-> brew install ${formulas.join(' ')}`);
    yield* io.run('brew', ['install', ...formulas]);
  });
/**
 * Make sure Homebrew is present, installing it only behind an explicit typed-`yes` because its
 * installer pipes a remote script to bash and may prompt for a password. Returns whether brew is
 * usable afterward.
 */
const ensureHomebrew = (io: ToolchainIo, assumeYes: boolean): Effect.Effect<boolean, unknown> =>
  Effect.gen(function* () {
    if (yield* io.exists('brew')) return true;
    let consent = assumeYes;
    if (!consent)
      consent = yield* io.confirmText(
        'Homebrew is required to install the rest. Run the official installer? It pipes a remote script to bash and may prompt for your password.',
        'yes',
      );
    if (!consent) return false;
    yield* io.log('-> installing Homebrew (official installer)...');
    yield* io.run('/bin/bash', ['-c', HOMEBREW_INSTALL_COMMAND]);
    return yield* io.exists('brew');
  });
