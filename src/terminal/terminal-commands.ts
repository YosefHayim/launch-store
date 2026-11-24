// Registers and runs the explain, open, and completion commands.

import type { Command } from '../cli/command.ts';
import { stdout } from 'node:process';
import { runCliProgram } from '../cli/run-cli-program.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import type { Shell } from '../types/remote.ts';
import {
  COMPLETE_SUBCOMMAND,
  completionScript,
  detectShell,
  installCompletion,
  parseShell,
  readCompletions,
  SHELLS,
} from './completion.ts';
import { ConsoleLinks } from './console-links.ts';
import { explainTopic, isExplainTerm, listTopics } from './explain-terms.ts';

export interface OpenCommandInput {
  target?: string;
  platform?: string;
  app?: string;
}

interface OpenFlagChoice {
  platform?: string;
  app?: string;
}

type CompletionCommandInput =
  | Readonly<{ operation: 'install'; shell: string | undefined }>
  | Readonly<{ operation: 'script'; shell: string | undefined }>
  | Readonly<{ operation: 'complete'; words: readonly string[]; commandTree: Command }>;

export class TerminalCommands {
  registerExplain(program: Command): void {
    const terminalCommands = this;

    function runExplain(topic?: string): Promise<void> {
      const commandInput: { topic?: string } = {};

      if (typeof topic == 'string') {
        commandInput.topic = topic;
      }

      async function startExplain(): Promise<void> {
        terminalCommands.explain(commandInput);
      }

      const startedExplain = startExplain();

      return runCliProgram(startedExplain);
    }

    program
      .command('explain')
      .description(
        'plain-English terms for an Apple or iOS word (csr, app-record, provisioning-profile)',
      )
      .argument('[topic]', 'a term to explain, for example provisioning-profile')
      .action(runExplain);
  }

  registerOpen(program: Command): void {
    const terminalCommands = this;

    function runOpen(target: string | undefined, openFlags: OpenFlagChoice): Promise<void> {
      let commandInput: OpenCommandInput = {};

      if (target != null) {
        commandInput = { ...commandInput, target };
      }

      if (openFlags.platform != null) {
        commandInput = { ...commandInput, platform: openFlags.platform };
      }

      if (openFlags.app != null) {
        commandInput = { ...commandInput, app: openFlags.app };
      }

      const openProgram = terminalCommands.open(commandInput);

      return runCliProgram(openProgram);
    }

    const knownTargets = new ConsoleLinks().openTargets.join(' | ');

    program
      .command('open')
      .description("deep-link the app's App Store Connect / Play Console page in your browser")
      .argument('[target]', `what to open: ${knownTargets} (default: asc)`)
      .option(
        '--platform <platform>',
        'ios/tvos/macos/visionos (App Store Connect) or android (Play Console)',
      )
      .option('-a, --app <name>', 'app handle to open (default: the first app for the platform)')
      .action(runOpen);
  }

  registerCompletion(program: Command): void {
    const terminalCommands = this;
    const completion = program
      .command('completion')
      .description(
        'shell tab-completion for commands, flags, app handles, profiles, surfaces, and snapshots',
      );

    function runInstall(installFlags: { shell?: string }): Promise<void> {
      const completionProgram = terminalCommands.complete({
        operation: 'install',
        shell: installFlags.shell,
      });

      return runCliProgram(completionProgram);
    }

    completion
      .command('install')
      .description(
        "wire completion into your shell's rc file (idempotent), or print the manual step",
      )
      .option('-s, --shell <shell>', `shell to wire up: ${SHELLS.join(' | ')} (default: $SHELL)`)
      .action(runInstall);

    function printScript(shell: string | undefined): Promise<void> {
      const completionProgram = terminalCommands.complete({ operation: 'script', shell });

      return runCliProgram(completionProgram);
    }

    completion
      .argument('[shell]', `print the completion script: ${SHELLS.join(' | ')} (default: $SHELL)`)
      .action(printScript);

    function printCandidates(words: readonly string[]): Promise<void> {
      const completionProgram = terminalCommands.complete({
        operation: 'complete',
        words,
        commandTree: program,
      });

      return runCliProgram(completionProgram);
    }

    completion
      .command(`${COMPLETE_SUBCOMMAND} [words...]`, { hidden: true })
      .description('internal: emit completion candidates for the words typed so far')
      .action(printCandidates);
  }

  explain(rawCommandInput: unknown): void {
    const topic = this.readExplainTopic(rawCommandInput);
    const logger = createLogger(false);

    if (topic == null) {
      logger.line(`Topics: ${listTopics().join(', ')}`);
      return;
    }

    if (isExplainTerm(topic)) {
      logger.line(explainTopic(topic));
      return;
    }

    const knownTopics = listTopics().join(', ');

    throw new Error(`Unknown topic "${topic}". Known topics: ${knownTopics}`);
  }

  readOpenCommandInput(rawCommandInput: unknown): OpenCommandInput {
    const commandFields = readPlainObject(rawCommandInput);

    if (commandFields == null) {
      throw new Error('Could not read the open command.');
    }

    const commandInput: OpenCommandInput = {};
    const target = this.readOptionalText(commandFields, 'target');

    if (target != null) {
      commandInput.target = target;
    }

    const platform = this.readOptionalText(commandFields, 'platform');

    if (platform != null) {
      commandInput.platform = platform;
    }

    const appText = this.readOptionalText(commandFields, 'app');

    if (appText != null) {
      commandInput.app = appText;
    }

    return commandInput;
  }

  async open(rawCommandInput: unknown): Promise<void> {
    try {
      const commandInput = this.readOpenCommandInput(rawCommandInput);
      const openChoice: { platform?: string; app?: string } = {};

      if (commandInput.platform != null) {
        openChoice.platform = commandInput.platform;
      }

      if (commandInput.app != null) {
        openChoice.app = commandInput.app;
      }

      const consoleLinks = new ConsoleLinks();
      const consoleUrl = await consoleLinks.readOpenUrl(commandInput.target, openChoice);
      const logger = createLogger(false);

      logger.line(`Opening ${consoleUrl}`);
      await consoleLinks.openUrl(consoleUrl);
    } catch (cause) {
      const failureMessage = errorMessage(cause);

      throw new Error(failureMessage, { cause });
    }
  }

  private readExplainTopic(rawCommandInput: unknown): string | null {
    const commandFields = readPlainObject(rawCommandInput);

    if (commandFields == null) {
      throw new Error('Could not run the explain command.');
    }

    const topicIsPresent = Object.hasOwn(commandFields, 'topic');

    if (!topicIsPresent) {
      return null;
    }

    const topic = commandFields['topic'];

    if (typeof topic == 'string') {
      return topic;
    }

    if (topic == null) {
      return null;
    }

    throw new Error('Could not run the explain command.');
  }

  private readOptionalText(
    commandFields: Record<string, unknown>,
    fieldName: string,
  ): string | null {
    const fieldIsPresent = Object.hasOwn(commandFields, fieldName);

    if (!fieldIsPresent) {
      return null;
    }

    const fieldText = commandFields[fieldName];

    if (typeof fieldText == 'string') {
      return fieldText;
    }

    throw new Error('Could not read the open command.');
  }

  private readShell(shellText: string | undefined): Shell {
    if (shellText != null) {
      return parseShell(shellText);
    }

    const launchEnvironment = readLaunchEnvironment();
    const detectedShell = detectShell(launchEnvironment.rawVariables);

    if (detectedShell != null) {
      return detectedShell;
    }

    throw new Error('Could not detect your shell. Pass one explicitly: bash, zsh, or fish.');
  }

  private async showInstallOutcome(shellText: string | undefined): Promise<void> {
    const logger = createLogger(false);
    const shell = this.readShell(shellText);
    const installOutcome = await installCompletion({ shell });

    if (installOutcome.status == 'manual') {
      logger.warn(`Could not edit ${installOutcome.rcFile} - its directory does not exist yet.`);

      const shellName = installOutcome.shell;
      const sourceLine = installOutcome.line;
      const manualLine = `Add this line to your ${shellName} config, then restart your shell: ${sourceLine}`;

      logger.tip(manualLine);

      return;
    }

    let installVerb = 'installed';
    const didUpdateExistingBlock = installOutcome.updated;

    if (didUpdateExistingBlock) {
      installVerb = 'updated';
    }

    const installDetail = `${installVerb} for ${installOutcome.shell} in ${installOutcome.rcFile}`;

    logger.step('completion', installDetail);
    logger.tip('Restart your shell (or source the rc file) to activate it.');
  }

  private async printCompletionScript(shellText: string | undefined): Promise<void> {
    const shell = this.readShell(shellText);

    stdout.write(completionScript(shell));
  }

  private async printCompletionCandidates(
    words: readonly string[],
    commandTree: Command,
  ): Promise<void> {
    const candidates = await readCompletions([...words], commandTree);

    stdout.write(`${candidates.join('\n')}\n`);
  }

  private async complete(commandInput: CompletionCommandInput): Promise<void> {
    switch (commandInput.operation) {
      case 'install':
        await this.showInstallOutcome(commandInput.shell);
        return;
      case 'script':
        await this.printCompletionScript(commandInput.shell);
        return;
      case 'complete':
        await this.printCompletionCandidates(commandInput.words, commandInput.commandTree);
        return;
    }
  }
}
