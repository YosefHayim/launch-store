import { describe, expect, it } from "vitest";
import { renderAction } from "./appClips.js";

describe("renderAction", () => {
  it("marks a change with + and a skipped clip with •", () => {
    expect(
      renderAction({ description: "set com.acme.app.Clip card action = OPEN", destructive: false, status: "planned" }),
    ).toBe("+ set com.acme.app.Clip card action = OPEN");
    expect(
      renderAction({
        description: "set com.acme.app.Clip card subtitle (en-US)",
        destructive: false,
        status: "applied",
      }),
    ).toBe("+ set com.acme.app.Clip card subtitle (en-US)");
    expect(
      renderAction({
        description: "App Clip com.acme.app.Clip: no clip record yet",
        destructive: false,
        status: "skipped",
      }),
    ).toBe("• App Clip com.acme.app.Clip: no clip record yet");
  });

  it("renders a failed action with ✗ and Apple's error detail", () => {
    expect(
      renderAction({
        description: "create com.acme.app.Clip App Clip default experience (action=OPEN)",
        destructive: false,
        status: "failed",
        error: "appClip is in an invalid state",
      }),
    ).toBe("✗ create com.acme.app.Clip App Clip default experience (action=OPEN) — appClip is in an invalid state");
  });
});
