import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Command } from '../cli/command.ts';
import { loadConfig } from '../config/config.ts';
import { pathExists } from '../path-exists.ts';
import { listSurfacePlanners, registerBuiltinPlanners } from '../plan/registry.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { listSnapshots } from '../snapshot/store.ts';
import type { Shell } from '../types/remote.ts';
/** The shells `launch completion` supports, in the order help lists them; the first is the default fallback. */
export const SHELLS: readonly Shell[] = ['bash', 'zsh', 'fish'] as const;
/**
 * The marker comments that fence Launch's managed block inside a shell rc file. {@link installCompletion}
 * only ever rewrites the text between these lines, so re-running install replaces the block in place
 * instead of appending a duplicate - the same managed-region pattern `core/gitignore.ts` uses for
 * `.gitignore`. Editing or deleting the block by hand stays safe; the next install regenerates it.
 */
const BLOCK_START = '# launch-completion start';
/** Closing fence of Launch's managed completion block; see {@link BLOCK_START}. */
const BLOCK_END = '# launch-completion end';
/**
 * The hidden subcommand the generated scripts invoke on `<Tab>`. Kept here (not in the command file) so the
 * script generators and the command wiring share one token and can't drift. The leading `__` keeps it out
 * of the user-facing help and the docs.
 */
export const COMPLETE_SUBCOMMAND = '__complete';
/** Validate a raw `--shell`/positional value against {@link SHELLS}, with a pointed error listing the valid set. */
export type CompletionFailure = Readonly<{
  readonly _tag: 'CompletionFailure';
  readonly message: string;
  readonly cause?: unknown;
}>;
export function makeCompletionFailure(fields: {
  message: string;
  cause?: unknown;
}): CompletionFailure {
  if (fields.cause == null) {
    return { _tag: 'CompletionFailure', message: fields.message };
  }

  return { _tag: 'CompletionFailure', message: fields.message, cause: fields.cause };
}

export function parseShell(shellText: string): Shell {
  function isThisShell(knownShell: Shell): boolean {
    return knownShell == shellText;
  }

  const shell = SHELLS.find(isThisShell);

  if (shell == null) {
    throw makeCompletionFailure({
      message: `Unsupported shell "${shellText}". Use one of: ${SHELLS.join(', ')}.`,
    });
  }

  return shell;
}
/**
 * Best-effort detect the user's shell from `$SHELL` (e.g. `/bin/zsh` -> `zsh`), returning `undefined` when
 * it's unset or unrecognized so the caller can ask for an explicit `--shell`. Read from the environment
 * rather than spawning a process - there's no portable, shell-free way to ask "what shell am I in", and
 * `$SHELL` is the login shell every installer (rustup, nvm, brew) keys off.
 */
export const detectShell = (
  environmentVariables: Readonly<Record<string, string | undefined>>,
): Shell | undefined => {
  const shellPath = environmentVariables['SHELL'];
  if (!shellPath) return undefined;
  const shellName = shellPath.slice(shellPath.lastIndexOf('/') + 1);
  return SHELLS.find((shell) => shellName == shell);
};
/**
 * The bash completion script. On `<Tab>` it forwards the words from after `launch` up to and including the
 * word under the cursor to `launch completion __complete`, and feeds the newline-separated candidates back
 * through `compgen`, which filters them by the current prefix. The slice `[@]:1:COMP_CWORD` drops the
 * leading `launch` AND everything past the cursor, so {@link resolveCompletions} always sees the in-progress
 * word last - completing mid-line (not just at the end) resolves the correct token.
 */
export const bashCompletionScript = (): string => {
  return `# launch (bash) completion - eval with: source <(launch completion bash)
_launch_complete() {
  local words candidates
  words=("\${COMP_WORDS[@]:1:COMP_CWORD}")
  candidates="$(launch completion ${COMPLETE_SUBCOMMAND} -- "\${words[@]}" 2>/dev/null)"
  COMPREPLY=($(compgen -W "\${candidates}" -- "\${COMP_WORDS[COMP_CWORD]}"))
}
complete -o default -F _launch_complete launch
`;
};
/**
 * The zsh completion script. Uses zsh's native `compadd` over the same callback. `words[2,CURRENT]` drops
 * the leading `launch` and everything past the cursor; the `(@)` flag expands those words as SEPARATE
 * arguments (a plain `"$words[2,-1]"` would join them into one space-delimited string and break command-tree
 * descent for nested commands like `snapshot diff`). `${(@f)...}` then splits the callback output on
 * newlines back into the candidate array.
 */
export const zshCompletionScript = (): string => {
  return `# launch (zsh) completion - eval with: source <(launch completion zsh)
_launch_complete() {
  local -a candidates
  candidates=("\${(@f)$(launch completion ${COMPLETE_SUBCOMMAND} -- "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
  compadd -- $candidates
}
compdef _launch_complete launch
`;
};
/**
 * The fish completion script. fish re-evaluates the function on every keypress, so it passes the current
 * commandline tokens (minus the leading `launch`) to the callback and emits each candidate on its own line,
 * which fish offers directly. `-f` disables fish's default file completion so only Launch's candidates show.
 */
export const fishCompletionScript = (): string => {
  return `# launch (fish) completion - eval with: launch completion fish | source
function __launch_complete
  set -l tokens (commandline -opc) (commandline -ct)
  launch completion ${COMPLETE_SUBCOMMAND} -- $tokens[2..-1] 2>/dev/null
end
complete -c launch -f -a '(__launch_complete)'
`;
};
/** Map a shell to its script generator - the one place that fans `launch completion <shell>` out per shell. */
export const completionScript = (shell: Shell): string => {
  switch (shell) {
    case 'bash':
      return bashCompletionScript();
    case 'zsh':
      return zshCompletionScript();
    case 'fish':
      return fishCompletionScript();
  }
};
/* -------------------------------------------------------------------------- */
/*  Dynamic-value resolution - reuse the existing core loaders.                */
/* -------------------------------------------------------------------------- */
type CompletionCandidateSource = () => Promise<string[]>;

function pickAppName(app: { name: string }): string {
  return app.name;
}

function pickPlannerId(planner: { id: string }): string {
  return planner.id;
}

function pickSnapshotName(snapshot: { name: string }): string {
  return snapshot.name;
}

async function appHandles(): Promise<string[]> {
  const loaded = await loadConfig();

  return loaded.apps.map(pickAppName);
}

async function profileNames(): Promise<string[]> {
  const loaded = await loadConfig();

  return Object.keys(loaded.config.profiles);
}

async function planSurfaceIds(): Promise<string[]> {
  registerBuiltinPlanners();

  return listSurfacePlanners().map(pickPlannerId);
}

async function snapshotNames(): Promise<string[]> {
  const snapshots = await listSnapshots();

  return snapshots.map(pickSnapshotName);
}
/**
 * Flags whose VALUE has a dynamic candidate set, keyed by every spelling (short and long) so a match
 * on the preceding word resolves the right source. One table, so adding a new value-completing flag is a
 * single entry rather than a branch in the resolver.
 */
const flagSources: ReadonlyMap<string, CompletionCandidateSource> = new Map([
  ['-a', appHandles],
  ['--app', appHandles],
  ['-p', profileNames],
  ['--profile', profileNames],
]);
/**
 * Commands whose POSITIONAL argument has a dynamic candidate set, keyed by the command's full path after
 * `launch` (e.g. `plan`, `snapshot diff`). A second table beside {@link FLAG_SOURCES} so positional and
 * flag-value completion stay declarative and centralized.
 */
const argumentSources: ReadonlyMap<string, CompletionCandidateSource> = new Map([
  ['plan', planSurfaceIds],
  ['drift', planSurfaceIds],
  ['snapshot diff', snapshotNames],
  ['snapshot export', snapshotNames],
]);
/** Every option spelling a command accepts (short and long, e.g. `-a`, `--app`), for flag-name completion. */
const optionFlags = (command: Command): string[] => {
  return command.options.flatMap((option) =>
    [option.short, option.long].filter((flag): flag is string => !!flag),
  );
};
/**
 * Descend the commander tree to the deepest subcommand named by `words`, returning that command plus the
 * words consumed reaching it (its full path after `launch`). Stops at the first word that isn't a known
 * subcommand - that word and everything after it are arguments/flags of the resolved command.
 */
const descendCommandTree = (
  program: Command,
  words: readonly string[],
): {
  command: Command;
  commandPath: string[];
} => {
  let command = program;
  const commandPath: string[] = [];
  for (const word of words) {
    const matchingSubcommand = command.commands.find((candidate) => candidate.name() == word);
    if (!matchingSubcommand) break;
    command = matchingSubcommand;
    commandPath.push(word);
  }
  return { command, commandPath };
};
/**
 * Resolve the completion candidates for a partially-typed `launch` command line - the single operation the
 * hidden `__complete` callback runs on every `<Tab>`. `words` is the line after `launch` (including the
 * word being typed, which the shell itself filters against, so this returns the unfiltered candidate set).
 *
 * Precedence:
 *  1. typing a flag (`-...`) -> the resolved command's own flags;
 *  2. the previous word is a value-taking flag with a dynamic source -> that source's live values;
 *  3. the resolved command takes a dynamic positional and none has been supplied yet -> that source's values;
 *  4. otherwise -> the resolved command's subcommand names plus its flags.
 *
 * Never throws: a failed config/snapshot read degrades to the static candidates so completion still works
 * without a `launch.config.ts` present.
 */
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
  return subcommand.name();
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

export async function resolveCompletions(words: string[], program: Command): Promise<string[]> {
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

  const flagCandidates = await readFlagCandidates(readEarlierWord(words));

  if (flagCandidates != null) {
    return flagCandidates;
  }

  const argumentSource = argumentSources.get(descended.commandPath.join(' '));

  if (argumentSource == null) {
    return listStaticCompletionCandidates(descended.command);
  }

  const positionalIsFilled = hasPositional(
    words,
    descended.commandPath.length,
    valueTakingFlags(descended.command),
  );

  if (positionalIsFilled) {
    return listStaticCompletionCandidates(descended.command);
  }

  return readCompletionCandidates(argumentSource);
}
/**
 * Every option spelling (short + long) on the resolved command or its ancestors that takes a VALUE
 * (declared `<x>` or `[x]`). Used to tell a flag's value apart from a real positional argument - without it,
 * the token after `--app` would be miscounted as a positional and wrongly close the dynamic positional slot.
 */
const valueTakingFlags = (command: Command): Set<string> => {
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
};
/**
 * Whether a real positional argument has already been supplied to the resolved command. Walks the words
 * after the command path (excluding the in-progress word), skipping flags and the VALUE that follows a
 * value-taking flag - so `plan --app web <Tab>` still completes the `[surface]` positional, while
 * `plan catalog <Tab>` correctly sees the slot as filled.
 */
const hasPositional = (
  words: string[],
  pathLength: number,
  valueFlags: ReadonlySet<string>,
): boolean => {
  const afterCommand = words.slice(pathLength, -1); // drop the command path and the in-progress word
  for (const [i, word] of afterCommand.entries()) {
    if (word.startsWith('-')) continue; // a flag, not a positional
    let previousWord: string | undefined;
    if (i > 0) previousWord = afterCommand[i - 1];
    if (previousWord != null && valueFlags.has(previousWord)) continue;
    return true;
  }
  return false;
};
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
const completionSourceLine = (shell: Shell): string => {
  if (shell == 'fish') return 'launch completion fish | source';
  return `source <(launch completion ${shell})`;
};
/**
 * The outcome of an {@link installCompletion} attempt. A discriminated union so the command can render the
 * right message without re-deriving state: `installed` when the rc file was written/updated, `manual` when
 * Launch couldn't safely edit it (e.g. the rc file's directory doesn't exist) and the user should add the
 * line themselves.
 */
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
/**
 * Build the managed block (fences + the source line) for a shell - the exact text written between
 * {@link BLOCK_START} and {@link BLOCK_END}. Pure, so the install logic and its tests share one definition.
 */
export const managedBlock = (shell: Shell): string => {
  return `${BLOCK_START}\n${completionSourceLine(shell)}\n${BLOCK_END}`;
};
/**
 * Splice the managed block into existing rc-file contents idempotently: replace an existing
 * {@link BLOCK_START}...{@link BLOCK_END} region in place, or append a fresh one. Returns the new contents and
 * whether a block was replaced. Pure string surgery - the disk I/O lives in {@link installCompletion} - so
 * the idempotency (running twice yields the same file) is unit-testable without a filesystem.
 */
export const spliceManagedBlock = (
  existing: string,
  block: string,
): {
  contents: string;
  updated: boolean;
} => {
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
};
/**
 * Wire Launch's completion into the resolved shell's rc file, idempotently. Replaces any existing managed
 * block (so re-running never duplicates the source line) or appends one. When the rc file's parent directory
 * doesn't exist (so creating the file would be a surprise - e.g. fish without `~/.config/fish`), returns a
 * `manual` result with the exact line to add instead of silently creating directories.
 *
 * Only ever writes the user's own shell rc file - never a secret and never anything under `~/.launch`.
 */
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
    throw makeCompletionFailure({
      message: 'Could not detect your shell. Re-run with --shell bash|zsh|fish.',
    });
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
    throw makeCompletionFailure({
      message: `Could not install completion in ${rcFile}.`,
      cause,
    });
  }
}
