import { Data, Effect, Schema } from 'effect';

/** A completed command that intentionally requests a non-zero process exit code. */
export type CommandExit = Readonly<{
  readonly _tag: 'CommandExit';
  readonly exitCode: number;
}>;

/** Runtime decoder used by the CLI entrypoint for an uncaught command outcome. */
export const CommandExitSchema = Schema.Struct({
  _tag: Schema.Literal('CommandExit'),
  exitCode: Schema.Number,
});

export const makeCommandExit = Data.tagged<CommandExit>('CommandExit');

/** Complete normally for exit zero or fail with the requested non-zero outcome. */
export const completeCommand = (exitCode: number): Effect.Effect<void, CommandExit> => {
  if (exitCode === 0) return Effect.void;
  return Effect.fail(makeCommandExit({ exitCode }));
};
