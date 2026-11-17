import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { countTestCases } from '../core/docs/commandDocs/common.js';
import { makeAppStoreConnectApi } from '@/app-store-connect-api/app-store-connect-api.js';
import { makePlayConsoleApi } from '@/play-console-api/play-console-api.js';
import {
  AGENT_SKILLS_SIGNATURE,
  CANONICAL_SENTENCE,
  FAQ_SIGNATURE,
  FEATURES_SIGNATURE,
  IS_NOT_SIGNATURE,
} from '../core/docs/commandDocs/content.js';
import { buildProgram } from './program.js';
/** Repo root, derived from this file's location so the test works regardless of the cwd vitest runs in. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const isFunction = (member: unknown): boolean => typeof member === 'function';
// Builds both facades with placeholder keys (no network) and counts their callable members.
const countStoreApiOperations = (): number => {
  const appleOperations = Object.values(
    makeAppStoreConnectApi({ keyId: 'placeholder', issuerId: 'placeholder', p8: 'placeholder' }),
  ).filter(isFunction);
  const playOperations = Object.values(
    makePlayConsoleApi({
      clientEmail: 'placeholder@example.com',
      privateKey: 'placeholder',
      tokenUri: 'https://oauth2.googleapis.com/token',
    }),
  ).filter(isFunction);
  return appleOperations.length + playOperations.length;
};
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
/** Strip README hero links and decode HTML entities so linked prose still matches the plain canonical sentence. */
const decodeHtml = (html: string): string =>
  html
    .replace(/<a\b[^>]*>/g, '')
    .replace(/<\/a>/g, '')
    .replace(/&amp;/g, '&');
/** Pull every repo-relative markdown link target (`](./...)`) out of a doc, for link-validity checks. */
const relativeLinks = (markdown: string): string[] => {
  const links: string[] = [];
  for (const match of markdown.matchAll(/\]\((\.\/[^)\s]+)\)/g)) {
    if (match[1]) links.push(match[1]);
  }
  return links;
};
describe('canonical category sentence is unified across surfaces (issue #89)', () => {
  it('is byte-identical in package.json, llms.txt, and the README hero', () => {
    expect(JSON.parse(read('package.json')).description).toBe(CANONICAL_SENTENCE);
    expect(read('llms.txt')).toContain(`> ${CANONICAL_SENTENCE}`);
    expect(decodeHtml(read('README.md'))).toContain(CANONICAL_SENTENCE);
  });
});
describe('the what-Launch-is-not disambiguation is present where AI engines read it', () => {
  it('appears in both the README and llms.txt', () => {
    expect(read('README.md')).toContain(IS_NOT_SIGNATURE);
    expect(read('llms.txt')).toContain(IS_NOT_SIGNATURE);
  });
});
describe('the generative-AI FAQ is present where AI engines read it', () => {
  it('appears in both the README and llms.txt', () => {
    expect(read('README.md')).toContain(FAQ_SIGNATURE);
    expect(read('llms.txt')).toContain(FAQ_SIGNATURE);
  });
});
describe('the numbered Features map is present where readers and AI engines look', () => {
  it('appears in both the README and llms.txt, from one generated source', () => {
    expect(read('README.md')).toContain(FEATURES_SIGNATURE);
    expect(read('llms.txt')).toContain(FEATURES_SIGNATURE);
  });
});
describe('the agent-skills mention reaches the README (gated alongside docs:check)', () => {
  it('appears in the README, so the `launch agents` feature is never hidden', () => {
    expect(
      read('README.md'),
      'README.md is missing the agent-skills callout - run `npm run docs:gen`',
    ).toContain(AGENT_SKILLS_SIGNATURE);
  });
});
/** Assert every repo-relative link in one doc points at a file that exists. */
const expectNoBrokenLinks = (file: string): void => {
  for (const link of relativeLinks(read(file))) {
    expect(existsSync(join(ROOT, link)), `${file} links missing ${link}`).toBe(true);
  }
};
describe('every relative link in the AI-facing documents resolves on disk', () => {
  it('llms.txt and llms-full.txt have no broken links', () => {
    expectNoBrokenLinks('llms.txt');
    expectNoBrokenLinks('llms-full.txt');
  });
});

describe('Genshot is discoverable from every primary documentation surface', () => {
  it('documents setup and the screenshot command in README, llms.txt, and llms-full.txt', () => {
    for (const documentationFile of ['README.md', 'llms.txt', 'llms-full.txt']) {
      const documentationText = read(documentationFile);
      expect(documentationText, documentationFile).toContain('@genshot/cli');
      expect(documentationText, documentationFile).toContain('genshot login');
      expect(documentationText, documentationFile).toContain('launch ai screenshots');
      expect(documentationText, documentationFile).toContain('launch plan screenshots');
    }
  });
});
describe('the README live-stats badges track the real codebase (gated alongside docs:check)', () => {
  it("shows the actual store-API operation and test counts, so they can't silently drift", () => {
    const operations = countStoreApiOperations();
    const tests = countTestCases(
      readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
        .filter((entry) => entry.endsWith('.test.ts'))
        .map((entry) => read(join('src', entry))),
    );
    const readme = read('README.md');
    expect(readme, 'README endpoint badge is stale - run `npm run docs:gen`').toContain(
      `store%20API-${operations}%20endpoints`,
    );
    expect(readme, 'README tests badge is stale - run `npm run docs:gen`').toContain(
      `tests-${tests}%20passing`,
    );
  });
});
describe('the generated llms.txt command list covers every command', () => {
  it('lists each top-level launch command from the live program', () => {
    const llmsText = read('llms.txt');
    for (const command of buildProgram().commands) {
      expect(llmsText, `llms.txt is missing \`launch ${command.name()}\``).toContain(
        `- \`launch ${command.name()}`,
      );
    }
  });
});
