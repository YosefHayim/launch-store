import { describe, expect, it } from "vitest";
import { type NotifyEvent, formatNotifyMessage, notifyEnv } from "./notify.js";

const base: NotifyEvent = {
  kind: "build",
  status: "success",
  app: "looopi",
  platform: "ios",
  version: "1.2.0",
  buildNumber: 42,
};

describe("formatNotifyMessage", () => {
  it("summarizes a successful build with its download size", () => {
    const msg = formatNotifyMessage({ ...base, downloadBytes: 47 * 1024 * 1024 });
    expect(msg).toContain("✅");
    expect(msg).toContain("looopi 1.2.0 (build 42)");
    expect(msg).toContain("ios build success");
    expect(msg).toContain("download 47.0 MB");
  });

  it("summarizes a submit with its destination", () => {
    const msg = formatNotifyMessage({ ...base, kind: "submit", destination: "TestFlight" });
    expect(msg).toContain("ios submit success");
    expect(msg).toContain("→ TestFlight");
  });

  it("shows the error on failure", () => {
    const msg = formatNotifyMessage({ ...base, status: "failure", error: "xcodebuild exited with code 65" });
    expect(msg).toContain("❌");
    expect(msg).toContain("build failure");
    expect(msg).toContain("xcodebuild exited with code 65");
  });
});

describe("notifyEnv", () => {
  it("exposes LAUNCH_* metadata as strings, omitting absent fields", () => {
    const env = notifyEnv({ ...base, downloadBytes: 1048576 });
    expect(env).toMatchObject({
      LAUNCH_KIND: "build",
      LAUNCH_STATUS: "success",
      LAUNCH_APP: "looopi",
      LAUNCH_PLATFORM: "ios",
      LAUNCH_VERSION: "1.2.0",
      LAUNCH_BUILD_NUMBER: "42",
      LAUNCH_DOWNLOAD_BYTES: "1048576",
    });
    expect(env["LAUNCH_ERROR"]).toBeUndefined();
    expect(env["LAUNCH_MESSAGE"]).toContain("looopi");
  });

  it("includes the error and omits the download on failure", () => {
    const env = notifyEnv({ ...base, status: "failure", error: "boom" });
    expect(env["LAUNCH_ERROR"]).toBe("boom");
    expect(env["LAUNCH_DOWNLOAD_BYTES"]).toBeUndefined();
  });
});
