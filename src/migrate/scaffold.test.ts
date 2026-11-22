import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENV_EXAMPLE_TEMPLATE } from '../config/configScaffold.ts';
import { buildEnvExample, scaffoldStoreConfig } from './scaffold.ts';

describe('scaffoldStoreConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launch-scaffold-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('emits a skeleton artifact and a manual note when none exists', async () => {
    const { artifact, note } = await scaffoldStoreConfig(dir);

    expect(artifact).not.toBeNull();

    if (artifact == null) {
      return;
    }

    expect(artifact.path).toBe('store.config.json');
    expect(artifact.contents).toContain('"configVersion"');
    expect(note.level).toBe('manual');
    expect(note.message).toContain('store.config.json');
  });

  it('emits no artifact and a skipped note when one is already present', async () => {
    writeFileSync(join(dir, 'store.config.json'), '{}');
    const { artifact, note } = await scaffoldStoreConfig(dir);

    expect(artifact).toBeNull();
    expect(note.level).toBe('skipped');
  });
});

describe('buildEnvExample', () => {
  it('returns the starter template when no keys were discovered', () => {
    expect(buildEnvExample([])).toBe(ENV_EXAMPLE_TEMPLATE);
  });

  it('keeps only the template comment header and blank-valued keys', () => {
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
  });
});
