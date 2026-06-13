import { describe, expect, it } from "vitest";
import { explainTopic, isGlossaryTopic, listTopics } from "./glossary.js";

describe("glossary — the single source for --explain and docs", () => {
  it("lists every documented topic", () => {
    const topics = listTopics();
    // The union in GlossaryTopic and the GLOSSARY record must stay in lockstep; this guards drift.
    expect(topics).toContain("csr");
    expect(topics).toContain("app-record");
    expect(topics).toContain("provisioning-profile");
    expect(topics).toContain("ec2-mac");
    expect(topics.length).toBe(17);
    expect(new Set(topics).size).toBe(topics.length);
  });

  it("returns non-empty teaching text for every topic", () => {
    for (const topic of listTopics()) {
      const text = explainTopic(topic);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/TODO/i);
    }
  });

  it("narrows known strings and rejects unknown ones", () => {
    expect(isGlossaryTopic("csr")).toBe(true);
    expect(isGlossaryTopic("app-record")).toBe(true);
    expect(isGlossaryTopic("not-a-topic")).toBe(false);
    expect(isGlossaryTopic("")).toBe(false);
  });
});
