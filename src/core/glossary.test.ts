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
    // Android topics added alongside the Android leg.
    expect(topics).toContain("upload-key");
    expect(topics).toContain("play-app-signing");
    expect(topics).toContain("bundletool");
    // Build-cache topics (issue #9).
    expect(topics).toContain("ccache");
    expect(topics).toContain("incremental-build");
    expect(topics).toContain("build-fingerprint");
    // Next-version suggestion.
    expect(topics).toContain("marketing-version");
    // EAS-parity release: internal distribution, OTA updates, store metadata.
    expect(topics).toContain("ad-hoc-distribution");
    expect(topics).toContain("ota-update");
    expect(topics).toContain("store-metadata");
    expect(topics.length).toBe(30);
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
