import type { Command } from './command.ts';

/** Environment flags shared by build, release, and update. They change one run. */
export type EnvironmentFlags = {
  env: string[];
  includeLocal: boolean;
};

function collectEnvironmentFlag(
  environmentFlag: string,
  previousFlags: readonly string[],
): string[] {
  return [...previousFlags, environmentFlag];
}

/** Attach `--env` and `--include-local`. These do not write launch.config.ts or print it. */
export function addEnvironmentFlags(command: Command): Command {
  return command
    .option(
      '--env <KEY=VALUE>',
      'inline env override (repeatable); highest precedence',
      collectEnvironmentFlag,
      [],
    )
    .option(
      '--include-local',
      'also load .env.local (off by default to avoid surprise local env)',
      false,
    );
}
