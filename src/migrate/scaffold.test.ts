import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENV_EXAMPLE_TEMPLATE } from '../config/config-scaffold.ts';
import { buildEnvExample, scaffoldStoreConfig } from './scaffold.ts';

function describeScaffoldStorePiece() {
  let dir: string;

  function prepareScaffoldStorePiece() {
    const systemTemporaryDirectory = tmpdir();
    const launchScaffoldPath = join(systemTemporaryDirectory, 'launch-scaffold-');
    dir = mkdtempSync(launchScaffoldPath);
  }

  beforeEach(prepareScaffoldStorePiece);

  function cleanupScaffoldStorePiece() {
    rmSync(dir, { recursive: true, force: true });
  }

  afterEach(cleanupScaffoldStorePiece);

  async function notesThatTheListingBelongsInLaunchConfigWhenNoneExists() {
    const { artifact, note } = await scaffoldStoreConfig(dir);

    expect(artifact).toBeNull();
    expect(note.level).toBe('manual');
    expect(note.message).toContain('launch.config.ts');
  }

  it(
    'notes that the listing belongs in launch.config.ts when none exists',
    notesThatTheListingBelongsInLaunchConfigWhenNoneExists,
  );

  async function notesThatAnExistingStoreFileShouldMove() {
    const storePath = join(dir, 'store.config.json');

    writeFileSync(storePath, '{}');

    const { artifact, note } = await scaffoldStoreConfig(dir);

    expect(artifact).toBeNull();
    expect(note.level).toBe('skipped');
    expect(note.message).toContain('launch.config.ts');
  }

  it(
    'notes that an existing store.config.json should move into launch.config.ts',
    notesThatAnExistingStoreFileShouldMove,
  );
}

describe('scaffoldStoreConfig', describeScaffoldStorePiece);

function describeBuildPieceExample() {
  function returnsTheStarterTemplateWhenNoKeysWereDiscovered() {
    const buildExample = buildEnvExample([]);
    expect(buildExample).toBe(ENV_EXAMPLE_TEMPLATE);
  }

  it(
    'returns the starter template when no keys were discovered',
    returnsTheStarterTemplateWhenNoKeysWereDiscovered,
  );

  function keepsOnlyTheTemplateCommentHeaderAndBlankValuedKeys() {
    const envExample = buildEnvExample(['APP_STORE_KEY', 'SLACK_URL']);

    expect(envExample).toContain('APP_STORE_KEY=');
    expect(envExample).toContain('SLACK_URL=');
    expect(envExample).not.toContain('APP_STORE_KEY=secret');

    for (const templateLine of ENV_EXAMPLE_TEMPLATE.split('\n')) {
      const isComment = templateLine.startsWith('#');

      if (isComment == false) {
        continue;
      }

      expect(envExample).toContain(templateLine);
    }
  }

  it(
    'keeps only the template comment header and blank-valued keys',
    keepsOnlyTheTemplateCommentHeaderAndBlankValuedKeys,
  );
}

describe('buildEnvExample', describeBuildPieceExample);
