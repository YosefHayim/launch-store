import { Terminal } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Context, Effect, Layer } from 'effect';
import { explainTopic, type GlossaryTopic } from '../terminal/glossary.js';
import { formatElapsed } from './elapsed.js';

/** One logger write that may fail when the process terminal cannot accept output. */
type LogWrite = Effect.Effect<void, PlatformError>;

/**
 * Run-scoped terminal output with stable ASCII status markers.
 *
 * Every write is an Effect so production output stays behind the platform Terminal service. `chip`
 * only formats an already-resolved value and therefore remains pure.
 */
export type Logger = Readonly<{
  readonly withExplanation: (enabled: boolean) => Logger;
  readonly run: (message: string) => LogWrite;
  readonly ok: (message: string) => LogWrite;
  readonly warn: (message: string) => LogWrite;
  readonly error: (message: string) => LogWrite;
  readonly skip: (message: string) => LogWrite;
  readonly progressStart: (label: string) => LogWrite;
  readonly progressDone: (label: string, elapsedMs: number) => LogWrite;
  readonly progressFail: (label: string, failureText: string) => LogWrite;
  readonly step: (label: string, detail?: string, topic?: GlossaryTopic) => LogWrite;
  readonly chip: (chipText: string) => string;
  readonly note: (message: string) => LogWrite;
  readonly tip: (message: string) => LogWrite;
  readonly notice: (lead: string, ...details: string[]) => LogWrite;
  readonly box: (title: string, receiptLines: readonly string[]) => LogWrite;
  readonly shipped: (receiptLines: readonly string[]) => LogWrite;
  readonly line: (message: string) => LogWrite;
  readonly gap: () => LogWrite;
}>;

/** Logger service consumed by core programs and provided once at the application boundary. */
export const LaunchLogger = Context.GenericTag<Logger>('launch-store/Logger');

/** Join a status marker and message into one newline-terminated terminal write. */
const statusText = (status: 'RUN' | 'OK' | 'WARN' | 'ERROR' | 'SKIP', message: string): string => {
  return `[${status}] ${message}\n`;
};

/** Build one logger view over a terminal writer and an explanation preference. */
const makeLogger = (display: (text: string) => LogWrite, explain: boolean): Logger => {
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
    step: (label, detail, topic) =>
      Effect.gen(function* () {
        let detailText = '';
        if (detail !== undefined) detailText = ` - ${detail}`;
        yield* display(statusText('RUN', `${label}${detailText}`));
        if (explain && topic !== undefined) {
          for (const explanationLine of explainTopic(topic).split('\n'))
            yield* display(`  ${explanationLine}\n`);
        }
      }),
    chip: (chipText) => chipText,
    note: (message) => display(statusText('RUN', message)),
    tip: (message) => display(statusText('RUN', `Tip: ${message}`)),
    notice: (lead, ...details) =>
      display(`${statusText('RUN', lead)}${details.map((detail) => `  ${detail}\n`).join('')}`),
    box: (title, receiptLines) =>
      display(
        `${statusText('OK', title)}${receiptLines.map((receiptLine) => `  ${receiptLine}\n`).join('')}`,
      ),
    shipped: (receiptLines) =>
      display(
        `${statusText('OK', 'Shipped')}${receiptLines.map((receiptLine) => `  ${receiptLine}\n`).join('')}`,
      ),
    line: (message) => display(`${message}\n`),
    gap: () => display('\n'),
  };
  return logger;
};

/** One NDJSON event of the `--json` stream. */
export type JsonEvent = Readonly<Record<string, unknown>>;

/** Serialize one event as a single newline-terminated NDJSON line. */
export const jsonLine = (event: JsonEvent): string => `${JSON.stringify(event)}\n`;

/**
 * Logger for `--json`: step, progress, warn, note, tip and box become NDJSON events on `emit`; every other
 * write is human text and goes to `display` (stderr), so stdout carries only events.
 */
const makeJsonLogger = (
  emit: (event: JsonEvent) => LogWrite,
  display: (text: string) => LogWrite,
) => {
  const humanLogger = makeLogger(display, false);
  const jsonLogger: Logger = {
    ...humanLogger,
    withExplanation: () => jsonLogger,
    progressStart: (label) => emit({ event: 'progress', label, status: 'start' }),
    progressDone: (label, elapsedMs) =>
      emit({ event: 'progress', label, status: 'done', elapsedMs }),
    progressFail: (label, failureText) =>
      Effect.gen(function* () {
        yield* emit({ event: 'progress', label, status: 'fail' });
        yield* humanLogger.progressFail(label, failureText);
      }),
    step: (label, detail) => {
      if (detail === undefined) return emit({ event: 'step', step: label });
      return emit({ event: 'step', step: label, detail });
    },
    warn: (message) => emit({ event: 'warn', message }),
    note: (message) => emit({ event: 'note', message }),
    tip: (message) => emit({ event: 'note', message: `Tip: ${message}` }),
    box: (title, receiptLines) => emit({ event: 'box', title, lines: receiptLines }),
  };
  return jsonLogger;
};

/** Live logger backed by Effect Platform's terminal implementation. */
export const LaunchLoggerLive = Layer.effect(
  LaunchLogger,
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    return makeLogger(terminal.display, false);
  }),
);

/** `--json` logger layer: events on the platform terminal's stdout, human text through `writeHuman` (stderr). */
export const makeLaunchLoggerJson = (
  writeHuman: (text: string) => LogWrite,
): Layer.Layer<Logger, never, Terminal.Terminal> =>
  Layer.effect(
    LaunchLogger,
    Effect.gen(function* () {
      const terminal = yield* Terminal.Terminal;
      const emitEvent = (event: JsonEvent): LogWrite => terminal.display(jsonLine(event));
      return makeJsonLogger(emitEvent, writeHuman);
    }),
  );

/** Build a `--json` logger layer that appends each event line to `eventLines` and human text to `humanLines`. */
export const makeLaunchLoggerJsonTest = (
  eventLines: string[],
  humanLines: string[],
): Layer.Layer<Logger> => {
  return Layer.succeed(
    LaunchLogger,
    makeJsonLogger(
      (event) =>
        Effect.sync(() => {
          eventLines.push(jsonLine(event));
        }),
      (humanText) =>
        Effect.sync(() => {
          humanLines.push(humanText);
        }),
    ),
  );
};

/** Build a deterministic logger layer that appends every terminal write to `lines`. */
export const makeLaunchLoggerTest = (lines: string[]): Layer.Layer<Logger> => {
  return Layer.succeed(
    LaunchLogger,
    makeLogger(
      (terminalText) =>
        Effect.sync(() => {
          lines.push(terminalText);
        }),
      false,
    ),
  );
};

/** Resolve a logger view for one command's `--explain` preference. */
export const createLogger = (explain: boolean): Effect.Effect<Logger, never, Logger> => {
  return LaunchLogger.pipe(Effect.map((logger) => logger.withExplanation(explain)));
};

/** Print the setup completion marker through the platform terminal. */
export const outroDone = (): Effect.Effect<void, PlatformError, Terminal.Terminal> =>
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    yield* terminal.display(statusText('OK', 'Done.'));
  });
