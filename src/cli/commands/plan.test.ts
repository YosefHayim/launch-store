import { describe, expect, it } from "vitest";
import { additiveNote, planGlyph } from "./plan.js";
import type { PlannedAction } from "../../core/ascSync.js";

function action(over: Partial<PlannedAction> = {}): PlannedAction {
  return { description: "create in-app purchase com.acme.coins", destructive: false, status: "planned", ...over };
}

describe("planGlyph", () => {
  it("marks an addition with +", () => {
    expect(planGlyph(action())).toBe("+");
  });

  it("marks a change with ~", () => {
    expect(planGlyph(action({ description: 'update listing [en-US] App Info: name ∅→"Acme"' }))).toBe("~");
  });

  it("marks a destructive action with -", () => {
    expect(planGlyph(action({ description: "disable capability HEALTHKIT", destructive: true }))).toBe("-");
  });

  it("marks an advisory skip with •", () => {
    expect(
      planGlyph(action({ description: "listing [en-US]: name is 40 chars (max 30) — skipped", status: "skipped" })),
    ).toBe("•");
  });
});

describe("additiveNote", () => {
  it("names the surface and states the one-way caveat", () => {
    const note = additiveNote("wallet");
    expect(note).toContain("wallet");
    expect(note).toMatch(/additive/);
    expect(note).toMatch(/portal-side/);
  });
});
