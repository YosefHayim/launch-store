import { describe, expect, it } from "vitest";
import { formatElapsed, gradleProgressStep, selectProgressMode, xcodeProgressStep } from "./progress.js";

describe("selectProgressMode — only a real interactive TTY gets the spinner", () => {
  it("uses the spinner on an interactive, non-CI TTY without --verbose", () => {
    expect(selectProgressMode(true, {}, false)).toBe("spinner");
  });

  it("streams raw output under --verbose so the full log is visible", () => {
    expect(selectProgressMode(true, {}, true)).toBe("stream");
  });

  it("streams when not a TTY (piped output, log files, agents)", () => {
    expect(selectProgressMode(false, {}, false)).toBe("stream");
  });

  it("streams in CI so transcripts keep the complete output", () => {
    expect(selectProgressMode(true, { CI: "true" }, false)).toBe("stream");
  });
});

describe("formatElapsed — compact mm ss clock", () => {
  it("shows bare seconds under a minute", () => {
    expect(formatElapsed(5_000)).toBe("5s");
    expect(formatElapsed(45_000)).toBe("45s");
  });

  it("shows minutes with zero-padded seconds past a minute", () => {
    expect(formatElapsed(72_000)).toBe("1m 12s");
    expect(formatElapsed(125_000)).toBe("2m 05s");
  });
});

describe("xcodeProgressStep — surface the xcpretty step", () => {
  it("extracts the text after the ▸ marker", () => {
    expect(xcodeProgressStep("[02:56:43]: ▸ Compiling yuv_sse2.c")).toBe("Compiling yuv_sse2.c");
  });

  it("ignores lines without a step marker", () => {
    expect(xcodeProgressStep("[02:56:36]: Clean Succeeded")).toBeUndefined();
  });

  it("truncates an over-long step so it stays on one line", () => {
    const long = `▸ ${"Compiling/a/very/deep/path/to/some/Source.swift".repeat(3)}`;
    const step = xcodeProgressStep(long);
    expect(step).toBeDefined();
    expect(step?.length).toBeLessThanOrEqual(52);
    expect(step?.endsWith("…")).toBe(true);
  });
});

describe("gradleProgressStep — surface the Gradle task", () => {
  it("extracts the task path", () => {
    expect(gradleProgressStep("> Task :app:bundleRelease")).toBe(":app:bundleRelease");
  });

  it("extracts the task even with surrounding state and indentation", () => {
    expect(gradleProgressStep("  > Task :app:compileReleaseKotlin UP-TO-DATE")).toBe(":app:compileReleaseKotlin");
  });

  it("ignores non-task lines", () => {
    expect(gradleProgressStep("BUILD SUCCESSFUL in 1m 12s")).toBeUndefined();
  });
});
