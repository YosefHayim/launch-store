import { describe, expect, it } from "vitest";
import { renderAction } from "./wallet.js";

describe("renderAction", () => {
  it("marks a planned/applied registration with +", () => {
    expect(
      renderAction({
        description: "register Apple Pay merchant id merchant.com.acme.app (Acme Pay)",
        destructive: false,
        status: "planned",
      }),
    ).toBe("+ register Apple Pay merchant id merchant.com.acme.app (Acme Pay)");
    expect(
      renderAction({
        description: "register Wallet pass type id pass.com.acme.coupon (Acme Coupon)",
        destructive: false,
        status: "applied",
      }),
    ).toBe("+ register Wallet pass type id pass.com.acme.coupon (Acme Coupon)");
  });

  it("renders a failed registration with ✗ and Apple's error detail", () => {
    expect(
      renderAction({
        description: "register Apple Pay merchant id merchant.com.acme.app (Acme Pay)",
        destructive: false,
        status: "failed",
        error: "identifier already exists",
      }),
    ).toBe("✗ register Apple Pay merchant id merchant.com.acme.app (Acme Pay) — identifier already exists");
  });
});
