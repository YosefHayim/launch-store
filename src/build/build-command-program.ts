import { runBuild } from './pipeline.ts';
import { setVerboseOutput } from '../services/platform/progress.ts';
import { type BuildCommandOptions, parseBuildCommandInput } from './build-command-input.ts';
import { hasMessage } from '../services/platform/error-message.ts';

/** The build pipeline failed while executing a decoded build command. */
type BuildCommandExecutionError = Readonly<{
  readonly _tag: 'BuildCommandExecutionError';
  readonly message: string;
  readonly cause: unknown;
}>;

export function makeBuildCommandExecutionError(fields: {
  message: string;
  cause: unknown;
}): BuildCommandExecutionError {
  return {
    _tag: 'BuildCommandExecutionError',
    message: fields.message,
    cause: fields.cause,
  };
}

function wrapBuildFailure(cause: unknown): BuildCommandExecutionError {
  let failureMessage = 'Build command failed.';

  const causeHasMessage = hasMessage(cause);

  if (causeHasMessage) {
    failureMessage = cause.message;
  }

  return makeBuildCommandExecutionError({ message: failureMessage, cause });
}

export async function buildCommandProgram(
  platformArgument: string,
  commandOptions: BuildCommandOptions,
): Promise<void> {
  const buildRunOptions = await parseBuildCommandInput(platformArgument, commandOptions);

  setVerboseOutput(commandOptions.verbose);

  try {
    await runBuild(buildRunOptions);
  } catch (cause) {
    throw wrapBuildFailure(cause);
  }
}
