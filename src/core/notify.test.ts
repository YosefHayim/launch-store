import { describe, expect, it } from "vitest";
import { notifyEnv, notifyMessage, notifyPayload, type NotifyEvent } from "./notify.js";

const success: NotifyEvent = {
  event: "submit",
  status: "success",
  app: "acme",
  platform: "ios",
  version: "1.2.3",
  buildNumber: 42,
  sizeBytes: 50 * 1024 * 1024,
  destination: "TestFlight",
};

const failure: NotifyEvent = {
  event: "build",
  status: "failure",
  app: "acme",
  platform: "android",
  version: "1.2.3",
  error: "gradle exited with code 1",
};

describe("notifyMessage", () => {
  it("summarizes a success with build number and destination", () => {
    expect(notifyMessage(success)).toBe("✅ Launch: acme 1.2.3 (42) submit succeeded → TestFlight");
  });

  it("summarizes a failure with the error", () => {
    expect(notifyMessage(failure)).toBe("❌ Launch: acme 1.2.3 — build failed: gradle exited with code 1");
  });
});

describe("notifyPayload", () => {
  it("sets both text (Slack) and content (Discord) to the message and carries the event fields", () => {
    const payload = notifyPayload(success);
    const message = notifyMessage(success);
    expect(payload["text"]).toBe(message);
    expect(payload["content"]).toBe(message);
    expect(payload["status"]).toBe("success");
    expect(payload["buildNumber"]).toBe(42);
  });
});

describe("notifyEnv", () => {
  it("exposes the core fields as LAUNCH_* strings", () => {
    const env = notifyEnv(success);
    expect(env).toMatchObject({
      LAUNCH_EVENT: "submit",
      LAUNCH_STATUS: "success",
      LAUNCH_APP: "acme",
      LAUNCH_PLATFORM: "ios",
      LAUNCH_VERSION: "1.2.3",
      LAUNCH_BUILD_NUMBER: "42",
      LAUNCH_DESTINATION: "TestFlight",
    });
  });

  it("omits absent optional fields and includes the error on failure", () => {
    const env = notifyEnv(failure);
    expect(env["LAUNCH_BUILD_NUMBER"]).toBeUndefined();
    expect(env["LAUNCH_DESTINATION"]).toBeUndefined();
    expect(env["LAUNCH_ERROR"]).toBe("gradle exited with code 1");
  });
});
