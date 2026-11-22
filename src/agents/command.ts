import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stdout } from 'node:process';
import {
  clientConfigPath,
  installServer,
  type InstalledMcpServer,
  type McpClient,
} from '../mcp/install.js';
import { pathExists } from '../path-exists.js';
import { errorMessage, hasMessage } from '../services/platform/errorMessage.js';
import { createLogger, type Logger } from '../services/platform/logger.js';
import { detectHostOperatingSystem } from '../services/platform/os.js';
import { readLaunchDirectories } from '../services/platform/paths.js';
import { LaunchPrompt } from '../services/platform/prompt.js';
import { completeCommand } from '../terminal/commandExit.js';
import type { ConsumerSkill, GeneratedAgentFile } from '../types/agents.js';
import type { HostOs } from '../types/remote.js';
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

const UNSTATED_LAUNCH_VERSION = '0.0.0';

type AgentTarget =
  | 'claude'
  | 'cursor'
  | 'codex'
  | 'windsurf'
  | 'copilot'
  | 'kiro'
  | 'cline'
  | 'amazonq';

/** The coding-agent targets supported by `launch agents`, in display order. */
const AGENT_TARGETS: readonly AgentTarget[] = [
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
const AGENT_TARGET_LABELS: Readonly<Record<AgentTarget, string>> = {
  claude: 'Claude    (.claude/skills + CLAUDE.md)',
  cursor: 'Cursor    (.cursor/rules)',
  codex: 'Codex     (AGENTS.md)',
  windsurf: 'Windsurf  (.windsurf/rules)',
  copilot: 'Copilot   (.github/copilot-instructions.md)',
  kiro: 'Kiro      (.kiro/steering)',
  cline: 'Cline     (.cline/rules)',
  amazonq: 'Amazon Q  (.amazonq/rules)',
};

type OwnedAgentArtifact = {
  readonly kind: 'owned';
  readonly path: string;
  readonly content: string;
};

type SplicedAgentArtifact = {
  readonly kind: 'spliced';
  readonly path: string;
  readonly block: string;
};

/** One generated artifact, either fully owned or spliced into a shared document. */
export type AgentArtifact = OwnedAgentArtifact | SplicedAgentArtifact;

/** CLI options shared by the `agents init` and `agents check` programs. */
export type AgentsCommandOptions = {
  readonly agent?: string;
  readonly yes?: boolean;
};

/** Input selecting which agents subcommand the shared program runs. */
type AgentsCommandRequest = Readonly<{
  readonly mode: 'init' | 'check';
  readonly launchVersion: string | undefined;
  readonly registeredCli: RegisteredCommand;
  readonly options: AgentsCommandOptions;
}>;

/** Agent command input, prompt, filesystem, or MCP setup failed. */
type AgentsCommandFailure = Readonly<{
  readonly _tag: 'AgentsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

type McpClientPreview = {
  mcpClient: McpClient;
  repositoryPath: string;
  homeDirectory: string;
  operatingSystem: HostOs;
};

type AgentPreview = {
  plannedArtifacts: readonly AgentArtifact[];
  mcpClients: readonly McpClient[];
  repositoryPath: string;
  homeDirectory: string;
};

type InteractivePreview = {
  isInteractive: boolean;
  logger: Logger;
  targets: readonly AgentTarget[];
  plannedArtifacts: readonly AgentArtifact[];
  mcpClients: readonly McpClient[];
  repositoryPath: string;
  homeDirectory: string;
};

type QuietWriteReport = {
  logger: Logger;
  plannedArtifacts: readonly AgentArtifact[];
  mcpInstallations: readonly InstalledMcpServer[];
  summary: string;
};

function makeAgentsCommandFailure(failure: {
  operation: string;
  message: string;
  cause?: unknown;
}): AgentsCommandFailure {
  if (failure.cause == null) {
    return {
      _tag: 'AgentsCommandFailure',
      operation: failure.operation,
      message: failure.message,
    };
  }

  return {
    _tag: 'AgentsCommandFailure',
    operation: failure.operation,
    message: failure.message,
    cause: failure.cause,
  };
}

function agentsFailure(operation: string, cause: unknown): AgentsCommandFailure {
  let message = `${operation} failed.`;
  const causeHasMessage = hasMessage(cause);

  if (causeHasMessage) {
    message = cause.message;
  }

  return makeAgentsCommandFailure({ operation, message, cause });
}

/** Narrow a text token to a supported coding-agent target. */
function isAgentTarget(candidate: string): candidate is AgentTarget {
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
}

function readAgentToken(agentToken: string): string {
  return agentToken.trim().toLowerCase();
}

function isFilledAgentToken(agentToken: string): boolean {
  return agentToken != '';
}

function readKnownAgentTarget(agentToken: string): AgentTarget {
  if (isAgentTarget(agentToken)) {
    return agentToken;
  }

  throw makeAgentsCommandFailure({
    operation: 'parse --agent',
    message: `Unknown agent "${agentToken}". Use claude, cursor, codex, windsurf, copilot, kiro, cline, amazonq, or all.`,
  });
}

/** Decode an explicit `--agent` value into a unique supported target list. */
export function parseAgentFlag(agentFlag: string): AgentTarget[] {
  const agentTokens = agentFlag.split(',').map(readAgentToken).filter(isFilledAgentToken);
  const wantsEveryAgent = agentTokens.includes('all');

  if (wantsEveryAgent) {
    return [...AGENT_TARGETS];
  }

  const selectedTargets: AgentTarget[] = [];

  for (const agentToken of agentTokens) {
    const knownTarget = readKnownAgentTarget(agentToken);
    const isAlreadySelected = selectedTargets.includes(knownTarget);

    if (isAlreadySelected) {
      continue;
    }

    selectedTargets.push(knownTarget);
  }

  return selectedTargets;
}

/** Convert a rendered file into a fully-owned artifact write. */
export function ownedAgentArtifact(generatedFile: GeneratedAgentFile): AgentArtifact {
  return {
    kind: 'owned',
    path: generatedFile.path,
    content: generatedFile.body,
  };
}

/** Plan base + per-skill task rules for rule-file agent targets. */
export function planBaseAndTaskArtifacts(
  launchVersion: string,
  renderBase: (version: string) => GeneratedAgentFile,
  renderTask: (skill: ConsumerSkill, version: string) => GeneratedAgentFile,
): AgentArtifact[] {
  const baseFile = renderBase(launchVersion);
  const plannedArtifacts: AgentArtifact[] = [ownedAgentArtifact(baseFile)];

  for (const consumerSkill of CONSUMER_SKILLS) {
    const taskFile = renderTask(consumerSkill, launchVersion);
    plannedArtifacts.push(ownedAgentArtifact(taskFile));
  }

  return plannedArtifacts;
}

/** Build every artifact required for the selected coding agents. */
export function planAgentArtifacts(
  targets: readonly AgentTarget[],
  launchVersion: string,
): AgentArtifact[] {
  const wantsClaude = targets.includes('claude');
  const wantsCodex = targets.includes('codex');
  const wantsCursor = targets.includes('cursor');
  const wantsWindsurf = targets.includes('windsurf');
  const wantsCopilot = targets.includes('copilot');
  const wantsKiro = targets.includes('kiro');
  const wantsCline = targets.includes('cline');
  const wantsAmazonQ = targets.includes('amazonq');
  const plannedArtifacts: AgentArtifact[] = [];
  let needsAgentsMarkdown = false;

  if (wantsClaude) {
    needsAgentsMarkdown = true;
  }

  if (wantsCodex) {
    needsAgentsMarkdown = true;
  }

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
      const renderedFiles = renderClaudeSkillFiles(consumerSkill, launchVersion);

      for (const renderedFile of renderedFiles) {
        plannedArtifacts.push(ownedAgentArtifact(renderedFile));
      }
    }
  }

  if (wantsCursor) {
    const cursorArtifacts = planBaseAndTaskArtifacts(
      launchVersion,
      renderCursorBaseRule,
      renderCursorTaskRule,
    );
    plannedArtifacts.push(...cursorArtifacts);
  }

  if (wantsWindsurf) {
    const windsurfArtifacts = planBaseAndTaskArtifacts(
      launchVersion,
      renderWindsurfBaseRule,
      renderWindsurfTaskRule,
    );
    plannedArtifacts.push(...windsurfArtifacts);
  }

  if (wantsCopilot) {
    plannedArtifacts.push({
      kind: 'spliced',
      path: '.github/copilot-instructions.md',
      block: renderCopilotBlock(launchVersion),
    });
  }

  if (wantsKiro) {
    const kiroSteering = renderKiroSteering(launchVersion);
    plannedArtifacts.push(ownedAgentArtifact(kiroSteering));
  }

  if (wantsCline) {
    const clineArtifacts = planBaseAndTaskArtifacts(
      launchVersion,
      renderClineBaseRule,
      renderClineTaskRule,
    );
    plannedArtifacts.push(...clineArtifacts);
  }

  if (wantsAmazonQ) {
    const amazonQArtifacts = planBaseAndTaskArtifacts(
      launchVersion,
      renderAmazonQBaseRule,
      renderAmazonQTaskRule,
    );
    plannedArtifacts.push(...amazonQArtifacts);
  }

  return plannedArtifacts;
}

/** Normalize Commander's empty version sentinel to Launch's development version. */
export function normalizeLaunchVersion(launchVersion: string | undefined): string {
  if (launchVersion == null) {
    return UNSTATED_LAUNCH_VERSION;
  }

  const isEmpty = launchVersion.length == 0;

  if (isEmpty) {
    return UNSTATED_LAUNCH_VERSION;
  }

  return launchVersion;
}

/** MCP clients attached to the selected agent targets. */
export function mcpClientsForTargets(targets: readonly AgentTarget[]): McpClient[] {
  const mcpClients: McpClient[] = [];
  const wantsClaude = targets.includes('claude');

  if (wantsClaude) {
    mcpClients.push('claude-code');
  }

  const wantsCursor = targets.includes('cursor');

  if (wantsCursor) {
    mcpClients.push('cursor');
  }

  return mcpClients;
}

/** Summarize how many files were written for the selected targets. */
export function formatAgentsWriteSummary(
  artifactCount: number,
  targets: readonly AgentTarget[],
): string {
  let fileNoun = 'files';
  const isSingleFile = artifactCount == 1;

  if (isSingleFile) {
    fileNoun = 'file';
  }

  return `Wrote ${artifactCount} ${fileNoun} for ${targets.join(', ')}.`;
}

/** Whether on-disk content matches the planned managed block for a spliced artifact. */
export function managedBlockIsCurrent(
  currentDocument: string,
  plannedBlock: string,
): 'missing-block' | 'stale' | 'current' {
  const missingIndex = -1;
  const managedStart = currentDocument.indexOf(MANAGED_START);
  const managedEnd = currentDocument.indexOf(MANAGED_END);
  const isStartMissing = managedStart == missingIndex;

  if (isStartMissing) {
    return 'missing-block';
  }

  const isEndMissing = managedEnd == missingIndex;

  if (isEndMissing) {
    return 'missing-block';
  }

  const managedDocument = currentDocument.slice(managedStart, managedEnd + MANAGED_END.length);
  const isStale = managedDocument != plannedBlock;

  if (isStale) {
    return 'stale';
  }

  return 'current';
}

async function anyRelativePathExists(
  repositoryPath: string,
  relativePaths: readonly string[],
): Promise<boolean> {
  for (const relativePath of relativePaths) {
    const candidatePath = join(repositoryPath, relativePath);
    const exists = await pathExists(candidatePath);

    if (exists) {
      return true;
    }
  }

  return false;
}

/** Detect coding-agent footprints already present in a repository. */
export async function detectAgentTargets(repositoryPath: string): Promise<AgentTarget[]> {
  try {
    const detectedTargets: AgentTarget[] = [];
    const hasClaude = await anyRelativePathExists(repositoryPath, ['.claude', 'CLAUDE.md']);

    if (hasClaude) {
      detectedTargets.push('claude');
    }

    const hasCursor = await anyRelativePathExists(repositoryPath, ['.cursor', '.cursorrules']);

    if (hasCursor) {
      detectedTargets.push('cursor');
    }

    const hasCodex = await anyRelativePathExists(repositoryPath, ['AGENTS.md', '.codex']);

    if (hasCodex) {
      detectedTargets.push('codex');
    }

    const hasWindsurf = await anyRelativePathExists(repositoryPath, [
      '.windsurf',
      '.windsurfrules',
    ]);

    if (hasWindsurf) {
      detectedTargets.push('windsurf');
    }

    const hasCopilot = await anyRelativePathExists(repositoryPath, [
      '.github/copilot-instructions.md',
    ]);

    if (hasCopilot) {
      detectedTargets.push('copilot');
    }

    const hasKiro = await anyRelativePathExists(repositoryPath, ['.kiro']);

    if (hasKiro) {
      detectedTargets.push('kiro');
    }

    const hasCline = await anyRelativePathExists(repositoryPath, ['.cline', '.clinerules']);

    if (hasCline) {
      detectedTargets.push('cline');
    }

    const hasAmazonQ = await anyRelativePathExists(repositoryPath, ['.amazonq']);

    if (hasAmazonQ) {
      detectedTargets.push('amazonq');
    }

    return detectedTargets;
  } catch (cause) {
    throw agentsFailure('detect agent files', cause);
  }
}

async function readExistingDocument(artifactPath: string): Promise<string> {
  const artifactExists = await pathExists(artifactPath);

  if (artifactExists == false) {
    return '';
  }

  return readFile(artifactPath, 'utf8');
}

async function writeSplicedArtifact(artifactPath: string, block: string): Promise<void> {
  const existingDocument = await readExistingDocument(artifactPath);
  const splicedDocument = spliceManagedBlock(existingDocument, block);
  await writeFile(artifactPath, splicedDocument);
}

/** Write owned files and splice managed blocks for an agent artifact plan. */
export async function writeAgentArtifacts(
  repositoryPath: string,
  artifacts: readonly AgentArtifact[],
): Promise<void> {
  try {
    for (const artifact of artifacts) {
      const artifactPath = join(repositoryPath, artifact.path);
      const artifactDirectory = dirname(artifactPath);
      await mkdir(artifactDirectory, { recursive: true });

      if (artifact.kind == 'owned') {
        await writeFile(artifactPath, artifact.content);
        continue;
      }

      await writeSplicedArtifact(artifactPath, artifact.block);
    }
  } catch (cause) {
    throw agentsFailure('write agent files', cause);
  }
}

function ownedArtifactNote(artifact: OwnedAgentArtifact, currentDocument: string): string | null {
  const documentDiffers = currentDocument != artifact.content;

  if (documentDiffers) {
    return artifact.path;
  }

  return null;
}

function splicedArtifactNote(
  artifact: SplicedAgentArtifact,
  currentDocument: string,
): string | null {
  const managedStatus = managedBlockIsCurrent(currentDocument, artifact.block);
  const isMissingBlock = managedStatus == 'missing-block';

  if (isMissingBlock) {
    return `${artifact.path} (no Launch block)`;
  }

  const isStale = managedStatus == 'stale';

  if (isStale) {
    return artifact.path;
  }

  return null;
}

function staleArtifactNote(artifact: AgentArtifact, currentDocument: string): string | null {
  if (artifact.kind == 'owned') {
    return ownedArtifactNote(artifact, currentDocument);
  }

  return splicedArtifactNote(artifact, currentDocument);
}

/** Return planned agent artifacts that are missing or differ from a fresh render. */
export async function findStaleAgentArtifacts(
  repositoryPath: string,
  artifacts: readonly AgentArtifact[],
): Promise<string[]> {
  try {
    const staleArtifactPaths: string[] = [];

    for (const artifact of artifacts) {
      const artifactPath = join(repositoryPath, artifact.path);
      const artifactExists = await pathExists(artifactPath);
      const isMissing = artifactExists == false;

      if (isMissing) {
        staleArtifactPaths.push(`${artifact.path} (missing)`);
        continue;
      }

      const currentDocument = await readFile(artifactPath, 'utf8');
      const driftNote = staleArtifactNote(artifact, currentDocument);

      if (driftNote != null) {
        staleArtifactPaths.push(driftNote);
      }
    }

    return staleArtifactPaths;
  } catch (cause) {
    throw agentsFailure('check agent files', cause);
  }
}

function agentTargetChoice(agentTarget: AgentTarget): { selection: AgentTarget; label: string } {
  return {
    selection: agentTarget,
    label: AGENT_TARGET_LABELS[agentTarget],
  };
}

async function askAgentTargets(): Promise<AgentTarget[] | null> {
  try {
    const selectedTargets = await LaunchPrompt.selectMany({
      message: 'No agent config detected - which agents should Launch set up?',
      choices: AGENT_TARGETS.map(agentTargetChoice),
      initialSelections: AGENT_TARGETS,
    });

    if (selectedTargets == null) {
      return null;
    }

    return [...selectedTargets];
  } catch (cause) {
    throw makeAgentsCommandFailure({
      operation: 'select coding agents',
      message: errorMessage(cause),
      cause,
    });
  }
}

function readExplicitTargets(agentFlag: string | undefined): AgentTarget[] | null {
  if (agentFlag == null) {
    return null;
  }

  return parseAgentFlag(agentFlag);
}

/** Choose explicit, detected, defaulted, or interactively selected targets. */
async function selectAgentTargets(
  commandOptions: AgentsCommandOptions,
  repositoryPath: string,
): Promise<AgentTarget[] | null> {
  const explicitTargets = readExplicitTargets(commandOptions.agent);

  if (explicitTargets != null) {
    return explicitTargets;
  }

  const detectedTargets = await detectAgentTargets(repositoryPath);
  const hasDetectedTargets = detectedTargets.length > 0;

  if (hasDetectedTargets) {
    return detectedTargets;
  }

  const acceptedDefaults = commandOptions.yes == true;

  if (acceptedDefaults) {
    return [...AGENT_TARGETS];
  }

  const terminalIsInteractive = stdout.isTTY == true;

  if (terminalIsInteractive == false) {
    return [...AGENT_TARGETS];
  }

  return askAgentTargets();
}

/** Reject a stale skill registry before writing any generated agent files. */
function verifyRegistry(registeredCli: RegisteredCommand): void {
  const unknownCommands = findUnknownCommands(registeredCli);
  const registryIsCurrent = unknownCommands.length == 0;

  if (registryIsCurrent) {
    return;
  }

  throw makeAgentsCommandFailure({
    operation: 'validate the agent registry',
    message: `Launch's agent registry is out of date with the CLI:\n  ${unknownCommands.join('\n  ')}`,
  });
}

function formatPlannedArtifactLine(plannedArtifact: AgentArtifact): string {
  return `- ${plannedArtifact.path}`;
}

function formatMcpClientLine(clientPreview: McpClientPreview): string {
  const configPath = clientConfigPath(
    clientPreview.mcpClient,
    clientPreview.repositoryPath,
    clientPreview.homeDirectory,
    clientPreview.operatingSystem,
  );

  return `- ${configPath} (launch mcp server)`;
}

function listPreviewLines(preview: AgentPreview): string[] {
  const operatingSystem = detectHostOperatingSystem();
  const artifactLines = preview.plannedArtifacts.map(formatPlannedArtifactLine);
  const clientLines: string[] = [];

  for (const mcpClient of preview.mcpClients) {
    const clientLine = formatMcpClientLine({
      mcpClient,
      repositoryPath: preview.repositoryPath,
      homeDirectory: preview.homeDirectory,
      operatingSystem,
    });
    clientLines.push(clientLine);
  }

  return [...artifactLines, ...clientLines];
}

async function confirmAgentWrites(): Promise<boolean> {
  try {
    return await LaunchPrompt.confirm('Write these files?');
  } catch (cause) {
    throw makeAgentsCommandFailure({
      operation: 'confirm agent files',
      message: errorMessage(cause),
      cause,
    });
  }
}

async function confirmWritesWhenInteractive(preview: InteractivePreview): Promise<boolean> {
  if (preview.isInteractive == false) {
    return true;
  }

  const previewLines = listPreviewLines(preview);
  preview.logger.line('launch agents');
  preview.logger.line(`Will write for: ${preview.targets.join(', ')}`);
  preview.logger.line(previewLines.join('\n'));
  const confirmed = await confirmAgentWrites();

  if (confirmed) {
    return true;
  }

  LaunchPrompt.cancel('Nothing written.');
  return false;
}

function commandIsInteractive(commandOptions: AgentsCommandOptions): boolean {
  const skippedConfirmation = commandOptions.yes == true;

  if (skippedConfirmation) {
    return false;
  }

  return stdout.isTTY == true;
}

async function installSelectedClients(
  mcpClients: readonly McpClient[],
  repositoryPath: string,
  homeDirectory: string,
): Promise<InstalledMcpServer[]> {
  const operatingSystem = detectHostOperatingSystem();
  const installations: InstalledMcpServer[] = [];

  for (const mcpClient of mcpClients) {
    try {
      const installedServer = await installServer(
        mcpClient,
        repositoryPath,
        homeDirectory,
        operatingSystem,
      );
      installations.push(installedServer);
    } catch (cause) {
      throw agentsFailure('install the Launch MCP server', cause);
    }
  }

  return installations;
}

function logQuietWrites(report: QuietWriteReport): void {
  for (const plannedArtifact of report.plannedArtifacts) {
    report.logger.ok(plannedArtifact.path);
  }

  for (const mcpInstallation of report.mcpInstallations) {
    const didChange = mcpInstallation.changed;

    if (didChange) {
      report.logger.ok(`${mcpInstallation.path} (launch mcp server)`);
    }
  }

  report.logger.line(report.summary);
}

/** Run `launch agents init` through the shared platform and prompt services. */
async function initializeAgents(commandRequest: AgentsCommandRequest): Promise<void> {
  const launchDirectories = readLaunchDirectories();
  const logger = createLogger(false);
  const repositoryPath = launchDirectories.workingDirectory;
  const targets = await selectAgentTargets(commandRequest.options, repositoryPath);

  if (targets == null) {
    LaunchPrompt.cancel('Cancelled.');
    return;
  }

  const normalizedVersion = normalizeLaunchVersion(commandRequest.launchVersion);
  const plannedArtifacts = planAgentArtifacts(targets, normalizedVersion);
  const mcpClients = mcpClientsForTargets(targets);
  const isInteractive = commandIsInteractive(commandRequest.options);
  const accepted = await confirmWritesWhenInteractive({
    isInteractive,
    logger,
    targets,
    plannedArtifacts,
    mcpClients,
    repositoryPath,
    homeDirectory: launchDirectories.homeDirectory,
  });
  const declined = accepted == false;

  if (declined) {
    return;
  }

  await writeAgentArtifacts(repositoryPath, plannedArtifacts);

  const mcpInstallations = await installSelectedClients(
    mcpClients,
    repositoryPath,
    launchDirectories.homeDirectory,
  );
  const summary = formatAgentsWriteSummary(plannedArtifacts.length, targets);

  if (isInteractive) {
    logger.ok(summary);
  }

  if (isInteractive == false) {
    logQuietWrites({ logger, plannedArtifacts, mcpInstallations, summary });
  }

  logger.line('Verify anytime with: launch agents check');
}

async function readCheckTargets(
  commandOptions: AgentsCommandOptions,
  repositoryPath: string,
): Promise<AgentTarget[]> {
  const agentFlag = commandOptions.agent;

  if (agentFlag != null) {
    return parseAgentFlag(agentFlag);
  }

  return detectAgentTargets(repositoryPath);
}

/** Run `launch agents check` and return a failing command exit when generated files drift. */
async function checkAgents(commandRequest: AgentsCommandRequest): Promise<void> {
  const launchDirectories = readLaunchDirectories();
  const logger = createLogger(false);
  const repositoryPath = launchDirectories.workingDirectory;
  const targets = await readCheckTargets(commandRequest.options, repositoryPath);
  const hasNoTargets = targets.length == 0;

  if (hasNoTargets) {
    logger.line('No agent files found. Scaffold them with: launch agents init');
    return;
  }

  const normalizedVersion = normalizeLaunchVersion(commandRequest.launchVersion);
  const plannedArtifacts = planAgentArtifacts(targets, normalizedVersion);
  const staleArtifacts = await findStaleAgentArtifacts(repositoryPath, plannedArtifacts);
  const isInSync = staleArtifacts.length == 0;

  if (isInSync) {
    logger.line(
      `Agent files are in sync with launch v${normalizedVersion} (${targets.join(', ')}).`,
    );
    return;
  }

  logger.error(
    `These agent files are out of date - re-run \`launch agents init\`:\n  ${staleArtifacts.join('\n  ')}`,
  );
  completeCommand(1);
}

/** Run the selected agents subcommand. */
export async function agentsCommandProgram(commandRequest: AgentsCommandRequest): Promise<void> {
  verifyRegistry(commandRequest.registeredCli);

  switch (commandRequest.mode) {
    case 'init':
      await initializeAgents(commandRequest);
      return;
    case 'check':
      await checkAgents(commandRequest);
      return;
  }
}
