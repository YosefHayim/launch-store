import { afterEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";

// Redirect ~/.launch to a throwaway temp dir so the test never touches the real first-run state.
vi.mock("./paths.js", async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const dir = path.join(os.tmpdir(), "launch-firstrun-test");
  return {
    LAUNCH_HOME: dir,
    STATE_FILE: path.join(dir, "state.json"),
    ensureDir: (target: string): string => {
      fs.mkdirSync(target, { recursive: true });
      return target;
    },
  };
});

import { STATE_FILE } from "./paths.js";
import { hasSeenTour, markTourSeen, readFirstRunState } from "./firstRun.js";

afterEach(() => {
  rmSync(STATE_FILE, { force: true });
});

describe("first-run state (~/.launch/state.json)", () => {
  it("reads as 'never seen' when the file does not exist", () => {
    expect(readFirstRunState()).toEqual({});
    expect(hasSeenTour()).toBe(false);
  });

  it("records the tour once and reads it back", () => {
    markTourSeen();
    expect(hasSeenTour()).toBe(true);
    expect(readFirstRunState().tourSeenAt).toBeTypeOf("string");
  });

  it("tolerates a malformed file by treating the tour as unseen", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(STATE_FILE, "{ not json");
    expect(readFirstRunState()).toEqual({});
    expect(hasSeenTour()).toBe(false);
  });
});
