import { describe, expect, it } from "vitest";
import * as commandDocs from "./commandDocs.js";

/**
 * Guards the `commandDocs.ts` barrel after the split into ./commandDocs/*.ts: every module the barrel
 * stitches together must keep contributing its public surface. A dropped `export *` line, or a value
 * export silently narrowed to a type-only one, would let `scripts/gen-docs.ts` or the consistency tests
 * fail far from the cause — this asserts the contract in one discoverable place, one block per module.
 */
describe("commandDocs barrel", () => {
  it("re-exports the content constants (./commandDocs/content.ts)", () => {
    expect(commandDocs.CANONICAL_SENTENCE).toContain("self-hosted alternative to Expo EAS");
    expect(commandDocs.GENERATIVE_AI_FAQ).toContain(commandDocs.FAQ_SIGNATURE);
    expect(commandDocs.WHAT_LAUNCH_IS_BLOCK).toContain(commandDocs.IS_NOT_SIGNATURE);
    expect(commandDocs.FEATURE_SECTIONS[0]?.features.join("\n")).toContain(commandDocs.FEATURES_SIGNATURE);
    expect(commandDocs.AGENT_SKILLS_BLURB).toContain(commandDocs.AGENT_SKILLS_SIGNATURE);
    for (const marker of [
      commandDocs.STATS_BADGES_START,
      commandDocs.FAQ_REGION_START,
      commandDocs.FEATURES_REGION_START,
      commandDocs.AGENT_SKILLS_START,
    ]) {
      expect(marker).toMatch(/^<!--/);
    }
  });

  it("re-exports the shared helpers (./commandDocs/common.ts)", () => {
    expect(commandDocs.escapeCell("a|b\\c")).toBe("a\\|b\\\\c");
    expect(commandDocs.countAsyncMethods("  async foo() {}\n  async bar() {}")).toBe(2);
    expect(commandDocs.countTestCases(["it('x', () => {})", "test.each([])('y')"])).toBe(2);
  });

  it("re-exports the renderers (commandReference / llmsTxt / readme modules)", () => {
    for (const render of [
      commandDocs.renderCommandReference,
      commandDocs.renderLlmsTxt,
      commandDocs.renderStatsBadges,
      commandDocs.renderFaqRegion,
      commandDocs.renderFeaturesList,
      commandDocs.renderFeaturesRegion,
      commandDocs.renderAgentSkillsRegion,
    ]) {
      expect(typeof render).toBe("function");
    }
    for (const splice of [
      commandDocs.spliceReadmeBadges,
      commandDocs.spliceReadmeFaq,
      commandDocs.spliceReadmeFeatures,
      commandDocs.spliceReadmeAgentSkills,
    ]) {
      expect(typeof splice).toBe("function");
    }
  });
});
