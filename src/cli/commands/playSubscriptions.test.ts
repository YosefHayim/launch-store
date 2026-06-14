import { describe, expect, it } from "vitest";
import { renderAction } from "./playSubscriptions.js";

describe("renderAction", () => {
  it("marks a planned change with +", () => {
    expect(
      renderAction({
        description: "create Play subscription com.acme.pro.monthly",
        destructive: false,
        status: "planned",
      }),
    ).toBe("+ create Play subscription com.acme.pro.monthly");
  });

  it("renders a failed action with ✗ and Play's error detail", () => {
    expect(
      renderAction({
        description: "create offer trial on base plan p1m",
        destructive: false,
        status: "failed",
        error: "no region common to its trial and intro-price phases",
      }),
    ).toBe("✗ create offer trial on base plan p1m — no region common to its trial and intro-price phases");
  });
});
