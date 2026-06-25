/**
 * Renders and splices the generated regions of the curated `README*.md` files: the live-stats badge
 * row, the collapsible FAQ and Features sections, and the agent-skills callout. Each `splice*` swaps one
 * HTML-comment-fenced region in place (via the shared {@link spliceRegion}) so everything else in the
 * hand-written README is left byte-for-byte untouched. {@link renderFeaturesList} is the one flat
 * renderer shared with `./llmsTxt.ts`.
 */

import {
  AGENT_SKILLS_BLURB,
  AGENT_SKILLS_END,
  AGENT_SKILLS_START,
  FAQ_REGION_END,
  FAQ_REGION_START,
  FEATURE_SECTIONS,
  FEATURES_REGION_END,
  FEATURES_REGION_START,
  GENERATIVE_AI_FAQ,
  STATS_BADGES_END,
  STATS_BADGES_START,
} from "./content.js";
import type { DocStats } from "./types.js";

/**
 * Render the README's live-stats badge row from {@link DocStats}: the store-API endpoint count, the
 * full-CRUD lifecycle marker, and the passing-test count, all centered under the hero badges. The
 * numbers are generated (never hand-typed) so they track the real codebase — the endpoint and test
 * badges move with every new API method or test, and `docs:check` fails the build if the committed
 * README drifts, exactly like the generated command reference. The CRUD badge is qualitative (the two
 * clients implement create/read/update/delete across the catalog), so it carries no number to go stale.
 *
 * Returns the block *including* both {@link STATS_BADGES_START} / {@link STATS_BADGES_END} fences so
 * {@link spliceReadmeBadges} can swap the whole region in one slice and the marker text lives in one place.
 */
export function renderStatsBadges(stats: DocStats): string {
  const endpoints = `https://img.shields.io/badge/store%20API-${stats.operations}%20endpoints-8957e5?logo=apple&logoColor=white`;
  const crud = "https://img.shields.io/badge/CRUD-full%20lifecycle-1f6feb";
  const tests = `https://img.shields.io/badge/tests-${stats.tests}%20passing-3fb950?logo=vitest&logoColor=white`;
  return [
    STATS_BADGES_START,
    "",
    '<p align="center">',
    `  <a href="./docs/commands.md"><img src="${endpoints}" alt="${stats.operations} App Store Connect &amp; Google Play API operations" /></a>`,
    `  <img src="${crud}" alt="Full create / read / update / delete coverage across the store APIs" />`,
    `  <a href="https://github.com/YosefHayim/launch-store/actions/workflows/ci.yml"><img src="${tests}" alt="${stats.tests} tests passing" /></a>`,
    "</p>",
    "",
    STATS_BADGES_END,
  ].join("\n");
}

/**
 * Replace everything between a start/end HTML-comment fence in `content` with `replacement` (the markers
 * are part of `replacement`, so the whole region is swapped in one slice). Throws when either fence is
 * missing rather than silently appending — a dropped marker means the README was edited in a way that
 * would lose the generated section, and the build should fail loudly so it gets fixed. Shared by the
 * badge and FAQ splices so both regions are managed exactly the same way.
 */
function spliceRegion(
  content: string,
  startMarker: string,
  endMarker: string,
  replacement: string,
  label: string,
): string {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1) {
    throw new Error(
      `README.md is missing the ${label} markers — add the fences back so \`docs:gen\` can regenerate the ${label} region.`,
    );
  }
  return content.slice(0, start) + replacement + content.slice(end + endMarker.length);
}

/**
 * Splice a freshly {@link renderStatsBadges rendered} badge row into a README, replacing the whole
 * {@link STATS_BADGES_START}…{@link STATS_BADGES_END} region. Applied to every `README*.md`: the badge
 * URLs are language-neutral, so the same block goes into the English README and all translations.
 */
export function spliceReadmeBadges(readme: string, badges: string): string {
  return spliceRegion(readme, STATS_BADGES_START, STATS_BADGES_END, badges, "stats-badges");
}

/**
 * One question/answer pair parsed out of {@link GENERATIVE_AI_FAQ}: the bold question (without its `**`
 * markers) and the answer prose that follows it. The intermediate shape {@link renderCollapsibleFaq}
 * renders into the README's `<details>` groups; the flat string stays the one source for `llms.txt`.
 */
interface FaqEntry {
  /** The question, stripped of the leading/trailing `**` so it can go inside `<summary><strong>`. */
  question: string;
  /** The answer markdown (may contain inline `code` spans), rendered as the `<details>` body. */
  answer: string;
}

/**
 * Split {@link GENERATIVE_AI_FAQ} into its {@link FaqEntry} pairs. Each source paragraph is a single
 * `**Question?** Answer` block separated by a blank line, so we split on the blank line (LF or CRLF, so a
 * Windows checkout can't collapse every Q&A into one) and peel the leading bold question off each. Throws
 * on a paragraph that isn't in that shape rather than silently dropping it, so a malformed FAQ edit fails
 * the build instead of vanishing from the README.
 */
function parseFaqEntries(): FaqEntry[] {
  return GENERATIVE_AI_FAQ.split(/\r?\n\r?\n/).map((paragraph) => {
    const match = /^\*\*(.+?)\*\*\s*([\s\S]+)$/.exec(paragraph.trim());
    if (!match?.[1] || !match[2]) {
      throw new Error(`FAQ entry is not in "**Question?** Answer" form: ${paragraph.slice(0, 60)}…`);
    }
    return { question: match[1], answer: match[2].trim() };
  });
}

/**
 * Render {@link GENERATIVE_AI_FAQ} as the README's per-question collapsible FAQ: each Q&A becomes a
 * default-collapsed `<details>` whose `<summary>` is the bold question and whose body is the answer. The
 * blank lines around the answer are required for GitHub to render the answer's markdown (the inline
 * `code` spans) inside the `<details>`.
 *
 * README-only, exactly like {@link renderCollapsibleFeatures}: `llms.txt` keeps the flat
 * {@link GENERATIVE_AI_FAQ} string, where `<details>` markup would be noise a model has to strip — so the
 * human-facing README collapses while the AI-facing surface stays plain, both from this one source.
 */
export function renderCollapsibleFaq(): string {
  return parseFaqEntries()
    .map(({ question, answer }) =>
      ["<details>", `<summary><strong>${escapeHtml(question)}</strong></summary>`, "", answer, "", "</details>"].join(
        "\n",
      ),
    )
    .join("\n\n");
}

/**
 * Render the English README's FAQ region from {@link renderCollapsibleFaq}, fenced by
 * {@link FAQ_REGION_START}/{@link FAQ_REGION_END} so {@link spliceReadmeFaq} can swap the whole block.
 * The FAQ has one source ({@link GENERATIVE_AI_FAQ}) shared with the flat `## FAQ` section
 * {@link renderLlmsTxt} emits, so the README and `llms.txt` can't drift question-for-question.
 */
export function renderFaqRegion(): string {
  return [FAQ_REGION_START, "", renderCollapsibleFaq(), "", FAQ_REGION_END].join("\n");
}

/**
 * Splice the {@link renderFaqRegion rendered} FAQ into the English README, replacing the whole
 * {@link FAQ_REGION_START}…{@link FAQ_REGION_END} region. English only — the source block is English, so
 * translated READMEs carry a hand-translated FAQ that the README structural-parity test keeps in sync.
 */
export function spliceReadmeFaq(readme: string, faq: string): string {
  return spliceRegion(readme, FAQ_REGION_START, FAQ_REGION_END, faq, "faq");
}

/**
 * Render the numbered capability map from {@link FEATURE_SECTIONS}: each section as a bold label (and its
 * optional lead line) followed by its features as a markdown ordered list, numbered **continuously**
 * across sections (1..N) so the whole feature surface reads as one ordered list. Pure and arg-free — the
 * same output is spliced into the README and inlined into `llms.txt`, so the two can't drift. The
 * continuing ordinal is emitted explicitly per section, which prettier preserves when it reformats.
 */
export function renderFeaturesList(): string {
  let n = 0;
  return FEATURE_SECTIONS.map((section) => {
    const lead = section.intro ? [section.intro, ""] : [];
    const items = section.features.map((feature) => `${(n += 1)}. ${feature}`);
    return [`**${section.title}**`, "", ...lead, ...items].join("\n");
  }).join("\n\n");
}

/**
 * Escape the HTML-significant characters in a `<summary>` label. The {@link FEATURE_SECTIONS} titles are
 * controlled constants that today only contain `&` (e.g. "Set up & verify"), but escaping `<`/`>` too keeps
 * the helper correct if a title ever gains them. Used only for the README's collapsible feature groups.
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render {@link FEATURE_SECTIONS} as the README's per-group collapsible feature map: each section becomes a
 * default-collapsed `<details>` whose `<summary>` is the bold section title, with the section's features as
 * a markdown ordered list (restarting at 1 per group, so each collapsed group reads as its own list). The
 * blank lines around the list are required for GitHub to render markdown inside the `<details>`.
 *
 * README-only. {@link renderFeaturesList} stays a single flat numbered list for `llms.txt`, where the
 * `<details>` markup would be noise a model has to strip — so the human-facing README collapses while the
 * AI-facing surface stays plain, both from this one {@link FEATURE_SECTIONS} source.
 */
export function renderCollapsibleFeatures(): string {
  return FEATURE_SECTIONS.map((section) => {
    const lead = section.intro ? [section.intro, ""] : [];
    const items = section.features.map((feature, index) => `${index + 1}. ${feature}`);
    return [
      "<details>",
      `<summary><strong>${escapeHtml(section.title)}</strong></summary>`,
      "",
      ...lead,
      ...items,
      "",
      "</details>",
    ].join("\n");
  }).join("\n\n");
}

/**
 * Render the README's Features region from {@link renderCollapsibleFeatures}, fenced by
 * {@link FEATURES_REGION_START}/{@link FEATURES_REGION_END} so {@link spliceReadmeFeatures} can swap the
 * whole block. English only — the translated READMEs carry a hand-translated Features section.
 */
export function renderFeaturesRegion(): string {
  return [FEATURES_REGION_START, "", renderCollapsibleFeatures(), "", FEATURES_REGION_END].join("\n");
}

/**
 * Splice the {@link renderFeaturesRegion rendered} Features list into the English README, replacing the
 * whole {@link FEATURES_REGION_START}…{@link FEATURES_REGION_END} region. English only, exactly like the
 * FAQ — the source is English and the translated READMEs keep a hand-translated Features section.
 */
export function spliceReadmeFeatures(readme: string, region: string): string {
  return spliceRegion(readme, FEATURES_REGION_START, FEATURES_REGION_END, region, "features");
}

/**
 * Render the README's agent-skills callout from {@link AGENT_SKILLS_BLURB}, fenced by
 * {@link AGENT_SKILLS_START}/{@link AGENT_SKILLS_END} so {@link spliceReadmeAgentSkills} can swap the whole
 * region. Language-neutral, so the same block is spliced into the English README and every translation.
 */
export function renderAgentSkillsRegion(): string {
  return [AGENT_SKILLS_START, "", AGENT_SKILLS_BLURB, "", AGENT_SKILLS_END].join("\n");
}

/**
 * Splice the {@link renderAgentSkillsRegion rendered} agent-skills callout into a README, replacing the
 * whole {@link AGENT_SKILLS_START}…{@link AGENT_SKILLS_END} region. Applied to every `README*.md`, exactly
 * like the badge row — the callout is language-neutral.
 */
export function spliceReadmeAgentSkills(readme: string, region: string): string {
  return spliceRegion(readme, AGENT_SKILLS_START, AGENT_SKILLS_END, region, "agent-skills");
}
