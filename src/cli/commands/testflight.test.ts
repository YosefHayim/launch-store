import { describe, expect, it } from "vitest";
import { parseTestersCsv, renderBetaAction } from "./testflight.js";

describe("parseTestersCsv", () => {
  it("parses email,firstName,lastName rows and trims whitespace", () => {
    expect(parseTestersCsv("a@x.com, Dana , Lee\nb@x.com,Sam,Ng")).toEqual([
      { email: "a@x.com", firstName: "Dana", lastName: "Lee" },
      { email: "b@x.com", firstName: "Sam", lastName: "Ng" },
    ]);
  });

  it("skips a header row whose first cell isn't an email, plus blank lines", () => {
    const csv = "email,first,last\n\na@x.com,Dana\n\n";
    expect(parseTestersCsv(csv)).toEqual([{ email: "a@x.com", firstName: "Dana" }]);
  });

  it("accepts a bare email with no name columns", () => {
    expect(parseTestersCsv("solo@x.com")).toEqual([{ email: "solo@x.com" }]);
  });

  it("tolerates CRLF line endings", () => {
    expect(parseTestersCsv("a@x.com,Dana\r\nb@x.com,Sam\r\n")).toEqual([
      { email: "a@x.com", firstName: "Dana" },
      { email: "b@x.com", firstName: "Sam" },
    ]);
  });

  it("ignores rows without an @ (junk or partial lines)", () => {
    expect(parseTestersCsv("not-an-email\na@x.com")).toEqual([{ email: "a@x.com" }]);
  });
});

describe("renderBetaAction", () => {
  it("marks a change with +, a skip with •", () => {
    expect(renderBetaAction({ description: 'set "What to Test" (en-US)', destructive: false, status: "planned" })).toBe(
      '+ set "What to Test" (en-US)',
    );
    expect(
      renderBetaAction({
        description: "submit for Beta App Review: build already submitted (in review)",
        destructive: false,
        status: "skipped",
      }),
    ).toBe("• submit for Beta App Review: build already submitted (in review)");
  });

  it("renders a failed action with ✗ and Apple's error detail", () => {
    expect(
      renderBetaAction({
        description: "submit for Beta App Review",
        destructive: false,
        status: "failed",
        error: "build is still processing",
      }),
    ).toBe("✗ submit for Beta App Review — build is still processing");
  });
});
