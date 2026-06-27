import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../../cli/program.js';
import {
  AGENT_SKILLS_SIGNATURE,
  CANONICAL_SENTENCE,
  FAQ_SIGNATURE,
  FEATURES_SIGNATURE,
  IS_NOT_SIGNATURE,
  countAsyncMethods,
  countTestCases,
} from './commandDocs.js';

/** Repo root, derived from this file's location so the test works regardless of the cwd vitest runs in. */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/** Decode the one HTML entity the README hero uses so its prose can be compared to the plain canonical sentence. */
const decodeHtml = (html: string): string => html.replace(/&amp;/g, '&');

/** Pull every repo-relative markdown link target (`](./…)`) out of a doc, for link-validity checks. */
function relativeLinks(markdown: string): string[] {
  const links: string[] = [];
  for (const match of markdown.matchAll(/\]\((\.\/[^)\s]+)\)/g)) {
    if (match[1]) links.push(match[1]);
  }
  return links;
}

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

describe('the agent-skills mention reaches every README (gated alongside docs:check)', () => {
  it('appears in the English README and all translations, so the `launch agents` feature is never hidden', () => {
    const readmes = readdirSync(ROOT, { encoding: 'utf8' }).filter((file) =>
      /^README.*\.md$/.test(file),
    );
    expect(
      readmes.length,
      'expected the English README plus its translations',
    ).toBeGreaterThanOrEqual(9);
    for (const file of readmes) {
      expect(
        read(file),
        `${file} is missing the agent-skills callout — run \`npm run docs:gen\``,
      ).toContain(AGENT_SKILLS_SIGNATURE);
    }
  });
});

/** Assert every repo-relative link in one doc points at a file that exists. */
function expectNoBrokenLinks(file: string): void {
  for (const link of relativeLinks(read(file))) {
    expect(existsSync(join(ROOT, link)), `${file} links missing ${link}`).toBe(true);
  }
}

describe('every relative link in llms.txt resolves on disk', () => {
  it('llms.txt has no broken links', () => {
    expectNoBrokenLinks('llms.txt');
  });
});

describe('the README live-stats badges track the real codebase (gated alongside docs:check)', () => {
  it("shows the actual store-API operation and test counts, so they can't silently drift", () => {
    const operations =
      countAsyncMethods(read('src/apple/ascClient.ts')) +
      countAsyncMethods(read('src/google/playClient.ts'));
    const tests = countTestCases(
      readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
        .filter((entry) => entry.endsWith('.test.ts'))
        .map((entry) => read(join('src', entry))),
    );
    const readme = read('README.md');
    expect(readme, 'README endpoint badge is stale — run `npm run docs:gen`').toContain(
      `store%20API-${operations}%20endpoints`,
    );
    expect(readme, 'README tests badge is stale — run `npm run docs:gen`').toContain(
      `tests-${tests}%20passing`,
    );
  });
});

describe('the translated READMEs stay in structural parity with English (no silent FAQ/section drift)', () => {
  it("match README.md's section count and FAQ-question count, so a translation can't fall behind", () => {
    // Heading TEXT is translated, but the markdown skeleton is not: split on `## ` and compare the section
    // count, then the FAQ section question-for-question. The FAQ section is found by English's heading,
    // then by the SAME position in each translation (section order is identical). The English README renders
    // each FAQ entry as a collapsible `<details>` whose `<summary>` holds the question, while the translations
    // keep flat single-line `**Question?**` paragraphs — so a question is a line that starts with either
    // `<summary` or `**`. Counting those inside that one section is exact and wrap-insensitive — unlike a
    // whole-file count, which trips on prose-wrap artifacts.
    const sectionsOf = (md: string): string[] => md.split(/^## /m);
    const countQuestions = (section: string): number =>
      (section.match(/^(?:<summary|\*\*)/gm) ?? []).length;
    const english = sectionsOf(read('README.md'));
    const faqIndex = english.findIndex((section) => section.startsWith('FAQ'));
    expect(faqIndex, "could not find the '## FAQ' section in README.md").toBeGreaterThan(-1);

    const translations = readdirSync(ROOT, { encoding: 'utf8' }).filter((file) =>
      /^README\..+\.md$/.test(file),
    );
    expect(
      translations.length,
      'expected the translated READMEs to be present',
    ).toBeGreaterThanOrEqual(8);
    for (const file of translations) {
      const sections = sectionsOf(read(file));
      expect(
        sections.length,
        `${file}: '##' section count drifted from README.md — re-sync the translation`,
      ).toBe(english.length);
      expect(
        countQuestions(sections[faqIndex] ?? ''),
        `${file}: FAQ question count drifted from README.md — re-translate the FAQ`,
      ).toBe(countQuestions(english[faqIndex] ?? ''));
    }
  });
});

describe('the generated command reference covers every command', () => {
  it('documents each top-level launch command from the live program', () => {
    const reference = read('docs/commands.md');
    for (const command of buildProgram().commands) {
      expect(reference, `docs/commands.md is missing \`launch ${command.name()}\``).toContain(
        `## \`launch ${command.name()}`,
      );
    }
  });
});
