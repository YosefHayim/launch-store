/**
 * Tests for the shared picker. The fuzzy filter is checked directly; {@link pickOne}'s interactive
 * branch needs a TTY (clack), so the unit tests cover the non-interactive policy — the part with real
 * branching logic — by driving `canPrompt: false`.
 */

import { describe, it, expect, vi } from "vitest";
import { fuzzyMatch, pickOne } from "./prompt.js";

describe("fuzzyMatch — the picker's subsequence filter", () => {
  it("matches an in-order subsequence, case-insensitively", () => {
    expect(fuzzyMatch("pmd", "pomedero")).toBe(true);
    expect(fuzzyMatch("PMD", "Pomedero")).toBe(true);
    expect(fuzzyMatch("pomedero", "pomedero")).toBe(true);
  });

  it("rejects characters that aren't a subsequence", () => {
    expect(fuzzyMatch("dmp", "pomedero")).toBe(false);
    expect(fuzzyMatch("xyz", "pomedero")).toBe(false);
  });

  it("treats a blank query as a match so the full list shows", () => {
    expect(fuzzyMatch("", "anything")).toBe(true);
    expect(fuzzyMatch("   ", "anything")).toBe(true);
  });
});

describe("pickOne — non-interactive policy (no TTY)", () => {
  const options = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
  ];

  it("throws with the flag hint under the `require` policy", async () => {
    await expect(
      pickOne({
        message: "Which app? (2 found)",
        options,
        canPrompt: false,
        nonInteractive: { kind: "require", flagHint: "— pass --app <name>." },
      }),
    ).rejects.toThrow(/--app/);
  });

  it("returns the fallback value (and prints its note) under the `fallback` policy", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const chosen = await pickOne({
      message: "Multiple keys found",
      options,
      canPrompt: false,
      nonInteractive: { kind: "fallback", value: "b", note: "using Beta; pass --p8 to choose another." },
    });
    expect(chosen).toBe("b");
    expect(log).toHaveBeenCalledWith("using Beta; pass --p8 to choose another.");
    log.mockRestore();
  });
});
