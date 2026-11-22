import { stdout } from 'node:process';
import { explainTopic, type GlossaryTopic } from '../../terminal/glossary.ts';
import { formatElapsed } from './elapsed.ts';

type LogWrite = (text: string) => void;

export type Logger = Readonly<{
  withExplanation: (enabled: boolean) => Logger;
  run: (message: string) => void;
  ok: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  skip: (message: string) => void;
  progressStart: (label: string) => void;
  progressDone: (label: string, elapsedMs: number) => void;
  progressFail: (label: string, failureText: string) => void;
  step: (label: string, detail?: string, topic?: GlossaryTopic) => void;
  chip: (chipText: string) => string;
  note: (message: string) => void;
  tip: (message: string) => void;
  notice: (lead: string, ...details: string[]) => void;
  box: (title: string, receiptLines: readonly string[]) => void;
  shipped: (receiptLines: readonly string[]) => void;
  line: (message: string) => void;
  gap: () => void;
}>;

type JsonEvent = Readonly<Record<string, unknown>>;

function statusText(status: 'RUN' | 'OK' | 'WARN' | 'ERROR' | 'SKIP', message: string): string {
  return `[${status}] ${message}\n`;
}

function makeLogger(display: LogWrite, explain: boolean): Logger {
  const logger: Logger = {
    withExplanation: (enabled) => makeLogger(display, enabled),
    run: (message) => display(statusText('RUN', message)),
    ok: (message) => display(statusText('OK', message)),
    warn: (message) => display(statusText('WARN', message)),
    error: (message) => display(statusText('ERROR', message)),
    skip: (message) => display(statusText('SKIP', message)),
    progressStart: (label) => display(statusText('RUN', label)),
    progressDone: (label, elapsedMs) =>
      display(statusText('OK', `${label} - ${formatElapsed(elapsedMs)}`)),
    progressFail: (_label, failureText) => display(statusText('ERROR', failureText)),
    step: (label, detail, topic) => {
      let detailText = '';

      if (detail != null) {
        detailText = ` - ${detail}`;
      }

      display(statusText('RUN', `${label}${detailText}`));

      if (explain == false) {
        return;
      }

      if (topic == null) {
        return;
      }

      for (const explanationLine of explainTopic(topic).split('\n')) {
        display(`  ${explanationLine}\n`);
      }
    },
    chip: (chipText) => chipText,
    note: (message) => display(statusText('RUN', message)),
    tip: (message) => display(statusText('RUN', `Tip: ${message}`)),
    notice: (lead, ...details) => {
      const detailLines = details.map((detail) => `  ${detail}\n`).join('');
      display(`${statusText('RUN', lead)}${detailLines}`);
    },
    box: (title, receiptLines) => {
      const receipt = receiptLines.map((receiptLine) => `  ${receiptLine}\n`).join('');
      display(`${statusText('OK', title)}${receipt}`);
    },
    shipped: (receiptLines) => {
      const receipt = receiptLines.map((receiptLine) => `  ${receiptLine}\n`).join('');
      display(`${statusText('OK', 'Shipped')}${receipt}`);
    },
    line: (message) => display(`${message}\n`),
    gap: () => display('\n'),
  };

  return logger;
}

export function jsonLine(event: JsonEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function makeJsonLogger(emit: (event: JsonEvent) => void, display: LogWrite): Logger {
  const humanLogger = makeLogger(display, false);
  const jsonLogger: Logger = {
    ...humanLogger,
    withExplanation: () => jsonLogger,
    progressStart: (label) => emit({ event: 'progress', label, status: 'start' }),
    progressDone: (label, elapsedMs) =>
      emit({ event: 'progress', label, status: 'done', elapsedMs }),
    progressFail: (label, failureText) => {
      emit({ event: 'progress', label, status: 'fail' });
      humanLogger.progressFail(label, failureText);
    },
    step: (label, detail) => {
      if (detail == null) {
        emit({ event: 'step', step: label });
        return;
      }

      emit({ event: 'step', step: label, detail });
    },
    warn: (message) => emit({ event: 'warn', message }),
    note: (message) => emit({ event: 'note', message }),
    tip: (message) => emit({ event: 'note', message: `Tip: ${message}` }),
    box: (title, receiptLines) => emit({ event: 'box', title, lines: receiptLines }),
  };

  return jsonLogger;
}

function writeStdout(text: string): void {
  stdout.write(text);
}

let writeText: LogWrite = writeStdout;
let writeJsonHuman: LogWrite | null = null;

export function useLoggerSink(write: LogWrite): void {
  writeText = write;
}

export function useJsonHumanWriter(write: LogWrite | null): void {
  writeJsonHuman = write;
}

export function resetLogger(): void {
  writeText = writeStdout;
  writeJsonHuman = null;
}

function createJsonLogger(writeHuman: LogWrite): Logger {
  return makeJsonLogger((event) => {
    writeText(jsonLine(event));
  }, writeHuman);
}

export function createLogger(explain: boolean): Logger {
  if (writeJsonHuman != null) {
    return createJsonLogger(writeJsonHuman);
  }

  return makeLogger(writeText, explain);
}
