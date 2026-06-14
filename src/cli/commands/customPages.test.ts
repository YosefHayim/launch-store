import { describe, expect, it } from "vitest";
import { renderAction } from "./customPages.js";

describe("renderAction", () => {
  it("marks a change with +, a skip with •", () => {
    expect(
      renderAction({ description: 'create custom product page "Spring Sale"', destructive: false, status: "planned" }),
    ).toBe('+ create custom product page "Spring Sale"');
    expect(
      renderAction({
        description: 'promotional text on "Spring Sale": skipped — no editable version',
        destructive: false,
        status: "skipped",
      }),
    ).toBe('• promotional text on "Spring Sale": skipped — no editable version');
  });

  it("renders a failed action with ✗ and Apple's error detail", () => {
    expect(
      renderAction({
        description: 'create custom product page "Spring Sale"',
        destructive: false,
        status: "failed",
        error: "page name taken",
      }),
    ).toBe('✗ create custom product page "Spring Sale" — page name taken');
  });
});
