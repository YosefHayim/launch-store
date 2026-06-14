import { describe, expect, it } from "vitest";
import { renderAction } from "./accessibility.js";

describe("renderAction", () => {
  it("marks a planned or applied change with +", () => {
    expect(
      renderAction({ description: "create accessibility declaration (IPHONE)", destructive: false, status: "planned" }),
    ).toBe("+ create accessibility declaration (IPHONE)");
    expect(
      renderAction({
        description: "update accessibility declaration (IPAD) + publish",
        destructive: false,
        status: "applied",
      }),
    ).toBe("+ update accessibility declaration (IPAD) + publish");
  });

  it("renders a failed action with ✗ and Apple's error detail", () => {
    expect(
      renderAction({
        description: "publish accessibility declaration (IPHONE)",
        destructive: false,
        status: "failed",
        error: "declaration incomplete",
      }),
    ).toBe("✗ publish accessibility declaration (IPHONE) — declaration incomplete");
  });
});
