import {
  atom,
  read,
  update,
  type CommandRunInput,
  type EngineInterface,
  type Register,
} from 'claude-code';
import type { RunningLaunch } from '../types/state';
import {
  errorText,
  failureText,
  launchOutcome,
  reportText,
  showOutputLine,
  splitLines,
  startFailure,
  type LaunchOutcome,
} from './launch-events';
import {
  buildWords,
  doctorWords,
  LAUNCH_TOOL_SPECS,
  planWords,
  releaseWords,
  statusWords,
} from './launch-tools';
import { projectKinds } from './project';

const COMMAND = 'launch';
const BUILD_TOOL = 'mcp__launch-store__build';
const RELEASE_TOOL = 'mcp__launch-store__release';
const STATUS_TOOL = 'mcp__launch-store__status';
const PLAN_TOOL = 'mcp__launch-store__plan';
const DOCTOR_TOOL = 'mcp__launch-store__doctor';
const COMMANDS = ['build', 'release', 'status', 'plan', 'doctor'];
const PERSON_ORIGINS = ['composer', 'bridge', 'channel', 'plugin'];
const YES_FLAGS = ['--yes', '-y'];
const NO_QUESTION_FLAGS = ['--dry-run', '--no-submit', ...YES_FLAGS];
const CANCEL = 'Cancel';
const USAGE =
  'Usage: /launch <build|release|status|plan|doctor> [platform] [flags], like /launch build ios --dry-run. A build that uploads and a release ask first; --yes skips the question.';
const CANCELLED: LaunchOutcome = {
  verdict: 'cancelled',
  lines: ['Nothing was built or submitted.'],
};

const launchRun = atom({ plugin: 'launch-store', key: 'run' } as const, null as RunningLaunch);

const detectProject = async ($: EngineInterface, folder: string) => {
  const entries = await $.fs.list(folder).catch(() => []);
  const entryNames = entries.map((entry) => entry.name);
  const manifestText = await $.fs.read(`${folder}/package.json`).catch(() => '');
  return projectKinds(entryNames, manifestText);
};

const showOutput = (
  $: EngineInterface,
  commandLine: string,
  lines: string[],
  outputLines: readonly string[],
) => {
  for (const outputLine of outputLines) {
    const shown = showOutputLine(outputLine);
    if (shown.statusText !== undefined) $.ui.status(`launch ${commandLine}: ${shown.statusText}`);
    lines.push(...shown.lines);
  }
};

const followLaunch = async ($: EngineInterface, words: readonly string[]) => {
  const commandLine = words.join(' ');
  const lines: string[] = [];
  const pending = { stdout: '', stderr: '' };
  const child = $.process.spawn({ argv: ['launch', ...words, '--json'] });
  for await (const piece of child) {
    if (piece.stream === 'stderr') {
      pending.stderr = `${pending.stderr}${piece.text}`;
      continue;
    }
    const split = splitLines(pending.stdout, piece.text);
    pending.stdout = split.rest;
    showOutput($, commandLine, lines, split.complete);
  }
  showOutput($, commandLine, lines, [pending.stdout]);
  const ended = await child.result;
  return launchOutcome(ended.code, lines, pending.stderr);
};

const runLaunch = async ($: EngineInterface, words: readonly string[]) => {
  const commandLine = words.join(' ');
  $.ui.status(`launch ${commandLine}: starting`);
  try {
    return await followLaunch($, words);
  } catch (error) {
    return startFailure(error);
  } finally {
    $.ui.status(undefined);
  }
};

const askFirst = async ($: EngineInterface, question: string, choice: string) => {
  const asked = $.ui.ask(question, { header: choice, options: [choice, CANCEL] });
  const answer = await asked.catch(() => CANCEL);
  return answer === choice;
};

const buildAfterAnswer = async ($: EngineInterface, words: readonly string[]) => {
  const target = words.slice(1).join(' ');
  const isGo = await askFirst($, `Build ${target} and upload it for testers?`, 'Build');
  if (!isGo) return CANCELLED;
  return runLaunch($, words);
};

const releaseAfterAnswer = async ($: EngineInterface, words: readonly string[]) => {
  const planned = await runLaunch($, [...words, '--dry-run']);
  if (planned.verdict !== 'finished') return planned;
  const target = words.slice(1).join(' ');
  const question = [...planned.lines, '', `Release ${target} now?`].join('\n');
  const isGo = await askFirst($, question, 'Release');
  if (!isGo) return CANCELLED;
  return runLaunch($, [...words, '--yes']);
};

const runAnswered = ($: EngineInterface, words: readonly string[]) => {
  const [command] = words;
  const isAnswered = words.some((word) => NO_QUESTION_FLAGS.includes(word));
  if (isAnswered) return runLaunch($, words);
  if (command === 'build') return buildAfterAnswer($, words);
  if (command === 'release') return releaseAfterAnswer($, words);
  return runLaunch($, words);
};

const busyText = async ($: EngineInterface) => {
  const running = await read($, launchRun);
  if (running === null) return undefined;
  return `launch ${running} is still running. Wait for it to finish first.`;
};

const runOnce = async ($: EngineInterface, words: readonly string[]): Promise<LaunchOutcome> => {
  const busy = await busyText($);
  if (busy !== undefined) return { verdict: 'failed', lines: [busy] };
  const commandLine = words.join(' ');
  await update($, launchRun, () => commandLine);
  try {
    const outcome = await runAnswered($, words);
    $.ui.toast(`launch ${commandLine} ${outcome.verdict}`);
    return outcome;
  } finally {
    await update($, launchRun, () => null);
  }
};

const toolAnswer = async ($: EngineInterface, words: readonly string[]) => {
  const outcome = await runOnce($, words);
  const report = reportText(words, outcome);
  if (outcome.verdict === 'failed') return { deny: report };
  return { result: report };
};

const reportInBackground = async ($: EngineInterface, words: readonly string[]) => {
  const outcome = await runOnce($, words);
  const report = reportText(words, outcome);
  $.ui.log(report);
};

const startCommand = async ($: EngineInterface, e: CommandRunInput) => {
  const words = e.args.split(/\s+/).filter((word) => word !== '');
  const [command = ''] = words;
  const isPerson = PERSON_ORIGINS.includes(e.origin.kind);
  if (!isPerson) return { text: 'Only the person at this session can start /launch.' };
  const isSkipped = words.some((word) => YES_FLAGS.includes(word));
  if (e.origin.kind === 'plugin' && isSkipped)
    return { text: 'A plugin cannot skip the question. Run it without --yes.' };
  if (!COMMANDS.includes(command)) return { text: USAGE };
  const busy = await busyText($);
  if (busy !== undefined) return { text: busy };
  void reportInBackground($, words).catch((error) => $.ui.log(`launch-store: ${errorText(error)}`));
  return { text: `Started launch ${words.join(' ')}. Progress shows in the status line.` };
};

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const kinds = await detectProject($, e.cwd);
    if (kinds.length === 0) return next(e);
    const registering = LAUNCH_TOOL_SPECS.map((spec) => $.tool.register(spec));
    await Promise.all(registering);
    await $.command.register({
      name: COMMAND,
      description: `Build, release and check this app with launch-store (${kinds.join(', ')})`,
      argumentHint: '<build|release|status|plan|doctor> [platform] [flags]',
      immediate: true,
    });
    return next(e);
  });

  on('tool.call', { tool: BUILD_TOOL }, ($, e) => {
    const words = buildWords(e);
    return toolAnswer($, words);
  }).catch((_$, _e, next) => ({ deny: failureText(next.error) }));

  on('tool.call', { tool: RELEASE_TOOL }, ($, e) => {
    const words = releaseWords(e);
    return toolAnswer($, words);
  }).catch((_$, _e, next) => ({ deny: failureText(next.error) }));

  on('tool.call', { tool: STATUS_TOOL }, ($, e) => {
    const words = statusWords(e);
    return toolAnswer($, words);
  }).catch((_$, _e, next) => ({ deny: failureText(next.error) }));

  on('tool.call', { tool: PLAN_TOOL }, ($, e) => {
    const words = planWords(e);
    return toolAnswer($, words);
  }).catch((_$, _e, next) => ({ deny: failureText(next.error) }));

  on('tool.call', { tool: DOCTOR_TOOL }, ($, e) => {
    const words = doctorWords(e);
    return toolAnswer($, words);
  }).catch((_$, _e, next) => ({ deny: failureText(next.error) }));

  on('command.run', { command: COMMAND }, startCommand).catch((_$, _e, next) => ({
    text: failureText(next.error),
  }));
};
