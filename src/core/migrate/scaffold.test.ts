import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scaffoldStoreConfig } from './scaffold.js';
describe('scaffoldStoreConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launch-scaffold-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const runScaffoldStoreConfig = () =>
    Effect.runPromise(scaffoldStoreConfig(dir).pipe(Effect.provide(NodeContext.layer)));
  it('emits a skeleton artifact and a manual note when none exists', async () => {
    const { artifact, note } = await runScaffoldStoreConfig();
    expect(artifact?.path).toBe('store.config.json');
    expect(artifact?.contents).toContain('"configVersion"');
    expect(note.level).toBe('manual');
    expect(note.message).toContain('store.config.json');
  });
  it('emits no artifact and a skipped note when one is already present', async () => {
    writeFileSync(join(dir, 'store.config.json'), '{}');
    const { artifact, note } = await runScaffoldStoreConfig();
    expect(artifact).toBeNull();
    expect(note.level).toBe('skipped');
  });
});
