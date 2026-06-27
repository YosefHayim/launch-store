import { describe, expect, it } from "vitest";
import { buildXcargs, ccacheEnv, computeBuildJobs, gymArgs, xcargsExtra } from "./buildFlags.js";
import type { GymArgsInput } from "./buildFlags.js";

const GB = 1024 ** 3;

/** A fixed gym input so a test can assert the exact argv. The signing/jobs feed `buildXcargs`. */
const BASE_GYM: Omit<GymArgsInput, "destination"> = {
  workspace: "/app/ios/MyApp.xcworkspace",
  scheme: "MyApp",
  outputDir: "/tmp/out",
  outputName: "MyApp.ipa",
  exportOptionsPath: "/tmp/out/ExportOptions.plist",
  signing: { teamId: "ABCDE12345", profileName: "Launch_AppStore", certName: "Apple Distribution" },
  jobs: 6,
  clean: false,
};

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

describe("gymArgs — one source for the gym argv; iOS stays byte-identical", () => {
  it("emits the EXACT historical iOS vector when destination is undefined (no --destination)", () => {
    // This is the pinned iOS command from before cross-platform builds existed. If this array changes,
    // an iOS build changed — the regression this whole feature must NOT introduce.
    expect(gymArgs({ ...BASE_GYM, destination: undefined })).toEqual([
      "gym",
      "--workspace",
      "/app/ios/MyApp.xcworkspace",
      "--scheme",
      "MyApp",
      "--output_directory",
      "/tmp/out",
      "--output_name",
      "MyApp.ipa",
      "--export_options",
      "/tmp/out/ExportOptions.plist",
      "--codesigning_identity",
      "Apple Distribution",
      "--xcargs",
      "DEVELOPMENT_TEAM=ABCDE12345 CODE_SIGN_STYLE=Manual PROVISIONING_PROFILE_SPECIFIER=Launch_AppStore COMPILER_INDEX_STORE_ENABLE=NO -jobs 6",
    ]);
  });

  it("never inserts a --destination flag for iOS, with or without --clean", () => {
    expect(gymArgs({ ...BASE_GYM, destination: undefined })).not.toContain("--destination");
    expect(gymArgs({ ...BASE_GYM, clean: true, destination: undefined })).not.toContain("--destination");
  });

  it("injects --destination right after --xcargs for the other Apple platforms", () => {
    const args = gymArgs({ ...BASE_GYM, destination: "generic/platform=tvOS" });
    const i = args.indexOf("--destination");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("generic/platform=tvOS");
    expect(args[i - 2]).toBe("--xcargs"); // sits immediately after the xcargs pair
  });

  it("keeps --clean last so the iOS prefix is identical whether or not a destination is present", () => {
    const args = gymArgs({ ...BASE_GYM, clean: true, destination: "generic/platform=macOS" });
    expect(args[args.length - 1]).toBe("--clean");
    expect(args).toContain("--destination");
  });
});
