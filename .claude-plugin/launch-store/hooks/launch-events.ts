import type { HookFailure } from 'claude-code';

export type LaunchEvent = Readonly<{
  event: string;
  step?: string;
  detail?: string;
  label?: string;
  status?: string;
  elapsedMs?: number;
  message?: string;
  title?: string;
  lines?: readonly string[];
}>;

export type LaunchOutcome = Readonly<{
  verdict: 'finished' | 'failed' | 'cancelled';
  lines: readonly string[];
}>;

export type ShownLine = Readonly<{ statusText?: string; lines: readonly string[] }>;

const LINE_BREAK = /\r?\n/;
const STDERR_TAIL = 20;
const INSTALL_HINT = 'Install the CLI with `pnpm add -g launch-store`.';

export const errorText = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export const failureText = (failure: HookFailure) => {
  if (failure.message === undefined) return 'launch-store failed: it ran out of time';
  return `launch-store failed: ${failure.message}`;
};

export const splitLines = (pending: string, text: string) => {
  const joined = `${pending}${text}`;
  const pieces = joined.split(LINE_BREAK);
  const complete = pieces.slice(0, -1);
  const [rest = ''] = pieces.slice(-1);
  return { complete, rest };
};

export const parseEvent = (outputLine: string): LaunchEvent | undefined => {
  try {
    const parsed: unknown = JSON.parse(outputLine);
    const isEvent = typeof parsed === 'object' && parsed !== null && 'event' in parsed;
    if (!isEvent) return undefined;
    if (typeof parsed.event !== 'string') return undefined;
    return parsed as LaunchEvent;
  } catch {
    return undefined;
  }
};

const seconds = (elapsedMs: number | undefined) => {
  if (elapsedMs === undefined) return '0s';
  return `${Math.round(elapsedMs / 1000)}s`;
};

const indented = (lines: readonly string[] | undefined) => {
  if (lines === undefined) return [];
  return lines.map((line) => `  ${line}`);
};

export const eventLines = (event: LaunchEvent): string[] => {
  if (event.event === 'step' && event.detail !== undefined)
    return [`${event.step} - ${event.detail}`];
  if (event.event === 'step') return [`${event.step}`];
  if (event.event === 'progress' && event.status === 'done')
    return [`${event.label} done in ${seconds(event.elapsedMs)}`];
  if (event.event === 'progress' && event.status === 'fail') return [`${event.label} failed`];
  if (event.event === 'warn') return [`Warning: ${event.message}`];
  if (event.event === 'note') return [`${event.message}`];
  if (event.event === 'box') return [`${event.title}`, ...indented(event.lines)];
  if (event.event === 'result' && event.message !== undefined) return [event.message];
  return [];
};

const eventStatus = (event: LaunchEvent) => {
  if (event.event === 'step') return event.step;
  if (event.event === 'progress' && event.status === 'start') return event.label;
  return undefined;
};

export const showOutputLine = (outputLine: string): ShownLine => {
  if (outputLine.trim() === '') return { lines: [] };
  const event = parseEvent(outputLine);
  if (event === undefined) return { lines: [outputLine] };
  const statusText = eventStatus(event);
  const lines = eventLines(event);
  return { statusText, lines };
};

export const launchOutcome = (
  code: number | null,
  lines: readonly string[],
  stderr: string,
): LaunchOutcome => {
  const stderrLines = stderr.split(LINE_BREAK).filter((line) => line.trim() !== '');
  const stderrTail = stderrLines.slice(-STDERR_TAIL);
  if (code === 0) return { verdict: 'finished', lines };
  return { verdict: 'failed', lines: [...lines, ...stderrTail] };
};

export const startFailure = (error: unknown): LaunchOutcome => {
  const reason = errorText(error);
  return { verdict: 'failed', lines: [`Could not start launch: ${reason}. ${INSTALL_HINT}`] };
};

const headlineOf = (words: readonly string[], outcome: LaunchOutcome) =>
  `launch ${words.join(' ')} ${outcome.verdict}.`;

export const reportText = (words: readonly string[], outcome: LaunchOutcome) => {
  const headline = headlineOf(words, outcome);
  return [headline, ...outcome.lines].join('\n');
};

// The transcript draws a log as one line, so the report's lines share it.
export const reportLine = (words: readonly string[], outcome: LaunchOutcome) => {
  const headline = headlineOf(words, outcome);
  const details = outcome.lines.join(' · ');
  if (details === '') return headline;
  return `${headline} ${details}`;
};
