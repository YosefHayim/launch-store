import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../../cli/program.js";
import { CANONICAL_SENTENCE, FAQ_SIGNATURE, IS_NOT_SIGNATURE, countAsyncMethods, countTestCases } from "./commandDocs.js";

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
  it("appears in both the README and llms.txt", () => {
    expect(read("README.md")).toContain(IS_NOT_SIGNATURE);
    expect(read("llms.txt")).toContain(IS_NOT_SIGNATURE);
  });
});

describe("the generative-AI FAQ is present where AI engines read it", () => {
  it("appears in both the README and llms.txt", () => {
    expect(read("README.md")).toContain(FAQ_SIGNATURE);
    expect(read("llms.txt")).toContain(FAQ_SIGNATURE);
  });
});

/** Assert every repo-relative link in one doc points at a file that exists. */
function expectNoBrokenLinks(file: string): void {
  for (const link of relativeLinks(read(file))) {
    expect(existsSync(join(ROOT, link)), `${file} links missing ${link}`).toBe(true);
  }
}

describe("every relative link in llms.txt resolves on disk", () => {
  it("llms.txt has no broken links", () => {
    expectNoBrokenLinks("llms.txt");
  });
});

describe("the README live-stats badges track the real codebase (gated alongside docs:check)", () => {
  it("shows the actual store-API operation and test counts, so they can't silently drift", () => {
    const operations =
      countAsyncMethods(read("src/apple/ascClient.ts")) + countAsyncMethods(read("src/google/playClient.ts"));
    const tests = countTestCases(
      readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" })
        .filter((entry) => entry.endsWith(".test.ts"))
        .map((entry) => read(join("src", entry))),
    );
    const readme = read("README.md");
    expect(readme, "README endpoint badge is stale — run `npm run docs:gen`").toContain(
      `store%20API-${operations}%20endpoints`,
    );
    expect(readme, "README tests badge is stale — run `npm run docs:gen`").toContain(`tests-${tests}%20passing`);
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
