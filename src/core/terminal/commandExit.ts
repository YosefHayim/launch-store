import { Data, Effect, Schema } from 'effect';

/** A completed command that intentionally requests a non-zero process exit code. */
export type CommandExit = Readonly<{
  readonly _tag: 'CommandExit';
  readonly exitCode: number;
  readonly message?: string;
}>;

/** Runtime decoder used by the CLI entrypoint for an uncaught command outcome. */
export const CommandExitSchema = Schema.Struct({
  _tag: Schema.Literal('CommandExit'),
  exitCode: Schema.Number,
  message: Schema.optionalWith(Schema.String, { exact: true }),
});

export const makeCommandExit = Data.tagged<CommandExit>('CommandExit');

/** Complete normally for exit zero or fail with the requested non-zero outcome and, optionally, its reason. */
export const completeCommand = (
  exitCode: number,
  message?: string,
): Effect.Effect<void, CommandExit> => {
  if (exitCode === 0) return Effect.void;
  if (message === undefined) return Effect.fail(makeCommandExit({ exitCode }));
  return Effect.fail(makeCommandExit({ exitCode, message }));
};
