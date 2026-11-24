// Builds bash, zsh, and fish completion scripts and the candidate list for a tab press.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Command, CommandOption } from '../cli/command.ts';
import { loadConfig } from '../config/config.ts';
import { pathExists } from '../path-exists.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import type { Shell } from '../types/remote.ts';

/** The shells `launch-store completion` supports, in the order help lists them; the first is the default fallback. */
export const SHELLS: readonly Shell[] = ['bash', 'zsh', 'fish'] as const;
/** The marker comments that fence Launch's managed block inside a shell rc file. */
const BLOCK_START = '# launch-completion start';
/** Closing fence of Launch's managed completion block; see {@link BLOCK_START}. */
const BLOCK_END = '# launch-completion end';
/** The hidden subcommand the generated scripts invoke on `<Tab>`. */
export const COMPLETE_SUBCOMMAND = '__complete';

/** Validate a raw shell name against the shells completion supports. */
export function parseShell(shellText: string): Shell {
  function isThisShell(knownShell: Shell): boolean {
    return knownShell == shellText;
  }

  const shell = SHELLS.find(isThisShell);

  if (shell == null) {
    throw new Error(`Unsupported shell "${shellText}". Use one of: ${SHELLS.join(', ')}.`);
  }

  return shell;
}

/** Best-effort detect the user's shell from `$SHELL` (e.g. */
export function detectShell(
  environmentVariables: Readonly<Record<string, string | undefined>>,
): Shell | undefined {
  const shellPath = environmentVariables['SHELL'];

  if (!shellPath) return undefined;

  const shellName = shellPath.slice(shellPath.lastIndexOf('/') + 1);

  function isNamedShell(shell: 'bash' | 'zsh' | 'fish') {
    return shellName == shell;
  }

  return SHELLS.find(isNamedShell);
}

/** The bash completion script. */
export function bashCompletionScript(): string {
  return `# launch-store (bash) completion - eval with: source <(launch-store completion bash)
_launch_complete() {
  local words candidates
  words=("\${COMP_WORDS[@]:1:COMP_CWORD}")
  candidates="$(launch-store completion ${COMPLETE_SUBCOMMAND} -- "\${words[@]}" 2>/dev/null)"
  COMPREPLY=($(compgen -W "\${candidates}" -- "\${COMP_WORDS[COMP_CWORD]}"))
}
complete -o default -F _launch_complete launch-store
`;
}

/** The zsh completion script. */
export function zshCompletionScript(): string {
  return `# launch-store (zsh) completion - eval with: source <(launch-store completion zsh)
_launch_complete() {
  local -a candidates
  candidates=("\${(@f)$(launch-store completion ${COMPLETE_SUBCOMMAND} -- "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
  compadd -- $candidates
}
compdef _launch_complete launch-store
`;
}

/** The fish completion script. */
export function fishCompletionScript(): string {
  return `# launch-store (fish) completion - eval with: launch-store completion fish | source
function __launch_complete
  set -l tokens (commandline -opc) (commandline -ct)
  launch-store completion ${COMPLETE_SUBCOMMAND} -- $tokens[2..-1] 2>/dev/null
end
complete -c launch-store -f -a '(__launch_complete)'
`;
}

/** Map a shell to its script generator - the one place that fans `launch-store completion <shell>` out per shell. */
export function completionScript(shell: Shell): string {
  switch (shell) {
    case 'bash':
      return bashCompletionScript();
    case 'zsh':
      return zshCompletionScript();
    case 'fish':
      return fishCompletionScript();
  }
}

/* -------------------------------------------------------------------------- */
/*  Dynamic-value resolution - reuse the existing core loaders.                */
/* -------------------------------------------------------------------------- */
type CompletionCandidateSource = () => Promise<string[]>;

function pickAppName(app: { name: string }): string {
  return app.name;
}

async function appHandles(): Promise<string[]> {
  const loaded = await loadConfig();

  return loaded.apps.map(pickAppName);
}

async function profileNames(): Promise<string[]> {
  const loaded = await loadConfig();

  return Object.keys(loaded.config.profiles);
}

/** Flags whose VALUE has a dynamic candidate set */
const flagSources: ReadonlyMap<string, CompletionCandidateSource> = new Map([
  ['-a', appHandles],
  ['--app', appHandles],
  ['-p', profileNames],
  ['--profile', profileNames],
]);
/** Commands whose POSITIONAL argument has a dynamic candidate set */
const argumentSources: ReadonlyMap<string, CompletionCandidateSource> = new Map();

/** Every option spelling a command accepts (short and long, e.g. `-a`, `--app`), for flag-name completion. */
function optionFlags(command: Command): string[] {
  function isFlagDefined(flag: string | undefined): flag is string {
    return !!flag;
  }

  function listShortAndLongFlags(option: CommandOption) {
    return [option.short, option.long].filter(isFlagDefined);
  }

  return command.options.flatMap(listShortAndLongFlags);
}

/** Descend the commander tree to the deepest subcommand named by `words` */
function descendCommandTree(
  program: Command,
  words: readonly string[],
): {
  command: Command;
  commandPath: string[];
} {
  let command = program;
  const commandPath: string[] = [];

  for (const word of words) {
    function isNamedCommand(candidate: Command) {
      return candidate.readName() == word;
    }

    const matchingSubcommand = command.commands.find(isNamedCommand);

    if (!matchingSubcommand) break;

    command = matchingSubcommand;
    commandPath.push(word);
  }

  return { command, commandPath };
}

/** Read the completion candidates for a partially-typed `launch-store` command line */
function readEarlierWord(words: readonly string[]): string | null {
  const hasEarlierWord = words.length >= 2;

  if (hasEarlierWord == false) {
    return null;
  }

  const word = words[words.length - 2];

  if (word == null) {
    return null;
  }

  return word;
}

function readSubcommandName(subcommand: Command): string {
  return subcommand.readName();
}

function listStaticCompletionCandidates(command: Command): string[] {
  const subcommandNames = command.commands.map(readSubcommandName);

  return [...subcommandNames, ...optionFlags(command)];
}

async function readFlagCandidates(previousWord: string | null): Promise<string[] | null> {
  if (previousWord == null) {
    return null;
  }

  const flagSource = flagSources.get(previousWord);

  if (flagSource == null) {
    return null;
  }

  return readCompletionCandidates(flagSource);
}

export async function readCompletions(words: string[], program: Command): Promise<string[]> {
  const descended = descendCommandTree(program, words);
  const lastWord = words[words.length - 1];
  let currentWord = '';

  if (lastWord != null) {
    currentWord = lastWord;
  }

  const isTypingFlag = currentWord.startsWith('-');

  if (isTypingFlag) {
    return optionFlags(descended.command);
  }

  const earlierWord = readEarlierWord(words);
  const flagCandidates = await readFlagCandidates(earlierWord);

  if (flagCandidates != null) {
    return flagCandidates;
  }

  const argumentSource = argumentSources.get(descended.commandPath.join(' '));

  if (argumentSource == null) {
    return listStaticCompletionCandidates(descended.command);
  }

  const takingFlags = valueTakingFlags(descended.command);

  const positionalIsFilled = hasPositional(words, descended.commandPath.length, takingFlags);

  if (positionalIsFilled) {
    return listStaticCompletionCandidates(descended.command);
  }

  return readCompletionCandidates(argumentSource);
}

/** Every option on the command or its ancestors that takes a value. */
function valueTakingFlags(command: Command): Set<string> {
  const flags = new Set<string>();

  for (
    let ancestorCommand: Command | null = command;
    ancestorCommand;
    ancestorCommand = ancestorCommand.parent
  ) {
    for (const option of ancestorCommand.options) {
      if (!option.flags.includes('<') && !option.flags.includes('[')) continue;

      if (option.short) flags.add(option.short);

      if (option.long) flags.add(option.long);
    }
  }

  return flags;
}

/** Whether a real positional argument has already been supplied to the resolved command. */
function hasPositional(
  words: string[],
  pathLength: number,
  valueFlags: ReadonlySet<string>,
): boolean {
  const afterCommand = words.slice(pathLength, -1); // drop the command path and the in-progress word

  for (const [i, word] of afterCommand.entries()) {
    if (word.startsWith('-')) continue; // a flag, not a positional

    let previousWord: string | undefined;

    if (i > 0) previousWord = afterCommand[i - 1];

    if (previousWord != null && valueFlags.has(previousWord)) continue;

    return true;
  }

  return false;
}

// A completion menu must not fail the shell, so a bad read becomes no candidates.
async function readCompletionCandidates(source: CompletionCandidateSource): Promise<string[]> {
  try {
    return await source();
  } catch (cause) {
    const sourceFailed = cause != null;

    if (sourceFailed) {
      return [];
    }

    return [];
  }
}

/** The single line, per shell, that sources Launch's completion script when the rc file loads. */
function completionSourceLine(shell: Shell): string {
  if (shell == 'fish') return 'launch-store completion fish | source';

  return `source <(launch-store completion ${shell})`;
}

/** The outcome of an {@link installCompletion} attempt. */
export type InstallResult =
  | {
      /** Launch wrote the managed block into the rc file. */
      readonly status: 'installed';
      /** The shell that was wired up. */
      readonly shell: Shell;
      /** Absolute path to the rc file that was written. */
      readonly rcFile: string;
      /** Whether an existing managed block was replaced (`true`) vs. a fresh block appended (`false`). */
      readonly updated: boolean;
    }
  | {
      /** Launch could not safely edit the rc file; the user should add {@link line} by hand. */
      readonly status: 'manual';
      /** The shell the steps are for. */
      readonly shell: Shell;
      /** Absolute path to the rc file the line belongs in. */
      readonly rcFile: string;
      /** The exact line to add to the rc file. */
      readonly line: string;
    };

/** Options for {@link installCompletion}; both default so the common call is argument-free. */
export type InstallOptions = {
  shell?: Shell | undefined;
  home?: string | undefined;
};

/** Build the managed block (fences + the source line) for a shell */
export function managedBlock(shell: Shell): string {
  return `${BLOCK_START}\n${completionSourceLine(shell)}\n${BLOCK_END}`;
}

/** Splice the managed block into existing rc-file contents idempotently */
export function spliceManagedBlock(
  existing: string,
  block: string,
): {
  contents: string;
  updated: boolean;
} {
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);

  if (start != -1 && end != -1 && end > start) {
    const before = existing.slice(0, start);
    const after = existing.slice(end + BLOCK_END.length);
    return { contents: `${before}${block}${after}`, updated: true };
  }

  let existingWithTrailingNewline = existing;

  if (existing.length > 0 && !existing.endsWith('\n')) {
    existingWithTrailingNewline = `${existing}\n`;
  }

  let blockSeparator = '';

  if (existingWithTrailingNewline.length > 0 && !existingWithTrailingNewline.endsWith('\n\n')) {
    blockSeparator = '\n';
  }

  return {
    contents: `${existingWithTrailingNewline}${blockSeparator}${block}\n`,
    updated: false,
  };
}

/** Wire Launch's completion into the resolved shell's rc file, idempotently. */
function isManualInstall(rcFileExists: boolean, rcDirectoryExists: boolean): boolean {
  if (rcFileExists) {
    return false;
  }

  return rcDirectoryExists == false;
}

async function writeCompletionBlock(completionInstall: {
  shell: Shell;
  rcFile: string;
  rcDirectory: string;
  completionBlock: string;
}): Promise<InstallResult> {
  const rcFileExists = await pathExists(completionInstall.rcFile);
  const rcDirectoryExists = await pathExists(completionInstall.rcDirectory);

  const manualInstall = isManualInstall(rcFileExists, rcDirectoryExists);

  if (manualInstall) {
    return {
      status: 'manual',
      shell: completionInstall.shell,
      rcFile: completionInstall.rcFile,
      line: completionSourceLine(completionInstall.shell),
    };
  }

  let existingContents = '';

  if (rcFileExists) {
    existingContents = await readFile(completionInstall.rcFile, 'utf8');
  }

  const splicedBlock = spliceManagedBlock(existingContents, completionInstall.completionBlock);

  await mkdir(completionInstall.rcDirectory, { recursive: true });
  await writeFile(completionInstall.rcFile, splicedBlock.contents);

  return {
    status: 'installed',
    shell: completionInstall.shell,
    rcFile: completionInstall.rcFile,
    updated: splicedBlock.updated,
  };
}

export async function installCompletion(options: InstallOptions = {}): Promise<InstallResult> {
  const environment = readLaunchEnvironment();
  let shell = options.shell;

  if (shell == null) {
    shell = detectShell(environment.rawVariables);
  }

  if (shell == null) {
    throw new Error('Could not detect your shell. Re-run with --shell bash|zsh|fish.');
  }

  let home = options.home;

  if (home == null) {
    home = readLaunchDirectories().homeDirectory;
  }

  const rcFile = join(
    home,
    {
      bash: '.bashrc',
      zsh: '.zshrc',
      fish: '.config/fish/config.fish',
    }[shell],
  );
  const completionBlock = managedBlock(shell);
  const rcDirectory = dirname(rcFile);

  try {
    return await writeCompletionBlock({ shell, rcFile, rcDirectory, completionBlock });
  } catch (cause) {
    throw new Error(`Could not install completion in ${rcFile}.`, { cause });
  }
}
