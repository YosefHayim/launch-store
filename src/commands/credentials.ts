// Saves the Apple key or the Play service account into the keychain.

import { readFile } from 'node:fs/promises';

import type { AppleKey } from '@/apple/app-store-connect.js';
import { Keychain } from '@/credentials/keychain.js';
import { createUsageError } from '@/cli.js';

export async function runCredentials(argv: string[]): Promise<void> {
  const kind = argv[0];
  const isApple = kind === 'apple';

  if (isApple) {
    await saveApple(argv.slice(1));

    return;
  }

  const isGoogle = kind === 'google';

  if (isGoogle) {
    await saveGoogle(argv.slice(1));

    return;
  }

  throw createUsageError(
    'launch credentials apple --key-id ID --issuer-id ID --p8 AuthKey.p8\nlaunch credentials google --package com.example.app --json play.json',
  );
}

async function saveApple(argv: string[]): Promise<void> {
  const key: AppleKey = {
    keyId: readFlag(argv, '--key-id'),
    issuerId: readFlag(argv, '--issuer-id'),
    privateKey: await readFile(readFlag(argv, '--p8'), 'utf8'),
  };
  await new Keychain().saveApple(key);
  console.log('[OK] saved the Apple key');
}

async function saveGoogle(argv: string[]): Promise<void> {
  const packageName = readFlag(argv, '--package');
  const serviceAccountJson = await readFile(readFlag(argv, '--json'), 'utf8');
  await new Keychain().saveGoogle(packageName, serviceAccountJson);
  console.log('[OK] saved the Play account');
}

function readFlag(argv: string[], flagName: string): string {
  const flagIndex = argv.indexOf(flagName);
  const isFlagMissing = flagIndex === -1;

  if (isFlagMissing) {
    throw createUsageError(`${flagName} needs a value`);
  }

  const flagValue = argv[flagIndex + 1];
  const isValueMissing = flagValue == null;

  if (isValueMissing) {
    throw createUsageError(`${flagName} needs a value`);
  }

  const isAnotherFlag = flagValue.startsWith('--');

  if (isAnotherFlag) {
    throw createUsageError(`${flagName} needs a value`);
  }

  return flagValue;
}
