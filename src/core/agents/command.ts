import { FileSystem, Path, Terminal } from '@effect/platform';
import { Context, Data, Effect } from 'effect';
import type { InstalledMcpServer, McpClient } from '../mcp/install.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import { completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { AgentTarget, ConsumerSkill, GeneratedAgentFile } from '../types/agents.js';
import { CONSUMER_SKILLS } from './registry.js';
import {
  MANAGED_END,
  MANAGED_START,
  renderAgentsBlock,
  renderAmazonQBaseRule,
  renderAmazonQTaskRule,
  renderClaudeMemoryBlock,
  renderClaudeSkillFiles,
  renderClineBaseRule,
  renderClineTaskRule,
  renderCopilotBlock,
  renderCursorBaseRule,
  renderCursorTaskRule,
  renderKiroSteering,
  renderWindsurfBaseRule,
  renderWindsurfTaskRule,
  spliceManagedBlock,
} from './render.js';
import { findUnknownCommands, type RegisteredCommand } from './validate.js';

/** The coding-agent targets supported by `launch agents`, in display order. */
export const AGENT_TARGETS: readonly AgentTarget[] = [
  'claude',
  'cursor',
  'codex',
  'windsurf',
  'copilot',
  'kiro',
  'cline',
  'amazonq',
];

/** Short picker label for each supported coding-agent target. */
export const AGENT_TARGET_LABELS: Readonly<Record<AgentTarget, string>> = {
  claude: 'Claude    (.claude/skills + CLAUDE.md)',
  cursor: 'Cursor    (.cursor/rules)',
  codex: 'Codex     (AGENTS.md)',
  windsurf: 'Windsurf  (.windsurf/rules)',
  copilot: 'Copilot   (.github/copilot-instructions.md)',
  kiro: 'Kiro      (.kiro/steering)',
  cline: 'Cline     (.cline/rules)',
  amazonq: 'Amazon Q  (.amazonq/rules)',
};

/** One generated artifact, either fully owned or spliced into a shared document. */
export type AgentArtifact =
  | { readonly kind: 'owned'; readonly path: string; readonly content: string }
  | { readonly kind: 'spliced'; readonly path: string; readonly block: string };

/** CLI options shared by the `agents init` and `agents check` programs. */
export type AgentsCommandOptions = {
  readonly agent?: string;
  readonly yes?: boolean;
};

/** Input selecting which agents subcommand the shared program runs. */
export type AgentsCommandInput = Readonly<{
  readonly mode: 'init' | 'check';
  readonly launchVersion: string | undefined;
  readonly registeredCli: RegisteredCommand;
  readonly options: AgentsCommandOptions;
}>;

/** Agent command input, prompt, filesystem, or MCP setup failed. */
export type AgentsCommandFailure = Readonly<{
  readonly _tag: 'AgentsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;
export const makeAgentsCommandFailure = Data.tagged<AgentsCommandFailure>('AgentsCommandFailure');

/** Domain adapter for generated agent MCP registrations. */
export type AgentsCommandService = Readonly<{
  readonly installMcpServer: (
    mcpClient: McpClient,
    repositoryPath: string,
  ) => Effect.Effect<InstalledMcpServer, AgentsCommandFailure>;
  readonly mcpConfigPath: (mcpClient: McpClient, repositoryPath: string) => string;
}>;

/** Injectable command boundary for the agents family. */
export const AgentsCommandService = Context.GenericTag<AgentsCommandService>(
  'launch-store/AgentsCommand',
);

type AgentsCommandRequirements =
  | AgentsCommandService
  | FileSystem.FileSystem
  | LaunchPathsService
  | LaunchPromptService
  | Logger
  | Path.Path
  | Terminal.Terminal;

/** Narrow a text token to a supported coding-agent target. */
export const isAgentTarget = (candidate: string): candidate is AgentTarget => {
  switch (candidate) {
    case 'claude':
    case 'cursor':
    case 'codex':
    case 'windsurf':
    case 'copilot':
    case 'kiro':
    case 'cline':
    case 'amazonq':
      return true;
    default:
      return false;
  }
};

/** Map a platform or prompt failure into the agents command channel. */
const agentsFailure = (operation: string, cause: unknown): AgentsCommandFailure => {
  let message = `${operation} failed.`;
  if (cause instanceof Error) message = cause.message;
  return makeAgentsCommandFailure({ operation, message, cause });
};

/** Convert a rendered file into a fully-owned artifact write. */
export const ownedAgentArtifact = (generatedFile: GeneratedAgentFile): AgentArtifact => ({
  kind: 'owned',
  path: generatedFile.path,
  content: generatedFile.body,
});

/** Plan base + per-skill task rules for rule-file agent targets. */
export const planBaseAndTaskArtifacts = (
  launchVersion: string,
  renderBase: (version: string) => GeneratedAgentFile,
  renderTask: (skill: ConsumerSkill, version: string) => GeneratedAgentFile,
): AgentArtifact[] => {
  const plannedArtifacts: AgentArtifact[] = [ownedAgentArtifact(renderBase(launchVersion))];
  for (const consumerSkill of CONSUMER_SKILLS) {
    plannedArtifacts.push(ownedAgentArtifact(renderTask(consumerSkill, launchVersion)));
  }
  return plannedArtifacts;
};

/** Detect coding-agent footprints already present in a repository. */
export const detectAgentTargets = (
  repositoryPath: string,
): Effect.Effect<AgentTarget[], AgentsCommandFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const pathExists = (relativePath: string) =>
      fileSystem.exists(pathService.join(repositoryPath, relativePath));
    const anyPathExists = (relativePaths: readonly string[]) =>
      Effect.gen(function* () {
        for (const relativePath of relativePaths) {
          if (yield* pathExists(relativePath)) return true;
        }
        return false;
      });
    const detectedTargets: AgentTarget[] = [];
    if (yield* anyPathExists(['.claude', 'CLAUDE.md'])) detectedTargets.push('claude');
    if (yield* anyPathExists(['.cursor', '.cursorrules'])) detectedTargets.push('cursor');
    if (yield* anyPathExists(['AGENTS.md', '.codex'])) detectedTargets.push('codex');
    if (yield* anyPathExists(['.windsurf', '.windsurfrules'])) detectedTargets.push('windsurf');
    if (yield* pathExists('.github/copilot-instructions.md')) detectedTargets.push('copilot');
    if (yield* pathExists('.kiro')) detectedTargets.push('kiro');
    if (yield* anyPathExists(['.cline', '.clinerules'])) detectedTargets.push('cline');
    if (yield* pathExists('.amazonq')) detectedTargets.push('amazonq');
    return detectedTargets;
  }).pipe(Effect.mapError((cause) => agentsFailure('detect agent files', cause)));

/** Write owned files and splice managed blocks for an agent artifact plan. */
export const writeAgentArtifacts = (
  repositoryPath: string,
  artifacts: readonly AgentArtifact[],
): Effect.Effect<void, AgentsCommandFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    for (const artifact of artifacts) {
      const artifactPath = pathService.join(repositoryPath, artifact.path);
      yield* fileSystem.makeDirectory(pathService.dirname(artifactPath), { recursive: true });
      if (artifact.kind === 'owned') {
        yield* fileSystem.writeFileString(artifactPath, artifact.content);
        continue;
      }
      let existingContent = '';
      if (yield* fileSystem.exists(artifactPath)) {
        existingContent = yield* fileSystem.readFileString(artifactPath);
      }
      yield* fileSystem.writeFileString(
        artifactPath,
        spliceManagedBlock(existingContent, artifact.block),
      );
    }
  }).pipe(Effect.mapError((cause) => agentsFailure('write agent files', cause)));

/** Whether on-disk content matches the planned managed block for a spliced artifact. */
export const managedBlockIsCurrent = (
  currentContent: string,
  plannedBlock: string,
): 'missing-block' | 'stale' | 'current' => {
  const managedStart = currentContent.indexOf(MANAGED_START);
  const managedEnd = currentContent.indexOf(MANAGED_END);
  if (managedStart === -1) return 'missing-block';
  if (managedEnd === -1) return 'missing-block';
  const managedContent = currentContent.slice(managedStart, managedEnd + MANAGED_END.length);
  if (managedContent !== plannedBlock) return 'stale';
  return 'current';
};

/** Return planned agent artifacts that are missing or differ from a fresh render. */
export const findStaleAgentArtifacts = (
  repositoryPath: string,
  artifacts: readonly AgentArtifact[],
): Effect.Effect<string[], AgentsCommandFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const staleArtifactPaths: string[] = [];
    for (const artifact of artifacts) {
      const artifactPath = pathService.join(repositoryPath, artifact.path);
      if (!(yield* fileSystem.exists(artifactPath))) {
        staleArtifactPaths.push(`${artifact.path} (missing)`);
        continue;
      }
      const currentContent = yield* fileSystem.readFileString(artifactPath);
      if (artifact.kind === 'owned') {
        if (currentContent !== artifact.content) staleArtifactPaths.push(artifact.path);
        continue;
      }
      const managedStatus = managedBlockIsCurrent(currentContent, artifact.block);
      if (managedStatus === 'missing-block') {
        staleArtifactPaths.push(`${artifact.path} (no Launch block)`);
        continue;
      }
      if (managedStatus === 'stale') staleArtifactPaths.push(artifact.path);
    }
    return staleArtifactPaths;
  }).pipe(Effect.mapError((cause) => agentsFailure('check agent files', cause)));

/** Decode an explicit `--agent` value into a unique supported target list. */
export const parseAgentFlag = (
  agentFlag: string,
): Effect.Effect<AgentTarget[], AgentsCommandFailure> =>
  Effect.gen(function* () {
    const agentTokens = agentFlag
      .split(',')
      .map((agentToken) => agentToken.trim().toLowerCase())
      .filter((agentToken) => agentToken !== '');
    if (agentTokens.includes('all')) return [...AGENT_TARGETS];
    const selectedTargets: AgentTarget[] = [];
    for (const agentToken of agentTokens) {
      if (!isAgentTarget(agentToken)) {
        return yield* Effect.fail(
          makeAgentsCommandFailure({
            operation: 'parse --agent',
            message: `Unknown agent "${agentToken}". Use claude, cursor, codex, windsurf, copilot, kiro, cline, amazonq, or all.`,
          }),
        );
      }
      if (!selectedTargets.includes(agentToken)) selectedTargets.push(agentToken);
    }
    return selectedTargets;
  });

/** Build every artifact required for the selected coding agents. */
export const planAgentArtifacts = (
  targets: readonly AgentTarget[],
  launchVersion: string,
): AgentArtifact[] => {
  const wantsClaude = targets.includes('claude');
  const wantsCodex = targets.includes('codex');
  const plannedArtifacts: AgentArtifact[] = [];
  let needsAgentsMarkdown = false;
  if (wantsClaude) needsAgentsMarkdown = true;
  if (wantsCodex) needsAgentsMarkdown = true;
  if (needsAgentsMarkdown) {
    plannedArtifacts.push({
      kind: 'spliced',
      path: 'AGENTS.md',
      block: renderAgentsBlock(launchVersion),
    });
  }
  if (wantsClaude) {
    plannedArtifacts.push({
      kind: 'spliced',
      path: 'CLAUDE.md',
      block: renderClaudeMemoryBlock(launchVersion),
    });
    for (const consumerSkill of CONSUMER_SKILLS) {
      for (const renderedFile of renderClaudeSkillFiles(consumerSkill, launchVersion)) {
        plannedArtifacts.push(ownedAgentArtifact(renderedFile));
      }
    }
  }
  if (targets.includes('cursor')) {
    plannedArtifacts.push(
      ...planBaseAndTaskArtifacts(launchVersion, renderCursorBaseRule, renderCursorTaskRule),
    );
  }
  if (targets.includes('windsurf')) {
    plannedArtifacts.push(
      ...planBaseAndTaskArtifacts(launchVersion, renderWindsurfBaseRule, renderWindsurfTaskRule),
    );
  }
  if (targets.includes('copilot')) {
    plannedArtifacts.push({
      kind: 'spliced',
      path: '.github/copilot-instructions.md',
      block: renderCopilotBlock(launchVersion),
    });
  }
  if (targets.includes('kiro')) {
    plannedArtifacts.push(ownedAgentArtifact(renderKiroSteering(launchVersion)));
  }
  if (targets.includes('cline')) {
    plannedArtifacts.push(
      ...planBaseAndTaskArtifacts(launchVersion, renderClineBaseRule, renderClineTaskRule),
    );
  }
  if (targets.includes('amazonq')) {
    plannedArtifacts.push(
      ...planBaseAndTaskArtifacts(launchVersion, renderAmazonQBaseRule, renderAmazonQTaskRule),
    );
  }
  return plannedArtifacts;
};

/** Normalize Commander's empty version sentinel to Launch's development version. */
export const normalizeLaunchVersion = (launchVersion: string | undefined): string => {
  if (launchVersion === undefined) return '0.0.0';
  if (launchVersion.length === 0) return '0.0.0';
  return launchVersion;
};

/** MCP clients attached to the selected agent targets. */
export const mcpClientsForTargets = (targets: readonly AgentTarget[]): McpClient[] => {
  const mcpClients: McpClient[] = [];
  if (targets.includes('claude')) mcpClients.push('claude-code');
  if (targets.includes('cursor')) mcpClients.push('cursor');
  return mcpClients;
};

/** Choose explicit, detected, defaulted, or interactively selected targets. */
const selectAgentTargets = (
  commandOptions: AgentsCommandOptions,
  repositoryPath: string,
): Effect.Effect<
  AgentTarget[] | null,
  AgentsCommandFailure,
  FileSystem.FileSystem | LaunchPromptService | Path.Path | Terminal.Terminal
> =>
  Effect.gen(function* () {
    if (commandOptions.agent !== undefined) return yield* parseAgentFlag(commandOptions.agent);
    const detectedTargets = yield* detectAgentTargets(repositoryPath);
    if (detectedTargets.length > 0) return detectedTargets;
    if (commandOptions.yes === true) return [...AGENT_TARGETS];
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) return [...AGENT_TARGETS];
    const prompt = yield* LaunchPrompt;
    return yield* prompt
      .selectMany({
        message: 'No agent config detected - which agents should Launch set up?',
        choices: AGENT_TARGETS.map((agentTarget) => ({
          selection: agentTarget,
          label: AGENT_TARGET_LABELS[agentTarget],
        })),
        initialSelections: AGENT_TARGETS,
      })
      .pipe(
        Effect.map((selectedTargets) => {
          if (selectedTargets === null) return null;
          return [...selectedTargets];
        }),
        Effect.mapError((cause) =>
          makeAgentsCommandFailure({
            operation: 'select coding agents',
            message: cause.message,
            cause,
          }),
        ),
      );
  });

/** Reject a stale skill registry before writing any generated agent files. */
const verifyRegistry = (
  registeredCli: RegisteredCommand,
): Effect.Effect<void, AgentsCommandFailure> => {
  const unknownCommands = findUnknownCommands(registeredCli);
  if (unknownCommands.length === 0) return Effect.void;
  return Effect.fail(
    makeAgentsCommandFailure({
      operation: 'validate the agent registry',
      message: `Launch's agent registry is out of date with the CLI:\n  ${unknownCommands.join('\n  ')}`,
    }),
  );
};

/** Map one terminal write into the agents command failure channel. */
const writeAgentLog = (
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, AgentsCommandFailure> =>
  logWrite.pipe(
    Effect.mapError((cause) =>
      makeAgentsCommandFailure({
        operation: 'write agents output',
        message: 'Could not write agents command output.',
        cause,
      }),
    ),
  );

/** Summarize how many files were written for the selected targets. */
export const formatAgentsWriteSummary = (
  artifactCount: number,
  targets: readonly AgentTarget[],
): string => {
  let fileNoun = 'files';
  if (artifactCount === 1) fileNoun = 'file';
  return `Wrote ${artifactCount} ${fileNoun} for ${targets.join(', ')}.`;
};

/** Run `launch agents init` through the shared platform and prompt services. */
const initializeAgents = (
  commandInput: AgentsCommandInput,
): Effect.Effect<void, AgentsCommandFailure, AgentsCommandRequirements> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const prompt = yield* LaunchPrompt;
    const terminal = yield* Terminal.Terminal;
    const commandService = yield* AgentsCommandService;
    const logger = yield* createLogger(false);
    const repositoryPath = launchPaths.workingDirectory;
    const targets = yield* selectAgentTargets(commandInput.options, repositoryPath);
    if (targets === null) {
      yield* prompt.cancel('Cancelled.');
      return;
    }
    const normalizedVersion = normalizeLaunchVersion(commandInput.launchVersion);
    const plannedArtifacts = planAgentArtifacts(targets, normalizedVersion);
    const mcpClients = mcpClientsForTargets(targets);
    const interactive = commandInput.options.yes !== true && (yield* terminal.isTTY);
    if (interactive) {
      const previewLines = [
        ...plannedArtifacts.map((plannedArtifact) => `- ${plannedArtifact.path}`),
        ...mcpClients.map(
          (mcpClient) =>
            `- ${commandService.mcpConfigPath(mcpClient, repositoryPath)} (launch mcp server)`,
        ),
      ];
      yield* writeAgentLog(logger.line('launch agents'));
      yield* writeAgentLog(logger.line(`Will write for: ${targets.join(', ')}`));
      yield* writeAgentLog(logger.line(previewLines.join('\n')));
      const confirmed = yield* prompt.confirm('Write these files?').pipe(
        Effect.mapError((cause) =>
          makeAgentsCommandFailure({
            operation: 'confirm agent files',
            message: cause.message,
            cause,
          }),
        ),
      );
      if (!confirmed) {
        yield* prompt.cancel('Nothing written.');
        return;
      }
    }
    yield* writeAgentArtifacts(repositoryPath, plannedArtifacts);
    const mcpInstallations = yield* Effect.forEach(
      mcpClients,
      (mcpClient) => commandService.installMcpServer(mcpClient, repositoryPath),
      { concurrency: 1 },
    );
    const summary = formatAgentsWriteSummary(plannedArtifacts.length, targets);
    if (interactive) {
      yield* writeAgentLog(logger.ok(summary));
    } else {
      for (const plannedArtifact of plannedArtifacts) {
        yield* writeAgentLog(logger.ok(plannedArtifact.path));
      }
      for (const mcpInstallation of mcpInstallations) {
        if (mcpInstallation.changed) {
          yield* writeAgentLog(logger.ok(`${mcpInstallation.path} (launch mcp server)`));
        }
      }
      yield* writeAgentLog(logger.line(summary));
    }
    yield* writeAgentLog(logger.line('Verify anytime with: launch agents check'));
  });

/** Run `launch agents check` and return a failing command exit when generated files drift. */
const checkAgents = (
  commandInput: AgentsCommandInput,
): Effect.Effect<
  void,
  AgentsCommandFailure | CommandExit,
  FileSystem.FileSystem | LaunchPathsService | Logger | Path.Path
> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const logger = yield* createLogger(false);
    const repositoryPath = launchPaths.workingDirectory;
    let targets: AgentTarget[];
    if (commandInput.options.agent !== undefined) {
      targets = yield* parseAgentFlag(commandInput.options.agent);
    } else {
      targets = yield* detectAgentTargets(repositoryPath);
    }
    if (targets.length === 0) {
      yield* writeAgentLog(
        logger.line('No agent files found. Scaffold them with: launch agents init'),
      );
      return;
    }
    const normalizedVersion = normalizeLaunchVersion(commandInput.launchVersion);
    const staleArtifacts = yield* findStaleAgentArtifacts(
      repositoryPath,
      planAgentArtifacts(targets, normalizedVersion),
    );
    if (staleArtifacts.length === 0) {
      yield* writeAgentLog(
        logger.line(
          `Agent files are in sync with launch v${normalizedVersion} (${targets.join(', ')}).`,
        ),
      );
      return;
    }
    yield* writeAgentLog(
      logger.error(
        `These agent files are out of date - re-run \`launch agents init\`:\n  ${staleArtifacts.join('\n  ')}`,
      ),
    );
    yield* completeCommand(1);
  });

/** Run the selected agents subcommand through one shared Effect entry point. */
export const agentsCommandProgram = (
  commandInput: AgentsCommandInput,
): Effect.Effect<void, AgentsCommandFailure | CommandExit, AgentsCommandRequirements> =>
  Effect.gen(function* () {
    yield* verifyRegistry(commandInput.registeredCli);
    switch (commandInput.mode) {
      case 'init':
        return yield* initializeAgents(commandInput);
      case 'check':
        return yield* checkAgents(commandInput);
    }
  });
