// Prints a line or an error, or one JSON event per line, with secrets hidden.

import { stdout } from 'node:process';
import { formatElapsed } from './elapsed.ts';
import { redactText } from './redact.ts';

type LogWrite = (text: string) => void;

type JsonEvent = Readonly<Record<string, unknown>>;

export class Logger {
  constructor(private readonly write: (text: string) => void) {}

  line = (message: string): void => {
    this.write(`${message}\n`);
  };

  run = (message: string): void => {
    this.line(message);
  };

  ok = (message: string): void => {
    this.line(message);
  };

  warn = (message: string): void => {
    this.line(message);
  };

  error = (message: string): void => {
    this.line(message);
  };

  skip = (message: string): void => {
    this.line(message);
  };

  note = (message: string): void => {
    this.line(message);
  };

  progressStart = (label: string): void => {
    this.line(label);
  };

  progressDone = (label: string, elapsedMs: number): void => {
    const elapsedLabel = formatElapsed(elapsedMs);

    this.line(`${label} - ${elapsedLabel}`);
  };

  progressFail = (label: string, failureText: string): void => {
    void label;

    this.line(failureText);
  };

  step = (label: string, detail?: string, topic?: string): void => {
    void topic;

    let detailText = '';

    if (detail != null) {
      detailText = ` - ${detail}`;
    }

    this.line(`${label}${detailText}`);
  };

  chip = (chipText: string): string => {
    return chipText;
  };

  tip = (message: string): void => {
    this.line(message);
  };

  notice = (lead: string, ...details: string[]): void => {
    function indentNoticeLine(detail: string): string {
      return `  ${detail}\n`;
    }

    const detailLines = details.map(indentNoticeLine).join('');

    this.write(`${lead}\n${detailLines}`);
  };

  box = (title: string, receiptLines: readonly string[]): void => {
    function indentReceiptLine(receiptLine: string): string {
      return `  ${receiptLine}\n`;
    }

    const receipt = receiptLines.map(indentReceiptLine).join('');

    this.write(`${title}\n${receipt}`);
  };

  shipped = (receiptLines: readonly string[]): void => {
    this.box('Shipped', receiptLines);
  };

  gap = (): void => {
    this.write('\n');
  };
}

class JsonLogger extends Logger {
  constructor(
    private readonly emitEvent: (event: JsonEvent) => void,
    humanWrite: LogWrite,
  ) {
    super(humanWrite);
  }

  override warn = (message: string): void => {
    this.emitEvent({ event: 'warn', message });
  };

  override note = (message: string): void => {
    this.emitEvent({ event: 'note', message });
  };

  override tip = (message: string): void => {
    this.emitEvent({ event: 'note', message: `Tip: ${message}` });
  };

  override step = (label: string, detail?: string): void => {
    if (detail == null) {
      this.emitEvent({ event: 'step', step: label });
      return;
    }

    this.emitEvent({ event: 'step', step: label, detail });
  };

  override progressStart = (label: string): void => {
    this.emitEvent({ event: 'progress', label, status: 'start' });
  };

  override progressDone = (label: string, elapsedMs: number): void => {
    this.emitEvent({ event: 'progress', label, status: 'done', elapsedMs });
  };

  override progressFail = (label: string, failureText: string): void => {
    this.emitEvent({ event: 'progress', label, status: 'fail' });
    this.line(failureText);
  };

  override box = (title: string, receiptLines: readonly string[]): void => {
    this.emitEvent({ event: 'box', title, lines: receiptLines });
  };
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

export function jsonLine(event: JsonEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function redactingWrite(write: LogWrite): LogWrite {
  function writeRedacted(text: string): void {
    write(redactText(text));
  }

  return writeRedacted;
}

function createJsonLogger(writeHuman: LogWrite): Logger {
  function emitEvent(event: JsonEvent): void {
    const machineLine = jsonLine(event);

    writeText(redactText(machineLine));
  }

  return new JsonLogger(emitEvent, redactingWrite(writeHuman));
}

export function createLogger(explain: boolean): Logger {
  void explain;

  if (writeJsonHuman != null) {
    return createJsonLogger(writeJsonHuman);
  }

  return new Logger(redactingWrite(writeText));
}
