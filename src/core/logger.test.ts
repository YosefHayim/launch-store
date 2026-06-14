/**
 * Tests for the logger's `box` (the end-of-run "Shipped" receipt) and `notice` (the pre-upload
 * checkpoint) renderers. Under vitest stdout isn't a TTY, so both take their plain, non-boxed branch
 * — exactly the path CI logs and pipes hit — which is what we assert here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";

describe("logger box + notice (plain, non-TTY rendering)", () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, "log").mockImplementation((message?: string) => {
      lines.push(message ?? "");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("box prints the title then each row indented when output isn't a TTY", () => {
    createLogger(false).box("Shipped", ["pomedero 1.0.0 (42)", "download 47.2 MB · on disk 61.3 MB"]);
    expect(lines).toContain("Shipped");
    expect(lines).toContain("  pomedero 1.0.0 (42)");
    expect(lines).toContain("  download 47.2 MB · on disk 61.3 MB");
  });

  it("notice prints a lead line followed by indented detail lines", () => {
    createLogger(false).notice("▲ Upload to TestFlight", "pomedero 1.0.0 (build 42)");
    expect(lines.some((line) => line.includes("▲ Upload to TestFlight"))).toBe(true);
    expect(lines.some((line) => line.includes("pomedero 1.0.0 (build 42)"))).toBe(true);
  });
});
