import { FileSystem, Path } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Effect } from 'effect';
import { ENV_EXAMPLE_TEMPLATE } from '../config/configScaffold.js';
import { serializeStoreConfig, type StoreConfig } from '../store/storeConfig.js';
import type { MigrationArtifact, MigrationNote } from '../types/migrate.js';
/** A fill-in-the-blanks `store.config.json` (the EAS metadata schema Launch adopts verbatim for iOS). */
const STORE_CONFIG_SKELETON: StoreConfig = {
  configVersion: 0,
  apple: { info: { 'en-US': { title: '', subtitle: '', description: '', keywords: [] } } },
};
/**
 * Decide how a migration handles `store.config.json` in `cwd`: emit a skeleton artifact when none exists
 * (with a `manual` note to fill it in or pull the live listing), or emit no artifact and a `skipped` note
 * when one is already present (Launch uses it verbatim). Returns both so the caller appends them uniformly.
 */
export const scaffoldStoreConfig = (
  workingDirectory: string,
): Effect.Effect<
  { artifact: MigrationArtifact | null; note: MigrationNote },
  PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
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
 * Build a `.env.example` body from imported env var KEYS: the configScaffold template's comment header
 * plus a blank-valued line per key. Values are intentionally dropped (they may be secrets), matching how
 * both migration sources treat env. Falls back to the plain starter template when no keys were found, so
 * the artifact is always valid. Shared by `eas.ts` (EAS `env` keys) and `fastlane.ts` (dotenv keys).
 */
export const buildEnvExample = (keys: readonly string[]): string => {
  if (keys.length === 0) return ENV_EXAMPLE_TEMPLATE;
  const header = ENV_EXAMPLE_TEMPLATE.split('\n')
    .filter((line) => line.startsWith('#'))
    .join('\n');
  return `${header}\n${keys.map((key) => `${key}=`).join('\n')}\n`;
};
