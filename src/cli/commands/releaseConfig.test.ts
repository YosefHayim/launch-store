import { describe, expect, it } from "vitest";
import { renderAction } from "./releaseConfig.js";

describe("renderAction", () => {
  it("marks a change with + and a skipped area with •", () => {
    expect(renderAction({ description: "set categories (primary=GAMES)", destructive: false, status: "planned" })).toBe(
      "+ set categories (primary=GAMES)",
    );
    expect(renderAction({ description: "set app price = 9.99 (USA)", destructive: false, status: "applied" })).toBe(
      "+ set app price = 9.99 (USA)",
    );
    expect(
      renderAction({
        description: "App Review details: no editable App Store version",
        destructive: false,
        status: "skipped",
      }),
    ).toBe("• App Review details: no editable App Store version");
  });

  it("renders a failed action with ✗ and Apple's error detail", () => {
    expect(
      renderAction({
        description: "set app price = 9.99 (USA)",
        destructive: false,
        status: "failed",
        error: "No USA app price point matches 9.99.",
      }),
    ).toBe("✗ set app price = 9.99 (USA) — No USA app price point matches 9.99.");
  });
});
