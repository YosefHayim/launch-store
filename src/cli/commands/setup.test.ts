import { describe, expect, it } from "vitest";
import { formatReport, roleErrorMessage, type ProvisioningReport } from "./setup.js";

describe("roleErrorMessage", () => {
  it("names the inaccessible feature and points at the fix", () => {
    const message = roleErrorMessage("App ID capabilities");
    expect(message).toContain("App ID capabilities");
    expect(message).toContain("403");
    expect(message).toMatch(/Users & Access/);
  });
});

describe("formatReport", () => {
  const ready: ProvisioningReport = {
    account: { label: "Personal", keyId: "ABC123", teamId: "TEAM01" },
    app: { name: "pomedero", bundleId: "com.loopi.pomedero" },
    bundleIdRegistered: true,
    capabilities: ["PUSH_NOTIFICATIONS", "ASSOCIATED_DOMAINS"],
    certificateSerial: "AABBCC",
    profileName: "Launch_com.loopi.pomedero_AppStore",
    extensions: [],
    devices: [
      { name: "iPhone 15", udid: "000-111", disabled: false },
      { name: "Old iPad", udid: "222-333", disabled: true },
    ],
  };

  it("renders every section with the app heading and device lines", () => {
    const out = formatReport(ready);
    expect(out).toContain("pomedero (com.loopi.pomedero)");
    expect(out).toContain("Personal (key ABC123, team TEAM01)");
    expect(out).toContain("registered");
    expect(out).toContain("PUSH_NOTIFICATIONS, ASSOCIATED_DOMAINS");
    expect(out).toContain("iPhone 15 — 000-111");
    expect(out).toContain("Old iPad — 222-333 (disabled)");
  });

  it("flags each gap when nothing is provisioned yet", () => {
    const out = formatReport({
      ...ready,
      account: { label: "Work", keyId: "ZZZ999", teamId: null },
      bundleIdRegistered: false,
      capabilities: [],
      certificateSerial: null,
      profileName: null,
      devices: [],
    });
    expect(out).toContain("Work (key ZZZ999)");
    expect(out).not.toContain("team");
    expect(out).toContain("NOT registered");
    expect(out).toContain("none enabled");
    expect(out).toContain("none cached");
    expect(out).toContain("none (add with");
  });

  it("lists declared extensions with each one's provisioning status", () => {
    const out = formatReport({
      ...ready,
      extensions: [
        { bundleId: "com.loopi.pomedero.widget", provisioned: true },
        { bundleId: "com.loopi.pomedero.share", provisioned: false },
      ],
    });
    expect(out).toContain("extensions:   2 declared");
    expect(out).toContain("com.loopi.pomedero.widget — profile cached");
    expect(out).toContain("com.loopi.pomedero.share — not provisioned");
  });

  it("omits the extensions section entirely when none are declared", () => {
    expect(formatReport(ready)).not.toContain("extensions:");
  });
});
