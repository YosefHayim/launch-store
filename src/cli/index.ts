#!/usr/bin/env node
import { FileSystem } from '@effect/platform';
import { Cause, Effect, Option, Runtime, Schema } from 'effect';
import { fileURLToPath } from 'node:url';
import { registerBuiltins } from '../providers/index.js';
import { migrateLegacyAccounts } from '../core/credentials/accounts.js';
import { runAutoUpgrade } from '../core/config/updateCheck.js';
import { CommandExitSchema } from '../core/terminal/commandExit.js';
import { createLogger } from '../core/services/logger.js';
import { LaunchEnvironment } from '../core/services/environment.js';
import { renderBanner } from '../core/terminal/banner.js';
import { runWizard } from './commands/wizard.js';
import { buildProgram } from './program.js';
import { runCliProgram } from './runCliProgram.js';

const PackageManifestJsonSchema = Schema.parseJson(Schema.Struct({ version: Schema.String }));
const PACKAGE_MANIFEST_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));

const readVersion = (): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const manifestSource = yield* fileSystem
      .readFileString(PACKAGE_MANIFEST_PATH)
      .pipe(Effect.orElseSucceed(() => '{}'));
    const manifest = Option.getOrNull(
      Schema.decodeUnknownOption(PackageManifestJsonSchema)(manifestSource),
    );
    if (manifest === null) return '0.0.0';
    return manifest.version;
  });
/**
 * Boot the CLI: register providers, silently self-upgrade (guarded/throttled - usually an instant
 * no-op), then let commander dispatch. With no subcommand it falls through to the banner + wizard;
 * with a subcommand it runs that command. Both the upgrade and the banner degrade to no-ops in CI,
 * when piped, and for agents, so scripts are unaffected.
 */
const main = async () => {
  const launchVersion = await runCliProgram(readVersion());
  await runCliProgram(registerBuiltins());
  let scriptPath = '';
  if (process.argv[1] !== undefined) scriptPath = process.argv[1];
  await runCliProgram(
    runAutoUpgrade(launchVersion, {
      executablePath: process.execPath,
      commandArguments: process.argv.slice(1),
      terminalIsInteractive: process.stdout.isTTY === true,
      scriptPath,
    }),
  );
  // One-time, near-instant no-op after the first post-upgrade run: moves a pre-multi-account key into
  // the registry. Best-effort - a hiccup must not block the CLI; commands re-attempt it on next run.
  await runCliProgram(migrateLegacyAccounts().pipe(Effect.catchAll(() => Effect.void)));
  await buildProgram(launchVersion, () =>
    runCliProgram(
      Effect.gen(function* () {
        const environment = yield* LaunchEnvironment;
        yield* renderBanner({
          stream: process.stdout,
          isTTY: process.stdout.isTTY === true,
          env: environment.rawVariables,
        });
      }),
    ).then(runWizard),
  ).parseAsync(process.argv);
};
main().catch(async (runtimeFailure: unknown) => {
  if (Runtime.isFiberFailure(runtimeFailure)) {
    const commandFailure = Cause.failureOption(runtimeFailure[Runtime.FiberFailureCauseId]);
    if (Option.isSome(commandFailure)) {
      const commandExit = Schema.decodeUnknownOption(CommandExitSchema)(commandFailure.value);
      if (Option.isSome(commandExit)) {
        process.exitCode = commandExit.value.exitCode;
        return;
      }
    }
  }
  let runtimeMessage: string;
  if (runtimeFailure instanceof Error) runtimeMessage = runtimeFailure.message;
  else runtimeMessage = String(runtimeFailure);
  await runCliProgram(
    createLogger(false).pipe(Effect.flatMap((logger) => logger.error(runtimeMessage))),
  ).catch(() => undefined);
  process.exitCode = 1;
});
