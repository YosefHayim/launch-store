#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Cli } from '../cli.ts';
import { runAutoUpgrade } from '../config/update-check.ts';
import { migrateLegacyAccounts } from '../credentials/accounts.ts';
import { registerBuiltins } from '../providers/index.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { createLogger } from '../services/platform/logger.ts';
import { isCommandExit } from '../terminal/command-exit.ts';

const packageManifestPath = fileURLToPath(new URL('../../package.json', import.meta.url));

async function readVersion(): Promise<string> {
  try {
    const manifestSource = await readFile(packageManifestPath, 'utf8');
    const manifest: unknown = JSON.parse(manifestSource);
    const manifestObject = readPlainObject(manifest);

    if (manifestObject == null) {
      return '0.0.0';
    }

    const version = manifestObject['version'];
    const isVersionText = typeof version == 'string';

    if (isVersionText == false) {
      return '0.0.0';
    }

    return version;
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const launchVersion = await readVersion();

  await registerBuiltins();

  let scriptPath = '';

  if (process.argv[1] != null) {
    scriptPath = process.argv[1];
  }

  const terminalIsInteractive = process.stdout.isTTY == true;

  await runAutoUpgrade(launchVersion, {
    executablePath: process.execPath,
    commandArguments: process.argv.slice(2),
    terminalIsInteractive,
    scriptPath,
  });

  try {
    await migrateLegacyAccounts();
  } catch (cause) {
    const failureMessage = errorMessage(cause);
    createLogger(false).warn(`Skipped the old account move. ${failureMessage}`);
  }

  await new Cli().start(launchVersion);
}

main().catch(function reportBootFailure(runtimeFailure: unknown): void {
  if (isCommandExit(runtimeFailure)) {
    process.exitCode = runtimeFailure.exitCode;
    return;
  }

  const failureMessage = errorMessage(runtimeFailure);

  createLogger(false).error(failureMessage);
  process.exitCode = 1;
});
