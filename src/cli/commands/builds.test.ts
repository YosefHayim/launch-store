import { describe, expect, it } from "vitest";
import { buildId, filterBuilds, findBuild, formatBuildDetail, formatBuildsTable, toBuildRow } from "./builds.js";
import type { BuildArtifact } from "../../core/types.js";

const MB = 1024 * 1024;

/** A stored-build fixture; override any field to vary one dimension under test. */
function artifact(overrides: Partial<BuildArtifact> = {}): BuildArtifact {
  return {
    path: "/home/u/.launch/artifacts/demo-1.0.0-7-ios.ipa",
    platform: "ios",
    appName: "demo",
    profile: "production",
    version: "1.0.0",
    buildNumber: 7,
    sizeReport: {
      artifactBytes: 61 * MB,
      entries: [{ device: "iPhone15,2", downloadBytes: 38 * MB, installBytes: 92 * MB }],
    },
    clean: true,
    createdAt: "2026-06-13T14:02:11.000Z",
    ...overrides,
  };
}

describe("buildId — stable, provider-independent id from natural keys", () => {
  it("joins app, version, build number, and platform", () => {
    expect(buildId(artifact())).toBe("demo-1.0.0-7-ios");
  });

  it("ignores the storage path and file extension", () => {
    expect(buildId(artifact({ path: "/elsewhere/whatever.aab" }))).toBe("demo-1.0.0-7-ios");
  });
});

describe("toBuildRow", () => {
  it("derives the worst-case download from the per-device entries", () => {
    const row = toBuildRow(
      artifact({
        sizeReport: {
          artifactBytes: 61 * MB,
          entries: [
            { device: "a", downloadBytes: 38 * MB, installBytes: 0 },
            { device: "b", downloadBytes: 47 * MB, installBytes: 0 },
          ],
        },
      }),
    );
    expect(row.downloadBytes).toBe(47 * MB);
    expect(row.artifactBytes).toBe(61 * MB);
    expect(row.id).toBe("demo-1.0.0-7-ios");
  });
});

describe("filterBuilds", () => {
  const ios = artifact({ appName: "demo", platform: "ios" });
  const android = artifact({ appName: "demo", platform: "android", path: "/a/demo.aab" });
  const other = artifact({ appName: "other", platform: "ios" });
  const all = [ios, android, other];

  it("returns everything when no filter is set", () => {
    expect(filterBuilds(all, {})).toEqual(all);
  });

  it("filters by app", () => {
    expect(filterBuilds(all, { app: "demo" })).toEqual([ios, android]);
  });

  it("filters by platform", () => {
    expect(filterBuilds(all, { platform: "android" })).toEqual([android]);
  });

  it("filters by app and platform together", () => {
    expect(filterBuilds(all, { app: "demo", platform: "ios" })).toEqual([ios]);
  });
});

describe("findBuild", () => {
  const newest = artifact({ buildNumber: 9, version: "1.1.0" });
  const older = artifact({ buildNumber: 7, version: "1.0.0" });
  const history = [newest, older]; // newest-first, as the index stores it

  it("resolves `latest` to the newest build", () => {
    expect(findBuild(history, "latest")).toBe(newest);
  });

  it("matches a full build id", () => {
    expect(findBuild(history, "demo-1.0.0-7-ios")).toBe(older);
  });

  it("matches a bare build number", () => {
    expect(findBuild(history, "9")).toBe(newest);
  });

  it("returns undefined on a miss", () => {
    expect(findBuild(history, "nope")).toBeUndefined();
  });

  it("returns undefined for `latest` against an empty history", () => {
    expect(findBuild([], "latest")).toBeUndefined();
  });
});

describe("formatBuildsTable", () => {
  it("renders a header plus one aligned row per build", () => {
    const table = formatBuildsTable([artifact()].map(toBuildRow));
    const [header, row] = table.split("\n");
    expect(header).toContain("BUILD");
    expect(header).toContain("DOWNLOAD");
    expect(header).toContain("TYPE");
    expect(row).toContain("demo");
    expect(row).toContain("38.0 MB");
    expect(row).toContain("2026-06-13 14:02");
    expect(row).toContain("clean");
  });

  it("labels an incremental build", () => {
    const table = formatBuildsTable([artifact({ clean: false })].map(toBuildRow));
    expect(table).toContain("incremental");
  });
});

describe("formatBuildDetail", () => {
  it("shows both size numbers and the per-device breakdown", () => {
    const detail = formatBuildDetail(artifact());
    expect(detail).toContain("demo 1.0.0 (build 7) · ios");
    expect(detail).toContain("download 38.0 MB · on disk 61.0 MB");
    expect(detail).toContain("iPhone15,2");
    expect(detail).toContain("install 92.0 MB");
    expect(detail).toContain("demo-1.0.0-7-ios");
  });

  it("omits the per-device block when there is no thinning report", () => {
    const detail = formatBuildDetail(artifact({ sizeReport: { artifactBytes: 61 * MB, entries: [] } }));
    expect(detail).not.toContain("download / install");
    expect(detail).toContain("on disk 61.0 MB (no per-device estimate)");
  });
});
