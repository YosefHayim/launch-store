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
    // APNs push-key vault (issue #19).
    expect(topics).toContain("apns-key");
    // Consistent env resolution (issue #25).
    expect(topics).toContain("env-precedence");
    // Foundational ecosystem/toolchain terms for developers new to RN/Expo/Apple/Google.
    expect(topics).toContain("react-native");
    expect(topics).toContain("expo");
    expect(topics).toContain("eas");
    expect(topics).toContain("xcode");
    expect(topics).toContain("gradle");
    expect(topics).toContain("runtime-version");
    // Interactive wizard build-flow steps.
    expect(topics).toContain("build-platform");
    expect(topics).toContain("build-location");
    expect(topics).toContain("apple-account");
    expect(topics).toContain("build-profile");
    // Bundle-ID capabilities teaching entry (issue #19, PR #43).
    expect(topics).toContain("bundle-id-capability");
    // App Store release lifecycle (API-driven `launch release`/`status`/`rollout`).
    expect(topics).toContain("app-store-version");
    expect(topics).toContain("review-submission");
    expect(topics).toContain("release-type");
    expect(topics).toContain("phased-release");
    expect(topics).toContain("export-compliance");
    expect(topics).toContain("release-train");
    // Store-account readiness teaching entry (`launch store doctor`, issue #170).
    expect(topics).toContain("store-readiness");
    // Pre-submit readiness teaching entry (`launch audit`, issue #168).
    expect(topics).toContain("submission-readiness");
    // In-app-purchase readiness teaching entry (`launch iap doctor`, issue #174).
    expect(topics).toContain("iap-readiness");
    // Store-snapshot teaching entry (`launch snapshot`, issue #169).
    expect(topics).toContain("store-snapshot");
    // In-app-purchase vocabulary the offers/iap surfaces depend on.
    expect(topics).toContain("subscription-group");
    expect(topics).toContain("subscription-offer");
    // Config-as-code GitOps loop (`launch sync`/`plan`/`drift`/`adopt`/`migrate`).
    expect(topics).toContain("config-reconcile");
    expect(topics).toContain("plan-drift");
    expect(topics).toContain("adopt");
    expect(topics).toContain("migrate");
    // App Store growth & merchandising (`app-clips`/`game-center`/`events`/`custom-pages`/`experiments`/`wallet`).
    expect(topics).toContain("app-clip");
    expect(topics).toContain("game-center");
    expect(topics).toContain("in-app-event");
    expect(topics).toContain("custom-product-page");
    expect(topics).toContain("product-page-optimization");
    expect(topics).toContain("wallet-pass");
    // Privacy, compliance & accessibility (`privacy scan`/`accessibility`/`eu-distribution`/`availability`).
    expect(topics).toContain("privacy-declarations");
    expect(topics).toContain("accessibility-label");
    expect(topics).toContain("eu-distribution");
    expect(topics).toContain("app-availability");
    // Reviews, reports & insights (`reviews`/`play-reviews`/`reports`/`insights`).
    expect(topics).toContain("store-review");
    expect(topics).toContain("store-report");
    expect(topics).toContain("review-insights");
    // Play monetization & post-launch (`play-products`/`play-subscriptions`/`play-pricing`/`play-reports vitals`).
    expect(topics).toContain("play-billing");
    expect(topics).toContain("price-localization");
    expect(topics).toContain("android-vitals");
    // Account, signing & AI surfaces (`team`/`sandbox`/`build:resign`/`ai listing`).
    expect(topics).toContain("team-role");
    expect(topics).toContain("sandbox-tester");
    expect(topics).toContain("resign");
    expect(topics).toContain("ai-store-assets");
    expect(topics.length).toBe(92);
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
