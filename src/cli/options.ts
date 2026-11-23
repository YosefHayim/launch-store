import type { Command } from './command.ts';
/** The parsed env flags shared by build/release/update. */
export type EnvFlags = {
  env: string[];
  includeLocal: boolean;
  printEnv: boolean;
};
/** Commander reducer: collect a repeatable string option into an array. */
function collectEnv(environmentFlag: string, previousFlags: readonly string[]): string[] {
  return [...previousFlags, environmentFlag];
}
/** Attach `--env`, `--include-local`, and `--print-env` to a command. */
export function addEnvFlags(command: Command): Command {
  return command
    .option(
      '--env <KEY=VALUE>',
      'inline env override (repeatable); highest precedence',
      collectEnv,
      [],
    )
    .option(
      '--include-local',
      'also load .env.local (off by default to avoid surprise local env)',
      false,
    )
    .option(
      '--print-env',
      'print the resolved env (masked) with its sources, then exit without running',
      false,
    );
}
