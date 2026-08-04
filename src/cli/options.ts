import type { Command } from 'commander';
/**
 * The parsed env flags shared by build/release/update. `env` is the raw repeated `--env KEY=VAL`
 * strings (commander collects them); `includeLocal` and `printEnv` are the two booleans. Each
 * command's own options interface extends this shape.
 */
export type EnvFlags = {
  env: string[];
  includeLocal: boolean;
  printEnv: boolean;
};
/** Commander reducer: collect a repeatable string option into an array. */
const collectEnv = (environmentFlag: string, previousFlags: readonly string[]): string[] => {
  return [...previousFlags, environmentFlag];
};
/**
 * Attach `--env`, `--include-local`, and `--print-env` to a command. Returns the command for
 * chaining so it slots into the existing `.option(...).option(...)` builders.
 */
export const addEnvFlags = (command: Command): Command => {
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
};
