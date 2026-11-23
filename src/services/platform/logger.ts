// Prints run, warning, and progress lines, or one JSON event per line, with secrets hidden.

import { stdout } from 'node:process';
import { explainTopic, type GlossaryTopic } from '../../terminal/glossary.ts';
import { formatElapsed } from './elapsed.ts';
import { redactText } from './redact.ts';

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

function redactingWrite(write: LogWrite): LogWrite {
  function writeRedacted(text: string): void {
    write(redactText(text));
  }

  return writeRedacted;
}

function makeLogger(display: LogWrite, explain: boolean): Logger {
  const logger: Logger = {
    withExplanation(enabled) {
      return makeLogger(display, enabled);
    },
    run(message) {
      const statusLine = statusText('RUN', message);
      return display(statusLine);
    },
    ok(message) {
      const statusLine = statusText('OK', message);
      return display(statusLine);
    },
    warn(message) {
      const statusLine = statusText('WARN', message);
      return display(statusLine);
    },
    error(message) {
      const statusLine = statusText('ERROR', message);
      return display(statusLine);
    },
    skip(message) {
      const statusLine = statusText('SKIP', message);
      return display(statusLine);
    },
    progressStart(label) {
      const statusLine = statusText('RUN', label);
      return display(statusLine);
    },
    progressDone(label, elapsedMs) {
      const elapsedLabel = formatElapsed(elapsedMs);
      const statusLine = statusText('OK', `${label} - ${elapsedLabel}`);
      return display(statusLine);
    },
    progressFail(_label, failureText) {
      const statusLine = statusText('ERROR', failureText);
      return display(statusLine);
    },
    step(label, detail, topic) {
      let detailText = '';

      if (detail != null) {
        detailText = ` - ${detail}`;
      }

      const statusLine = statusText('RUN', `${label}${detailText}`);

      display(statusLine);

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
    chip(chipText) {
      return chipText;
    },
    note(message) {
      const statusLine = statusText('RUN', message);
      return display(statusLine);
    },
    tip(message) {
      const statusLine = statusText('RUN', `Tip: ${message}`);
      return display(statusLine);
    },
    notice(lead, ...details) {
      function indentNoticeLine(detail: string) {
        return `  ${detail}\n`;
      }

      const detailLines = details.map(indentNoticeLine).join('');
      const statusLine = statusText('RUN', lead);

      display(`${statusLine}${detailLines}`);
    },
    box(title, receiptLines) {
      function indentReceiptLine(receiptLine: string) {
        return `  ${receiptLine}\n`;
      }

      const receipt = receiptLines.map(indentReceiptLine).join('');
      const statusLine = statusText('OK', title);

      display(`${statusLine}${receipt}`);
    },
    shipped(receiptLines) {
      function indentReceiptLine(receiptLine: string) {
        return `  ${receiptLine}\n`;
      }

      const receipt = receiptLines.map(indentReceiptLine).join('');
      const statusLine = statusText('OK', 'Shipped');

      display(`${statusLine}${receipt}`);
    },
    line(message) {
      return display(`${message}\n`);
    },
    gap() {
      return display('\n');
    },
  };

  return logger;
}

export function jsonLine(event: JsonEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function makeJsonLogger(emit: (event: JsonEvent) => void, display: LogWrite): Logger {
  const humanLogger = makeLogger(redactingWrite(display), false);
  const jsonLogger: Logger = {
    ...humanLogger,
    withExplanation() {
      return jsonLogger;
    },
    progressStart(label) {
      return emit({ event: 'progress', label, status: 'start' });
    },
    progressDone(label, elapsedMs) {
      return emit({ event: 'progress', label, status: 'done', elapsedMs });
    },
    progressFail(label, failureText) {
      emit({ event: 'progress', label, status: 'fail' });
      humanLogger.progressFail(label, failureText);
    },
    step(label, detail) {
      if (detail == null) {
        emit({ event: 'step', step: label });
        return;
      }

      emit({ event: 'step', step: label, detail });
    },
    warn(message) {
      return emit({ event: 'warn', message });
    },
    note(message) {
      return emit({ event: 'note', message });
    },
    tip(message) {
      return emit({ event: 'note', message: `Tip: ${message}` });
    },
    box(title, receiptLines) {
      return emit({ event: 'box', title, lines: receiptLines });
    },
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
  function makePieceLoggerEvent(event: { readonly [x: string]: unknown }) {
    const machineLine = jsonLine(event);

    writeText(redactText(machineLine));
  }

  return makeJsonLogger(makePieceLoggerEvent, writeHuman);
}

export function createLogger(explain: boolean): Logger {
  if (writeJsonHuman != null) {
    return createJsonLogger(writeJsonHuman);
  }

  return makeLogger(redactingWrite(writeText), explain);
}
