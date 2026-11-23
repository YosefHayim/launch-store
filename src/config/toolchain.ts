import { checkCommandExists, executeCommand } from '../services/platform/exec.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import { checkIsMacOperatingSystem } from '../services/platform/os.ts';
import { LaunchPrompt, type LaunchPromptService } from '../services/platform/prompt.ts';
/** A tool a local iOS build needs, and how to install it on macOS. */
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
/** The canonical toolchain an iOS build needs. */
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
/** The toolchain an Android build needs */
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
/** The single-line, actionable fix for a missing tool - `brew install ...` or the guide text. */
export function fixHint(tool: Tool): string {
  if (tool.install.kind == 'brew') return `brew install ${tool.install.formula}`;

  return tool.install.how;
}
/** Split missing tools into the ones we can `brew install` as a batch and the ones we can only */
export function planInstall(missing: Tool[]): {
  brew: Tool[];
  guided: Tool[];
} {
  function filterTool(tool: {
    label: string;
    command: string;
    tier: 'required' | 'recommended';
    install: { kind: 'brew'; formula: string } | { kind: 'guide'; how: string };
  }) {
    return tool.install.kind == 'brew';
  }

  function filterTool2(tool: {
    label: string;
    command: string;
    tier: 'required' | 'recommended';
    install: { kind: 'brew'; formula: string } | { kind: 'guide'; how: string };
  }) {
    return tool.install.kind == 'guide';
  }

  return {
    brew: missing.filter(filterTool),
    guided: missing.filter(filterTool2),
  };
}
/** The *required* iOS build tools currently absent from `PATH` */
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
/** Generate the bash toolchain preflight that runs ON the remote Mac before a build */
export function remoteToolchainPreflight(mode: 'install' | 'assert'): string {
  const canInstall = mode == 'install';

  // Single-quote any message embedded in `echo` so backticks in a hint (e.g. Xcode's) stay literal.
  function q(text: string): string {
    return `'${text.replace(/'/g, "'\\''")}'`;
  }

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

    if (canInstall && tool.install.kind == 'brew') {
      lines.push(
        `if ! ${present}; then echo ${q(`-> installing ${tool.label}`)}; ` +
          `if ! brew install ${tool.install.formula}; then echo ${q(`- ${tool.label} install failed; checking again`)}; fi; fi`,
      );
    }

    if (tool.tier == 'required') {
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
}
/** Side-effecting operations {@link ensureToolchain} needs, injected so tests can supply fakes. */
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

  const logger = createLogger(false);

  return realIo(logger, LaunchPrompt);
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
/** Configure ccache once, right after installing it */
async function configureCcache(io: ToolchainIo): Promise<void> {
  await io.log(`-> configuring ccache (max-size ${CCACHE_MAX_SIZE}, Xcode-friendly sloppiness)...`);
  await io.run('ccache', ['--max-size', CCACHE_MAX_SIZE]);
  await io.run('ccache', [
    '--set-config',
    `sloppiness=${'clang_index_store,file_stat_matches,include_file_ctime,include_file_mtime,ivfsoverlay,pch_defines,modules,system_headers,time_macros'}`,
  ]);
}
/** The outcome of the inline ccache offer, so a build can log it and persist a decline correctly. */
type CcacheOfferResult = 'installed' | 'declined' | 'skipped-no-brew' | 'skipped-noninteractive';
/** Offer to install + configure ccache inline during a build when it's missing */
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
/** Ensure Homebrew exists (guided/consented), then install the brew-able tools in one batch. */
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
    await io.log("Homebrew isn't available - install it, then re-run `launch-store doctor --fix`:");

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
/** Make sure Homebrew is present */
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
  await io.run('/bin/bash', [
    '-c',
    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
  ]);

  return io.exists('brew');
}
