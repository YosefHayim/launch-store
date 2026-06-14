import { describe, expect, it } from "vitest";
import { renderAction } from "./euDistribution.js";

describe("renderAction", () => {
  it("marks a planned/applied authorization with +", () => {
    expect(
      renderAction({
        description: "authorize distribution domain cdn.acme.com (Acme CDN)",
        destructive: false,
        status: "planned",
      }),
    ).toBe("+ authorize distribution domain cdn.acme.com (Acme CDN)");
    expect(
      renderAction({
        description: "authorize distribution domain cdn.acme.com (Acme CDN)",
        destructive: false,
        status: "applied",
      }),
    ).toBe("+ authorize distribution domain cdn.acme.com (Acme CDN)");
  });

  it("renders a failed authorization with ✗ and Apple's error detail", () => {
    expect(
      renderAction({
        description: "authorize distribution domain bad..com (Bad)",
        destructive: false,
        status: "failed",
        error: "is not a valid domain",
      }),
    ).toBe("✗ authorize distribution domain bad..com (Bad) — is not a valid domain");
  });
});
