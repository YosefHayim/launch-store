import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from '../cli/command.ts';
import { resetLaunchEnvironment, useLaunchEnvironment } from '../services/platform/environment.ts';
import { readLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import {
  COMPLETE_SUBCOMMAND,
  SHELLS,
  bashCompletionScript,
  completionScript,
  detectShell,
  fishCompletionScript,
  installCompletion,
  type InstallOptions,
  type InstallResult,
  managedBlock,
  parseShell,
  resolveCompletions,
  spliceManagedBlock,
  zshCompletionScript,
} from './completion.ts';
import { expectDefined } from '../testkit/assertions-testkit.ts';
const tempDirs: string[] = [];
async function runInstallCompletion(installOptions: InstallOptions): Promise<InstallResult> {
  useLaunchEnvironment({});

  try {
    return await installCompletion(installOptions);
  } finally {
    resetLaunchEnvironment();
  }
}
async function runCompletionResolution(words: string[], program: Command): Promise<string[]> {
  const previousDirectories = readLaunchDirectories();
  useLaunchDirectories({
    homeDirectory: '/tmp',
    workingDirectory: process.cwd(),
  });

  try {
    return await resolveCompletions(words, program);
  } finally {
    useLaunchDirectories(previousDirectories);
  }
}
/** A throwaway directory cleaned up after each test. */
const makeDir = (prefix: string): string => {
  const systemTemporaryDirectory = tmpdir();
  const joinedPath = join(systemTemporaryDirectory, prefix);
  const dir = mkdtempSync(joinedPath);
  tempDirs.push(dir);
  return dir;
};
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(expectDefined(tempDirs.pop(), 'temp dir'), { recursive: true, force: true });
  }
});
describe('parseShell', () => {
  it('accepts every supported shell', () => {
    for (const shell of SHELLS) expect(parseShell(shell)).toBe(shell);
  });
  it('rejects an unsupported shell with the valid list', () => {
    let unsupportedShell: unknown = null;
    try {
      parseShell('powershell');
    } catch (cause) {
      unsupportedShell = cause;
    }
    expect(unsupportedShell).toMatchObject({
      message: expect.stringContaining('Unsupported shell "powershell"'),
    });
  });
});
describe('detectShell', () => {
  it('reads the shell basename out of $SHELL', () => {
    const shell = detectShell({ SHELL: '/bin/zsh' });
    expect(shell).toBe('zsh');
    expect(detectShell({ SHELL: '/usr/local/bin/fish' })).toBe('fish');
    expect(detectShell({ SHELL: '/bin/bash' })).toBe('bash');
  });
  it('returns undefined when $SHELL is unset or unrecognized', () => {
    const shell = detectShell({});
    expect(shell).toBeUndefined();
    expect(detectShell({ SHELL: '/bin/csh' })).toBeUndefined();
  });
});
describe('completion scripts', () => {
  it('dispatches to the matching per-shell generator', () => {
    expect(completionScript('bash')).toBe(bashCompletionScript());
    expect(completionScript('zsh')).toBe(zshCompletionScript());
    expect(completionScript('fish')).toBe(fishCompletionScript());
  });
  it('each script calls back into the hidden __complete subcommand', () => {
    for (const shell of SHELLS) {
      expect(completionScript(shell)).toContain(`launch completion ${COMPLETE_SUBCOMMAND}`);
    }
  });
  it('bash registers a completion function for launch and slices words to the cursor', () => {
    const script = bashCompletionScript();
    expect(script).toContain('complete -o default -F _launch_complete launch');
    expect(script).toContain('compgen -W');
    // slice to COMP_CWORD so mid-line completion resolves the word under the cursor, not the last word
    expect(script).toContain('COMP_WORDS[@]:1:COMP_CWORD');
  });
  it('zsh wires compdef and passes the words up to the cursor as separate arguments', () => {
    const script = zshCompletionScript();
    expect(script).toContain('compdef _launch_complete launch');
    expect(script).toContain('compadd');
    // (@) keeps each token a separate arg (a joined string breaks nested-command descent); slice to CURRENT
    expect(script).toContain('(@)words[2,CURRENT]');
  });
  it('fish disables file completion and feeds candidates from the callback', () => {
    const script = fishCompletionScript();
    expect(script).toContain('complete -c launch -f -a');
    expect(script).toContain('commandline');
  });
});
describe('spliceManagedBlock (idempotency)', () => {
  it('appends a fresh block when none exists', () => {
    const { contents, updated } = spliceManagedBlock('export PATH=/x\n', managedBlock('zsh'));
    expect(updated).toBe(false);
    expect(contents).toContain('# launch-completion start');
    expect(contents).toContain('source <(launch completion zsh)');
    expect(contents.startsWith('export PATH=/x\n')).toBe(true);
  });
  it('replaces an existing block in place rather than duplicating it', () => {
    const once = spliceManagedBlock('export PATH=/x\n', managedBlock('zsh')).contents;
    const twice = spliceManagedBlock(once, managedBlock('zsh'));
    expect(twice.updated).toBe(true);
    expect(twice.contents).toBe(once);
    const occurrences = twice.contents.match(/# launch-completion start/g)?.length;
    expect(occurrences).toBe(1);
  });
  it('preserves user content surrounding the managed block', () => {
    const original =
      'alias g=git\n# launch-completion start\nOLD\n# launch-completion end\nexport EDITOR=vim\n';
    const { contents } = spliceManagedBlock(original, managedBlock('bash'));
    expect(contents).toContain('alias g=git');
    expect(contents).toContain('export EDITOR=vim');
    expect(contents).not.toContain('OLD');
    expect(contents).toContain('source <(launch completion bash)');
  });
});
describe('installCompletion', () => {
  it('writes the managed block into the shell rc file', async () => {
    const home = makeDir('launch-completion-home-');
    const installOutcome = await runInstallCompletion({ shell: 'zsh', home });
    expect(installOutcome.status).toBe('installed');
    if (installOutcome.status != 'installed') throw new Error('expected installed');
    expect(installOutcome.updated).toBe(false);
    const loadedFile = readFileSync(installOutcome.rcFile, 'utf8');
    expect(loadedFile).toContain('source <(launch completion zsh)');
  });
  it('is idempotent - re-running yields the identical rc file with no duplicate line', async () => {
    const home = makeDir('launch-completion-home-');
    await runInstallCompletion({ shell: 'bash', home });
    const joinedPath = join(home, '.bashrc');
    const first = readFileSync(joinedPath, 'utf8');
    const second = await runInstallCompletion({ shell: 'bash', home });
    expect(second.status).toBe('installed');
    if (second.status != 'installed') throw new Error('expected installed');
    expect(second.updated).toBe(true);
    const after = readFileSync(second.rcFile, 'utf8');
    expect(after).toBe(first);
    expect(after.match(/launch completion bash/g)?.length).toBe(1);
  });
  it('preserves existing rc-file content when adding the block', async () => {
    const home = makeDir('launch-completion-home-');
    const joinedPath = join(home, '.zshrc');
    writeFileSync(joinedPath, "alias ll='ls -la'\n");
    await runInstallCompletion({ shell: 'zsh', home });
    const after = readFileSync(join(home, '.zshrc'), 'utf8');
    expect(after).toContain("alias ll='ls -la'");
    expect(after).toContain('# launch-completion start');
  });
  it('falls back to manual steps when the rc directory does not exist (fish without ~/.config/fish)', async () => {
    const home = makeDir('launch-completion-home-');
    const installOutcome = await runInstallCompletion({ shell: 'fish', home });
    expect(installOutcome.status).toBe('manual');
    if (installOutcome.status != 'manual') throw new Error('expected manual');
    expect(installOutcome.line).toBe('launch completion fish | source');
  });
  it('installs fish when its config directory already exists', async () => {
    const home = makeDir('launch-completion-home-');
    const fishPath = join(home, '.config', 'fish');
    mkdirSync(fishPath, { recursive: true });
    const installOutcome = await runInstallCompletion({ shell: 'fish', home });
    expect(installOutcome.status).toBe('installed');
    if (installOutcome.status != 'installed') throw new Error('expected installed');
    const loadedFile = readFileSync(installOutcome.rcFile, 'utf8');
    expect(loadedFile).toContain('launch completion fish | source');
  });
  it('throws when no shell is given and none can be detected', async () => {
    const home = makeDir('launch-completion-home-');
    await expect(runInstallCompletion({ home })).rejects.toMatchObject({
      _tag: 'CompletionFailure',
      message: expect.stringContaining('Could not detect your shell'),
    });
  });
});
describe('resolveCompletions (the __complete callback)', () => {
  /** A miniature program that exercises every routing branch without the full CLI surface. */
  const program = (): Command => {
    const root = new Command();
    root
      .command('build')
      .option('-p, --profile <name>', 'build profile')
      .option('--clean', 'force clean');
    root.command('plan [surface]').option('-a, --app <names>', 'app handles');
    const snapshot = root.command('snapshot');
    snapshot.command('diff <baseline> [against]');
    return root;
  };
  it('completes top-level command names at the root', async () => {
    const candidates = await runCompletionResolution([], program());
    expect(candidates).toContain('build');
    expect(candidates).toContain('plan');
    expect(candidates).toContain('snapshot');
  });
  it("completes a command's flags when the current word starts with a dash", async () => {
    const candidates = await runCompletionResolution(['build', '-'], program());
    expect(candidates).toEqual(expect.arrayContaining(['-p', '--profile', '--clean']));
  });
  it('completes subcommands of a command group', async () => {
    const candidates = await runCompletionResolution(['snapshot', ''], program());
    expect(candidates).toContain('diff');
  });
  it('resolves -p/--profile values from the loaded config', async () => {
    const repo = makeDir('launch-completion-repo-');
    const launchPath = join(repo, 'launch.config.ts');
    writeFileSync(
      launchPath,
      `import { defineConfig } from "launch-store";\nexport default defineConfig({ profiles: { production: { name: "production" }, preview: { name: "preview" } } });\n`,
    );
    const saved = process.cwd();
    process.chdir(repo);
    try {
      const candidates = await runCompletionResolution(['build', '--profile', ''], program());
      expect(candidates.sort()).toEqual(['preview', 'production']);
    } finally {
      process.chdir(saved);
    }
  });
  it('resolves -a/--app values from discovered apps', async () => {
    const repo = makeDir('launch-completion-repo-');
    const launchPath = join(repo, 'launch.config.ts');
    writeFileSync(
      launchPath,
      `import { defineConfig } from "launch-store";\nexport default defineConfig({ profiles: { production: { name: "production" } } });\n`,
    );
    const atlasPath = join(repo, 'apps', 'atlas');
    mkdirSync(atlasPath, { recursive: true });
    const appPath = join(repo, 'apps', 'atlas', 'app.json');
    const serialized = JSON.stringify({ expo: { slug: 'atlas' } });
    writeFileSync(appPath, serialized);
    const saved = process.cwd();
    process.chdir(repo);
    try {
      const candidates = await runCompletionResolution(['plan', '-a', ''], program());
      expect(candidates).toContain('atlas');
    } finally {
      process.chdir(saved);
    }
  });
  it('resolves the plan [surface] positional from the planner registry', async () => {
    const candidates = await runCompletionResolution(['plan', ''], program());
    expect(candidates).toContain('catalog');
    expect(candidates).toContain('listing');
  });
  it('does not re-complete a positional once it has been supplied', async () => {
    const candidates = await runCompletionResolution(['plan', 'catalog', ''], program());
    // The surface slot is filled, so we fall through to subcommands/flags (none -> flags only here).
    expect(candidates).not.toContain('listing');
    expect(candidates).toContain('--app');
  });
  it('still completes the positional after a value-taking flag and its value', async () => {
    // `--app atlas` is a flag and its value, not a positional - the [surface] slot must stay open.
    const candidates = await runCompletionResolution(['plan', '--app', 'atlas', ''], program());
    expect(candidates).toContain('catalog');
    expect(candidates).toContain('listing');
  });
  it('never throws when there is no launch.config.ts - falls back to the default profile', async () => {
    const repo = makeDir('launch-completion-empty-');
    const saved = process.cwd();
    process.chdir(repo);
    try {
      const candidates = await runCompletionResolution(['build', '--profile', ''], program());
      expect(candidates).toEqual(['production']); // loadConfig's DEFAULT_CONFIG profile
    } finally {
      process.chdir(saved);
    }
  });
});
