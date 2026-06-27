import { afterEach, describe, expect, it, vi } from "vitest";
import type { SecretStore } from "./types.js";
import { resolveSecretRef } from "./secretRef.js";

/** An in-memory SecretStore so the `keychain:` branch resolves without touching the real OS keychain. */
function fakeStore(entries: Record<string, string>): SecretStore {
  return {
    name: "fake",
    get: (account) => Promise.resolve(entries[account] ?? null),
    set: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
}

describe("resolveSecretRef", () => {
  const ENV_VAR = "LAUNCH_TEST_DEMO_PW";
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a literal value verbatim (back-compat with a plain string)", async () => {
    const literal = ["plain", "demo", "pw"].join("-");
    expect(await resolveSecretRef(literal, "demoAccountPassword")).toBe(literal);
  });

  it("resolves an `env:` reference from the environment at call time", async () => {
    const secret = ["env", "demo", "pw"].join("-");
    vi.stubEnv(ENV_VAR, secret);
    expect(await resolveSecretRef(`env:${ENV_VAR}`, "demoAccountPassword")).toBe(secret);
  });

  it("throws when an `env:` reference names an unset variable", async () => {
    await expect(resolveSecretRef(`env:${ENV_VAR}`, "demoAccountPassword")).rejects.toThrow(
      /environment variable LAUNCH_TEST_DEMO_PW is not set/,
    );
  });

  it("throws when an `env:` reference has no variable name", async () => {
    await expect(resolveSecretRef("env:", "demoAccountPassword")).rejects.toThrow(/needs a variable name/);
  });

  it("resolves a `keychain:` reference through the secret store", async () => {
    const secret = ["kc", "demo", "pw"].join("-");
    const store = fakeStore({ "my-app-review": secret });
    expect(await resolveSecretRef("keychain:my-app-review", "demoAccountPassword", store)).toBe(secret);
  });

  it("throws when a `keychain:` reference has no stored secret", async () => {
    await expect(resolveSecretRef("keychain:absent", "demoAccountPassword", fakeStore({}))).rejects.toThrow(
      /no secret is stored under that account/,
    );
  });
});
