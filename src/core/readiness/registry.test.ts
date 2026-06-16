import { describe, expect, it } from "vitest";
import {
  listReadinessProbes,
  registerBuiltinProbes,
  registerReadinessProbe,
  selectReadinessProbes,
} from "./registry.js";
import type { ReadinessProbe } from "./types.js";

describe("readiness registry", () => {
  it("registers the built-in probes idempotently (re-registering replaces, never duplicates)", () => {
    registerBuiltinProbes();
    const first = listReadinessProbes().length;
    registerBuiltinProbes();
    expect(listReadinessProbes().length).toBe(first);
    expect(listReadinessProbes().map((probe) => probe.id)).toContain("apple-app-record");
    expect(listReadinessProbes().map((probe) => probe.id)).toContain("play-first-upload");
  });

  it("selects probes by category — every built-in is an account check; only some are iap", () => {
    registerBuiltinProbes();
    const account = selectReadinessProbes("account").map((probe) => probe.id);
    expect(account).toContain("apple-app-record");
    expect(account).toContain("play-app-access");

    const iap = selectReadinessProbes("iap").map((probe) => probe.id);
    expect(iap).toContain("apple-subscription-group");
    expect(iap).not.toContain("apple-app-record");
  });

  it("replaces a probe registered under an existing id", () => {
    const id = "test-only-probe";
    const make = (title: string): ReadinessProbe => ({
      id,
      title,
      store: "appstore",
      categories: ["account"],
      check: async () => ({ state: "omitted" }),
    });
    registerReadinessProbe(make("first"));
    registerReadinessProbe(make("second"));
    expect(listReadinessProbes().filter((probe) => probe.id === id)).toHaveLength(1);
    expect(listReadinessProbes().find((probe) => probe.id === id)?.title).toBe("second");
  });
});
