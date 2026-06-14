import { describe, expect, it } from "vitest";
import { resolveDisplayType } from "./screenshots.js";

describe("resolveDisplayType", () => {
  it("recognizes canonical Apple constants case-insensitively", () => {
    expect(resolveDisplayType("APP_IPHONE_67")).toBe("APP_IPHONE_67");
    expect(resolveDisplayType("app_desktop")).toBe("APP_DESKTOP");
  });

  it("maps friendly aliases to Apple's constant", () => {
    expect(resolveDisplayType("iphone-6.7")).toBe("APP_IPHONE_67");
    expect(resolveDisplayType("mac")).toBe("APP_DESKTOP");
    expect(resolveDisplayType("watch-ultra")).toBe("APP_WATCH_ULTRA");
    expect(resolveDisplayType("vision")).toBe("APP_APPLE_VISION_PRO");
  });

  it("passes through well-formed but unknown types — Apple's enum lags new hardware", () => {
    expect(resolveDisplayType("APP_IPHONE_99")).toBe("APP_IPHONE_99");
    expect(resolveDisplayType("IMESSAGE_APP_IPHONE_67")).toBe("IMESSAGE_APP_IPHONE_67");
  });

  it("rejects names that clearly aren't a display type", () => {
    expect(resolveDisplayType("random-folder")).toBeNull();
    expect(resolveDisplayType("screenshots")).toBeNull();
    expect(resolveDisplayType("")).toBeNull();
  });
});
