import { describe, expect, it } from "vitest";
import { phasedStateForAction } from "./rollout.js";

describe("phasedStateForAction", () => {
  it("maps each verb to its App Store Connect phased-release state", () => {
    expect(phasedStateForAction("pause")).toBe("PAUSE");
    expect(phasedStateForAction("resume")).toBe("ACTIVE");
    expect(phasedStateForAction("complete")).toBe("COMPLETE");
  });

  it("throws on an unknown verb", () => {
    expect(() => phasedStateForAction("halt")).toThrow(/Unknown rollout action "halt"/);
  });
});
