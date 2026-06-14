import { describe, expect, it } from "vitest";
import { renderAction } from "./availability.js";

describe("renderAction", () => {
  it("marks an additive change with + and a destructive one with !", () => {
    expect(
      renderAction({ description: "set store availability → 3 territories", destructive: false, status: "planned" }),
    ).toBe("+ set store availability → 3 territories");
    expect(
      renderAction({
        description: "set store availability → 2 territories · −1 (FRA)",
        destructive: true,
        status: "planned",
      }),
    ).toBe("! set store availability → 2 territories · −1 (FRA)");
  });

  it("renders a failed action with ✗ and Apple's error detail", () => {
    expect(
      renderAction({
        description: "set store availability → 3 territories",
        destructive: false,
        status: "failed",
        error: "territory XYZ not eligible",
      }),
    ).toBe("✗ set store availability → 3 territories — territory XYZ not eligible");
  });
});
