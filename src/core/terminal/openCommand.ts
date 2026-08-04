import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger } from '../services/logger.js';
import { openUrl, resolveOpenUrl } from './consoleLinks.js';

export const OpenCommandInputSchema = Schema.Struct({
  target: Schema.optionalWith(Schema.String, { exact: true }),
  platform: Schema.optionalWith(Schema.String, { exact: true }),
  app: Schema.optionalWith(Schema.String, { exact: true }),
});

export type OpenCommandInput = Schema.Schema.Type<typeof OpenCommandInputSchema>;

export type OpenCommandFailure = Readonly<{
  readonly _tag: 'OpenCommandFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeOpenCommandFailure = Data.tagged<OpenCommandFailure>('OpenCommandFailure');

/** Resolve a store-console URL, print it, and open it with the host browser. */
export const openCommandProgram = (rawCommandInput: unknown) =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(OpenCommandInputSchema)(rawCommandInput);
    const openOptions: { platform?: string; app?: string } = {};
    if (commandInput.platform !== undefined) openOptions.platform = commandInput.platform;
    if (commandInput.app !== undefined) openOptions.app = commandInput.app;
    const consoleUrl = yield* resolveOpenUrl(commandInput.target, openOptions);
    const logger = yield* createLogger(false);
    yield* logger.line(`Opening ${consoleUrl}`);
    yield* openUrl(consoleUrl);
  }).pipe(
    Effect.mapError((cause) => makeOpenCommandFailure({ message: errorMessage(cause), cause })),
  );
