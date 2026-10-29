import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileSystem, Path } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  makeLaunchHomeTest,
  removeTemporaryHomeDirectory,
} from '@testkit/launchHome.testkit.js';
import { readJsonFile, writeJsonFileAtomically } from './atomicJsonFile.js';

const NoteSchema = Schema.Struct({ title: Schema.String });

describe('atomic json file', () => {
  let homeDirectory: string;
  beforeEach(() => {
    homeDirectory = createTemporaryHomeDirectory();
  });
  afterEach(() => {
    removeTemporaryHomeDirectory(homeDirectory);
  });

  const runInHome = <Success, Failure>(
    program: Effect.Effect<Success, Failure, FileSystem.FileSystem | Path.Path>,
  ) => Effect.runPromise(program.pipe(Effect.provide(makeLaunchHomeTest(homeDirectory))));

  describe('readJsonFile', () => {
    test('returns null when the file does not exist', async () => {
      const note = await runInHome(readJsonFile(join(homeDirectory, 'missing.json'), NoteSchema));

      expect(note).toBeNull();
    });

    test('reads a file that matches the schema', async () => {
      const filePath = join(homeDirectory, 'note.json');
      writeFileSync(filePath, '{"title":"hello"}');

      const note = await runInHome(readJsonFile(filePath, NoteSchema));

      expect(note).toEqual({ title: 'hello' });
    });

    test('fails with the file path when the text is not valid for the schema', async () => {
      const filePath = join(homeDirectory, 'note.json');
      writeFileSync(filePath, '{"title":5}');

      const failure = await runInHome(readJsonFile(filePath, NoteSchema).pipe(Effect.flip));

      expect(failure).toMatchObject({ _tag: 'JsonFileFailure', filePath });
    });
  });

  describe('writeJsonFileAtomically', () => {
    test('writes the document, creates missing folders and leaves no temp file', async () => {
      const filePath = join(homeDirectory, 'a', 'b', 'note.json');

      await runInHome(writeJsonFileAtomically(filePath, { title: 'saved' }));

      expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ title: 'saved' });
      expect(readdirSync(join(homeDirectory, 'a', 'b'))).toEqual(['note.json']);
    });

    test('replaces an existing file', async () => {
      const filePath = join(homeDirectory, 'note.json');
      writeFileSync(filePath, '{"title":"old"}');

      await runInHome(writeJsonFileAtomically(filePath, { title: 'new' }));

      expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ title: 'new' });
    });

    test('fails with the file path when the folder cannot be created', async () => {
      const blockingFilePath = join(homeDirectory, 'blocker');
      writeFileSync(blockingFilePath, 'x');
      const filePath = join(blockingFilePath, 'note.json');

      const failure = await runInHome(writeJsonFileAtomically(filePath, {}).pipe(Effect.flip));

      expect(failure).toMatchObject({ _tag: 'JsonFileFailure', filePath });
    });
  });
});
