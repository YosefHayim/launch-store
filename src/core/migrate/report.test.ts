import { describe, expect, it } from "vitest";
import { renderReport } from "./report.js";
import type { MigrationResult } from "./types.js";

/** A result exercising every note level plus a couple of artifacts. */
const RESULT: MigrationResult = {
  source: "eas",
  artifacts: [
    { path: "launch.config.ts", contents: "" },
    { path: ".env.example", contents: "" },
  ],
  notes: [
    { level: "mapped", message: "Build profile mapped." },
    { level: "manual", message: "Configure your Apple key." },
    { level: "skipped", message: "store.config.json kept." },
    { level: "info", message: "Detected bundle id." },
  ],
};

describe("renderReport", () => {
  it("titles the report and names the source", () => {
    const md = renderReport(RESULT);
    expect(md).toContain("# Launch migration report");
    expect(md).toContain("EAS (eas.json)");
  });

  it("lists the emitted artifacts", () => {
    const md = renderReport(RESULT);
    expect(md).toContain("- `launch.config.ts`");
    expect(md).toContain("- `.env.example`");
  });

  it("renders a section per present note level, actionable first", () => {
    const md = renderReport(RESULT);
    expect(md).toContain("## Needs your attention");
    expect(md).toContain("## Mapped automatically");
    expect(md).toContain("## Skipped (left as-is)");
    expect(md).toContain("## For your information");
    expect(md.indexOf("## Needs your attention")).toBeLessThan(md.indexOf("## For your information"));
  });

  it("omits sections with no notes", () => {
    const md = renderReport({ ...RESULT, notes: [{ level: "manual", message: "x" }] });
    expect(md).toContain("## Needs your attention");
    expect(md).not.toContain("## For your information");
  });
});
