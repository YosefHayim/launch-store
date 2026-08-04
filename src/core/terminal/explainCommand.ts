import { Data, Effect, Schema } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import { explainTopic, isGlossaryTopic, listTopics } from './glossary.js';

export const ExplainCommandInputSchema = Schema.Struct({
  topic: Schema.optionalWith(Schema.String, { exact: true }),
});

export type ExplainCommandFailure = Readonly<{
  readonly _tag: 'ExplainCommandFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeExplainCommandFailure =
  Data.tagged<ExplainCommandFailure>('ExplainCommandFailure');

/** Print the glossary index or one requested explanation. */
export const explainCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, ExplainCommandFailure, Logger> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(ExplainCommandInputSchema)(rawCommandInput);
    const logger = yield* createLogger(false);
    if (commandInput.topic === undefined) {
      yield* logger.line(`Topics: ${listTopics().join(', ')}`);
      return;
    }
    if (!isGlossaryTopic(commandInput.topic)) {
      return yield* Effect.fail(
        makeExplainCommandFailure({
          message: `Unknown topic "${commandInput.topic}". Known topics: ${listTopics().join(', ')}`,
          cause: commandInput.topic,
        }),
      );
    }
    yield* logger.line(explainTopic(commandInput.topic));
  }).pipe(
    Effect.mapError((cause) => {
      if (cause._tag === 'ExplainCommandFailure') return cause;
      return makeExplainCommandFailure({ message: 'Could not run the explain command.', cause });
    }),
  );
