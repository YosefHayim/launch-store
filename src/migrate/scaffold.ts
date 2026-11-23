// Adds a starter store config and the secret names a migration still needs filled in.

import { join } from 'node:path';
import { ENV_EXAMPLE_TEMPLATE } from '../config/config-scaffold.ts';
import { pathExists } from '../path-exists.ts';
import { serializeStoreConfig, type StoreConfig } from '../store/shared/store-config.ts';
import type { MigrationArtifact, MigrationNote } from '../types/migrate.ts';

/** Fill-in-the-blanks `store.config.json` skeleton (EAS metadata schema for iOS). */
const storeConfigSkeleton: StoreConfig = {
  configVersion: 0,
  apple: { info: { 'en-US': { title: '', subtitle: '', description: '', keywords: [] } } },
};

type StoreScaffoldDecision = Readonly<{
  artifact: MigrationArtifact | null;
  note: MigrationNote;
}>;

function isCommentLine(line: string): boolean {
  return line.startsWith('#');
}

function blankEnvLine(key: string): string {
  return `${key}=`;
}

/** Emit a skeleton `store.config.json` when absent, or skip when present. */
export async function scaffoldStoreConfig(
  workingDirectory: string,
): Promise<StoreScaffoldDecision> {
  const configPath = join(workingDirectory, 'store.config.json');

  const configExists = await pathExists(configPath);

  if (configExists) {
    return {
      artifact: null,
      note: {
        level: 'skipped',
        message:
          'store.config.json already present - Launch uses it verbatim (same schema as EAS metadata).',
      },
    };
  }

  return {
    artifact: {
      path: 'store.config.json',
      contents: serializeStoreConfig(storeConfigSkeleton),
    },
    note: {
      level: 'manual',
      message:
        'Scaffolded store.config.json - fill in your listing, or run `launch-store metadata pull` to import the live App Store listing.',
    },
  };
}

/** `.env.example` body from imported env KEYS only (values dropped; may be secrets). */
export function buildEnvExample(keys: readonly string[]): string {
  const hasNoKeys = keys.length == 0;

  if (hasNoKeys) {
    return ENV_EXAMPLE_TEMPLATE;
  }

  const header = ENV_EXAMPLE_TEMPLATE.split('\n').filter(isCommentLine).join('\n');
  const keyLines = keys.map(blankEnvLine).join('\n');

  return `${header}\n${keyLines}\n`;
}
