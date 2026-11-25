#!/usr/bin/env node
// Routes the launch command to one of the seven commands.

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAdopt } from '@/commands/adopt.js';
import { runBuild } from '@/commands/build.js';
import { runCredentials } from '@/commands/credentials.js';
import { runInit } from '@/commands/init.js';
import { runPlan } from '@/commands/plan.js';
import { runRelease } from '@/commands/release.js';
import { runSync } from '@/commands/sync.js';

export function createUsageError(message: string): Error {
  const error = new Error(message);
  error.name = 'UsageError';

  return error;
}

const commands: Record<string, (argv: string[]) => Promise<void>> = {
  init: runInit,
  credentials: runCredentials,
  build: runBuild,
  release: runRelease,
  plan: runPlan,
  sync: runSync,
  adopt: runAdopt,
};

export async function main(): Promise<void> {
  const name = process.argv[2];
  const isVersion = name === '--version';

  if (isVersion) {
    console.log(readPackageVersion());

    return;
  }

  const isHelpFlag = name === '--help';

  if (isHelpFlag) {
    printCommands();

    return;
  }

  const isHelpWord = name === 'help';

  if (isHelpWord) {
    printCommands();

    return;
  }

  const isMissing = name == null;

  if (isMissing) {
    printCommands();
    process.exitCode = 2;

    return;
  }

  const run = commands[name];
  const isUnknown = run == null;

  if (isUnknown) {
    printCommands();
    process.exitCode = 2;

    return;
  }

  try {
    await run(process.argv.slice(3));
  } catch (error) {
    const isError = error instanceof Error;

    if (isError) {
      reportCommandError(error);

      return;
    }

    console.error(String(error));
    process.exitCode = 1;
  }
}

function reportCommandError(error: Error): void {
  const isUsage = error.name === 'UsageError';

  if (isUsage) {
    console.error(error.message);
    process.exitCode = 2;

    return;
  }

  console.error(error.message);
  process.exitCode = 1;
}

function printCommands(): void {
  console.log(`Commands:
  launch init
  launch credentials apple --key-id ID --issuer-id ID --p8 AuthKey.p8
  launch credentials google --package com.example.app --json play.json
  launch build ios
  launch build android
  launch release ios
  launch release android
  launch plan
  launch sync
  launch adopt`);
}

function readPackageVersion(): string {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
  const packageFile = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string };
  const version = packageFile.version;
  const isMissing = typeof version !== 'string';

  if (isMissing) {
    return '0.0.0';
  }

  return version;
}

function isCliEntry(): boolean {
  const entryPath = process.argv[1];
  const isMissing = entryPath == null;

  if (isMissing) {
    return false;
  }

  return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entryPath));
}

const isDirectRun = isCliEntry();

if (isDirectRun) {
  await main();
}
