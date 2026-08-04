import { Terminal } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Context, Effect, Layer } from 'effect';
import { explainTopic, type GlossaryTopic } from '../terminal/glossary.js';

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

/** Live logger backed by Effect Platform's terminal implementation. */
export const LaunchLoggerLive = Layer.effect(
  LaunchLogger,
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    return makeLogger(terminal.display, false);
  }),
);

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
