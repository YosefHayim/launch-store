import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../../cli/program.js";
import { CANONICAL_SENTENCE, IS_NOT_SIGNATURE } from "./commandDocs.js";

/** Repo root, derived from this file's location so the test works regardless of the cwd vitest runs in. */
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (relative: string): string => readFileSync(join(ROOT, relative), "utf8");

/** Decode the one HTML entity the README hero uses so its prose can be compared to the plain canonical sentence. */
const decodeHtml = (html: string): string => html.replace(/&amp;/g, "&");

/** Pull every repo-relative markdown link target (`](./…)`) out of a doc, for link-validity checks. */
function relativeLinks(markdown: string): string[] {
  const links: string[] = [];
  for (const match of markdown.matchAll(/\]\((\.\/[^)\s]+)\)/g)) {
    if (match[1]) links.push(match[1]);
  }
  return links;
}

describe("canonical category sentence is unified across surfaces (issue #89)", () => {
  it("is byte-identical in package.json, llms.txt, and the README hero", () => {
    expect(JSON.parse(read("package.json")).description).toBe(CANONICAL_SENTENCE);
    expect(read("llms.txt")).toContain(`> ${CANONICAL_SENTENCE}`);
    expect(decodeHtml(read("README.md"))).toContain(CANONICAL_SENTENCE);
  });
});

describe("the what-Launch-is-not disambiguation is present where AI engines read it", () => {
  it("appears in both the README and llms-full.txt", () => {
    expect(read("README.md")).toContain(IS_NOT_SIGNATURE);
    expect(read("llms-full.txt")).toContain(IS_NOT_SIGNATURE);
  });
});

/** Assert every repo-relative link in one doc points at a file that exists. */
function expectNoBrokenLinks(file: string): void {
  for (const link of relativeLinks(read(file))) {
    expect(existsSync(join(ROOT, link)), `${file} links missing ${link}`).toBe(true);
  }
}

describe("every relative link in the llms files resolves on disk", () => {
  it("llms.txt has no broken links", () => {
    expectNoBrokenLinks("llms.txt");
  });

  it("llms-full.txt has no broken links", () => {
    expectNoBrokenLinks("llms-full.txt");
  });
});

describe("the generated command reference covers every command", () => {
  it("documents each top-level launch command from the live program", () => {
    const reference = read("docs/commands.md");
    for (const command of buildProgram().commands) {
      expect(reference, `docs/commands.md is missing \`launch ${command.name()}\``).toContain(
        `## \`launch ${command.name()}`,
      );
    }
  });
});
