#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Cli } from '../cli.js';
import { runAutoUpgrade } from '../config/updateCheck.js';
import { migrateLegacyAccounts } from '../credentials/accounts.js';
import { registerBuiltins } from '../providers/index.js';
import { errorMessage } from '../services/platform/errorMessage.js';
import { createLogger } from '../services/platform/logger.js';
import { isCommandExit } from '../terminal/commandExit.js';

const PACKAGE_MANIFEST_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));

async function readVersion(): Promise<string> {
  try {
    const manifestSource = await readFile(PACKAGE_MANIFEST_PATH, 'utf8');
    const manifest: unknown = JSON.parse(manifestSource);
    const isRecord = typeof manifest == 'object';

    if (isRecord == false) {
      return '0.0.0';
    }

    if (manifest == null) {
      return '0.0.0';
    }

    if ('version' in manifest == false) {
      return '0.0.0';
    }

    const version = manifest.version;
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
    createLogger(false).warn(`Skipped the old account move. ${errorMessage(cause)}`);
  }

  await new Cli().start(launchVersion);
}

main().catch(function reportBootFailure(runtimeFailure: unknown): void {
  if (isCommandExit(runtimeFailure)) {
    process.exitCode = runtimeFailure.exitCode;
    return;
  }

  createLogger(false).error(errorMessage(runtimeFailure));
  process.exitCode = 1;
});
