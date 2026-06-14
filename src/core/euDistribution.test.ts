import { describe, expect, it } from "vitest";
import type { AlternativeDistributionDomainResource } from "../apple/ascClient.js";
import { summarize } from "./asc/storeSync.js";
import {
  type AscEuDistributionApi,
  type EuDistributionConfig,
  parseEuDistributionConfig,
  reconcileEuDistributionDomains,
} from "./euDistribution.js";

/** A hand-rolled {@link AscEuDistributionApi} — no network — serving `existing` and recording creates. */
function makeApi(existing: AlternativeDistributionDomainResource[]): {
  api: AscEuDistributionApi;
  created: { domain: string; referenceName: string }[];
} {
  const created: { domain: string; referenceName: string }[] = [];
  const api: AscEuDistributionApi = {
    listAlternativeDistributionDomains: () => Promise.resolve(existing),
    createAlternativeDistributionDomain: (domain, referenceName) => {
      created.push({ domain, referenceName });
      return Promise.resolve();
    },
  };
  return { api, created };
}

const CONFIG: EuDistributionConfig = {
  domains: [
    { domain: "downloads.acme.com", referenceName: "Acme Downloads" },
    { domain: "cdn.acme.com", referenceName: "Acme CDN" },
  ],
};

describe("parseEuDistributionConfig", () => {
  it("parses an array of domains", () => {
    expect(parseEuDistributionConfig(CONFIG)).toEqual(CONFIG);
  });

  it("rejects a non-object document, an array, and a missing/empty domains list", () => {
    expect(() => parseEuDistributionConfig("nope")).toThrow(/must be a JSON object/);
    expect(() => parseEuDistributionConfig([])).toThrow(/must be a JSON object/);
    expect(() => parseEuDistributionConfig({})).toThrow(/non-empty "domains" array/);
    expect(() => parseEuDistributionConfig({ domains: [] })).toThrow(/non-empty "domains" array/);
    expect(() => parseEuDistributionConfig({ domains: {} })).toThrow(/non-empty "domains" array/);
  });

  it("rejects a domain entry missing domain or referenceName", () => {
    expect(() => parseEuDistributionConfig({ domains: [{ referenceName: "x" }] })).toThrow(
      /domain must be a non-empty/,
    );
    expect(() => parseEuDistributionConfig({ domains: [{ domain: "x" }] })).toThrow(
      /referenceName must be a non-empty/,
    );
  });
});

describe("reconcileEuDistributionDomains", () => {
  it("creates only the domains Apple doesn't already have", async () => {
    const { api, created } = makeApi([{ id: "d1", domain: "downloads.acme.com" }]);
    const actions = await reconcileEuDistributionDomains(api, CONFIG, false);

    expect(created).toEqual([{ domain: "cdn.acme.com", referenceName: "Acme CDN" }]);
    expect(summarize(actions)).toEqual({ applied: 1, failed: 0, skipped: 0 });
    expect(actions[0]?.description).toBe("authorize distribution domain cdn.acme.com (Acme CDN)");
  });

  it("makes no changes when every domain is already authorized", async () => {
    const { api, created } = makeApi([
      { id: "d1", domain: "downloads.acme.com" },
      { id: "d2", domain: "cdn.acme.com" },
    ]);
    const actions = await reconcileEuDistributionDomains(api, CONFIG, false);
    expect(actions).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it("plans but does not create on a dry-run", async () => {
    const { api, created } = makeApi([]);
    const actions = await reconcileEuDistributionDomains(api, CONFIG, true);
    expect(created).toHaveLength(0);
    expect(actions.map((action) => action.status)).toEqual(["planned", "planned"]);
  });

  it("captures a failed create without aborting the rest of the walk", async () => {
    const { api } = makeApi([]);
    api.createAlternativeDistributionDomain = (domain) =>
      domain === "downloads.acme.com" ? Promise.reject(new Error("invalid domain")) : Promise.resolve();
    const actions = await reconcileEuDistributionDomains(api, CONFIG, false);

    const summary = summarize(actions);
    expect(summary).toEqual({ applied: 1, failed: 1, skipped: 0 });
    expect(actions.find((action) => action.status === "failed")?.error).toBe("invalid domain");
  });
});
