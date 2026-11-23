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
  async function emitsASkeletonArtifactAndAManualNoteWhenNoneExists() {
    const { artifact, note } = await scaffoldStoreConfig(dir);

    expect(artifact).not.toBeNull();

    if (artifact == null) {
      return;
    }

    expect(artifact.path).toBe('store.config.json');
    expect(artifact.contents).toContain('"configVersion"');
    expect(note.level).toBe('manual');
    expect(note.message).toContain('store.config.json');
  }

  it(
    'emits a skeleton artifact and a manual note when none exists',
    emitsASkeletonArtifactAndAManualNoteWhenNoneExists,
  );
  async function emitsNoArtifactAndASkippedNoteWhenOneIsAlreadyPresent() {
    const storePath = join(dir, 'store.config.json');
    writeFileSync(storePath, '{}');
    const { artifact, note } = await scaffoldStoreConfig(dir);

    expect(artifact).toBeNull();
    expect(note.level).toBe('skipped');
  }

  it(
    'emits no artifact and a skipped note when one is already present',
    emitsNoArtifactAndASkippedNoteWhenOneIsAlreadyPresent,
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
