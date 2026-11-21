import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Repo root, derived from this file's location so the test works regardless of the cwd vitest runs in. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CANONICAL_SENTENCE =
  'Open-source, self-hosted alternative to Expo EAS - build, sign, configure your stores, and ship Expo / React Native apps to the App Store & Google Play from one typed launch.config.ts - your machine, your keys. No per-build bill.';

const read = (relativePath: string): string => readFileSync(join(ROOT, relativePath), 'utf8');
/** Strip README hero links and decode HTML entities so linked prose still matches the plain canonical sentence. */
const decodeHtml = (readmeHtml: string): string =>
  readmeHtml
    .replace(/<a\b[^>]*>/g, '')
    .replace(/<\/a>/g, '')
    .replace(/&amp;/g, '&');
/** Pull every repo-relative markdown link target (`](./...)`) out of a doc, for link-validity checks. */
const relativeLinks = (markdown: string): string[] => {
  const links: string[] = [];
  for (const linkMatch of markdown.matchAll(/\]\((\.\/[^)\s]+)\)/g)) {
    const link = linkMatch[1];
    if (link != null) links.push(link);
  }
  return links;
};

describe('canonical category sentence is unified across surfaces (issue #89)', () => {
  it('is the package description and the README hero', () => {
    expect(JSON.parse(read('package.json')).description).toBe(CANONICAL_SENTENCE);
    expect(decodeHtml(read('README.md'))).toContain(CANONICAL_SENTENCE);
  });
});
describe('the what-Launch-is-not disambiguation is present where readers look', () => {
  it('appears in the README', () => {
    expect(read('README.md')).toContain('**Launch is not** just an App Store Connect SDK');
  });
});
describe('the generative-AI FAQ is present where readers look', () => {
  it('appears in the README', () => {
    expect(read('README.md')).toContain('Is Launch a free, open-source alternative to Expo EAS?');
  });
});
describe('the numbered Features map is present where readers look', () => {
  it('appears in the README', () => {
    expect(read('README.md')).toContain('Config in one step');
  });
});
describe('the agent-skills mention reaches the README', () => {
  it('appears in the README, so the `launch agents` feature is never hidden', () => {
    expect(read('README.md')).toContain('Driving Launch from an AI agent?');
  });
});
/** Assert every repo-relative link in one doc points at a file that exists. */
const expectNoBrokenLinks = (filePath: string): void => {
  for (const link of relativeLinks(read(filePath))) {
    expect(existsSync(join(ROOT, link)), `${filePath} links missing ${link}`).toBe(true);
  }
};
describe('every relative link in the README resolves on disk', () => {
  it('README.md has no broken links', () => {
    expectNoBrokenLinks('README.md');
  });
});

describe('Genshot is discoverable from the README', () => {
  it('documents setup and the screenshot command', () => {
    const readme = read('README.md');
    expect(readme).toContain('@genshot/cli');
    expect(readme).toContain('genshot login');
    expect(readme).toContain('launch ai screenshots');
    expect(readme).toContain('launch plan screenshots');
  });
});
