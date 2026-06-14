import { describe, expect, it } from "vitest";
import { buildXcargs, ccacheEnv, computeBuildJobs, xcargsExtra } from "./buildFlags.js";

const GB = 1024 ** 3;

describe("computeBuildJobs — RAM-aware parallelism cap", () => {
  it("returns undefined (no cap) when floor(GB/2) meets or exceeds the core count", () => {
    expect(computeBuildJobs(8, 16 * GB)).toBeUndefined(); // floor(8) === 8 cores
    expect(computeBuildJobs(10, 32 * GB)).toBeUndefined(); // floor(16) clamps to 10
    expect(computeBuildJobs(2, 64 * GB)).toBeUndefined();
  });

  it("caps below the core count on RAM-constrained machines", () => {
    expect(computeBuildJobs(8, 8 * GB)).toBe(4); // floor(4) < 8
    expect(computeBuildJobs(8, 4 * GB)).toBe(2); // floor(2) < 8
  });

  it("never drops below 2 even on tiny RAM", () => {
    expect(computeBuildJobs(4, 3 * GB)).toBe(2); // floor(1.5)=1 → floored to 2
  });
});

describe("ccacheEnv — wires the compiler cache on", () => {
  it("sets only USE_CCACHE (ccache uses its own default cache dir)", () => {
    expect(ccacheEnv()).toEqual({ USE_CCACHE: "1" });
  });
});

describe("xcargsExtra — always-on headless tuning", () => {
  it("disables the index store and omits -jobs when there's no cap", () => {
    expect(xcargsExtra(undefined)).toBe("COMPILER_INDEX_STORE_ENABLE=NO");
  });

  it("appends -jobs when a cap is set", () => {
    expect(xcargsExtra(6)).toBe("COMPILER_INDEX_STORE_ENABLE=NO -jobs 6");
  });
});

describe("buildXcargs — manual signing + the shared extras", () => {
  it("carries the resolved team/profile and the headless tuning", () => {
    const xcargs = buildXcargs({ teamId: "ABCDE12345", profileName: "Launch_AppStore" }, 6);
    expect(xcargs).toContain("DEVELOPMENT_TEAM=ABCDE12345");
    expect(xcargs).toContain("CODE_SIGN_STYLE=Manual");
    expect(xcargs).toContain("PROVISIONING_PROFILE_SPECIFIER=Launch_AppStore");
    expect(xcargs).toContain("COMPILER_INDEX_STORE_ENABLE=NO");
    expect(xcargs).toContain("-jobs 6");
  });
});
