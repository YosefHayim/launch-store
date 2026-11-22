import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createTemporaryHomeDirectory,
  removeTemporaryHomeDirectory,
} from '../../testkit/launch-home-testkit.ts';
import { readDocumentFile, writeDocumentFileAtomically } from './atomic-document-file.ts';

type Note = {
  title: string;
};

function decodeNote(documentText: string): Note {
  const parsed: unknown = JSON.parse(documentText);

  if (typeof parsed != 'object') {
    throw new Error('title must be a string');
  }

  if (parsed == null) {
    throw new Error('title must be a string');
  }

  if ('title' in parsed == false) {
    throw new Error('title must be a string');
  }

  if (typeof parsed.title != 'string') {
    throw new Error('title must be a string');
  }

  return { title: parsed.title };
}

let homeDirectory: string;

beforeEach(function createHome() {
  homeDirectory = createTemporaryHomeDirectory();
});

afterEach(function removeHome() {
  removeTemporaryHomeDirectory(homeDirectory);
});

describe('readDocumentFile', () => {
  test('returns null when the file does not exist', async () => {
    const missingPath = join(homeDirectory, 'missing.json');
    const note = await readDocumentFile(missingPath, decodeNote);
    expect(note).toBeNull();
  });

  test('reads a file that matches the note shape', async () => {
    const filePath = join(homeDirectory, 'note.json');
    writeFileSync(filePath, '{"title":"hello"}');
    const note = await readDocumentFile(filePath, decodeNote);
    expect(note).toEqual({ title: 'hello' });
  });

  test('fails with the file path when the text is not a note', async () => {
    const filePath = join(homeDirectory, 'note.json');
    writeFileSync(filePath, '{"title":5}');
    const documentFile = readDocumentFile(filePath, decodeNote);
    await expect(documentFile).rejects.toMatchObject({
      _tag: 'DocumentFileFailure',
      filePath,
    });
  });
});

describe('writeDocumentFileAtomically', () => {
  test('writes the document, creates missing folders and leaves no temp file', async () => {
    const filePath = join(homeDirectory, 'a', 'b', 'note.json');
    await writeDocumentFileAtomically(filePath, { title: 'saved' });
    const loadedFile = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(loadedFile);
    expect(parsed).toEqual({ title: 'saved' });
    const bPath = join(homeDirectory, 'a', 'b');
    expect(readdirSync(bPath)).toEqual(['note.json']);
  });

  test('replaces an existing file', async () => {
    const filePath = join(homeDirectory, 'note.json');
    writeFileSync(filePath, '{"title":"old"}');
    await writeDocumentFileAtomically(filePath, { title: 'new' });
    const loadedFile = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(loadedFile);
    expect(parsed).toEqual({ title: 'new' });
  });

  test('fails with the file path when the folder cannot be created', async () => {
    const blockingFilePath = join(homeDirectory, 'blocker');
    writeFileSync(blockingFilePath, 'x');
    const filePath = join(blockingFilePath, 'note.json');
    const documentFileAtomically = writeDocumentFileAtomically(filePath, {});
    await expect(documentFileAtomically).rejects.toMatchObject({
      _tag: 'DocumentFileFailure',
      filePath,
    });
  });
});
