import { FileSystem, Path } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Effect } from 'effect';
import { ENV_EXAMPLE_TEMPLATE } from '../config/configScaffold.js';
import { serializeStoreConfig, type StoreConfig } from '../store/storeConfig.js';
import type { MigrationArtifact, MigrationNote } from '../types/migrate.js';

/** Fill-in-the-blanks `store.config.json` skeleton (EAS metadata schema for iOS). */
const STORE_CONFIG_SKELETON: StoreConfig = {
  configVersion: 0,
  apple: { info: { 'en-US': { title: '', subtitle: '', description: '', keywords: [] } } },
};

export type StoreScaffoldDecision = Readonly<{
  artifact: MigrationArtifact | null;
  note: MigrationNote;
}>;

/**
 * Emit a skeleton `store.config.json` when absent, or skip when present.
 * Shared by EAS and Fastlane migrations.
 */
export const scaffoldStoreConfig = (
  workingDirectory: string,
): Effect.Effect<StoreScaffoldDecision, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    if (yield* fileSystem.exists(pathService.join(workingDirectory, 'store.config.json'))) {
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
        contents: serializeStoreConfig(STORE_CONFIG_SKELETON),
      },
      note: {
        level: 'manual',
        message:
          'Scaffolded store.config.json - fill in your listing, or run `launch metadata pull` to import the live App Store listing.',
      },
    };
  });

/**
 * `.env.example` body from imported env KEYS only (values dropped; may be secrets).
 * Falls back to the starter template when no keys were found. Shared by EAS and Fastlane.
 */
export const buildEnvExample = (keys: readonly string[]): string => {
  if (keys.length === 0) return ENV_EXAMPLE_TEMPLATE;
  const header = ENV_EXAMPLE_TEMPLATE.split('\n')
    .filter((line) => line.startsWith('#'))
    .join('\n');
  return `${header}\n${keys.map((key) => `${key}=`).join('\n')}\n`;
};
