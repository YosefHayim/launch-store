// Notes where a listing belongs, and writes the secret names a migration still needs filled in.

import { join } from 'node:path';
import { ENV_EXAMPLE_TEMPLATE } from '../config/config-scaffold.ts';
import { pathExists } from '../path-exists.ts';
import type { MigrationArtifact, MigrationNote } from '../types/migrate.ts';

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

/** Point a migration at `listing` in launch.config.ts. Never emit a JSON sidecar. */
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
          'store.config.json is no longer read. Move its listing into launch.config.ts under listing.',
      },
    };
  }

  return {
    artifact: null,
    note: {
      level: 'manual',
      message:
        'Add a listing entry to launch.config.ts, or run `launch-store metadata pull` and paste the printed listing.',
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
