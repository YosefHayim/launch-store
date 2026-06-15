/**
 * Tests for the Apple-account registry. The pure decision/encoding helpers need no mocking; the
 * stateful parts run against an in-memory secret store and a real temp `~/.launch` (the home dir is
 * redirected to a throwaway path so the real paths module resolves there), with `apple/credentials.js`
 * stubbed so no signing/exec code is pulled in. Together they cover the branching that decides which
 * account a build uses, the round-trip of a stored key, and the upgrade from the legacy layout.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import type { AccountRecord, AccountsFile } from "./types.js";

const secrets = vi.hoisted(() => ({ store: new Map<string, string>() }));
// Redirect HOME before any import evaluates `core/paths.js`, so the real module's `~/.launch` (and
// `accounts.json`) resolve under a throwaway dir. node:os `homedir()` honors $HOME / %USERPROFILE%.
const home = vi.hoisted(() => {
  const dir = `${process.env["TMPDIR"] ?? "/tmp"}/launch-accounts-test-${process.pid}`;
  process.env["HOME"] = dir;
  process.env["USERPROFILE"] = dir;
  return { dir };
});

vi.mock("./keychain.js", () => ({
  setSecret: async (account: string, value: string) => void secrets.store.set(account, value),
  getSecret: async (account: string) => secrets.store.get(account) ?? null,
  deleteSecret: async (account: string) => void secrets.store.delete(account),
}));

vi.mock("../apple/credentials.js", () => ({
  migrateLegacySigningIndex: vi.fn(),
  p12PasswordAccount: (keyId: string) => `dist-cert-p12-password:${keyId}`,
}));

import { ACCOUNTS_FILE, CREDENTIALS_DIR } from "./paths.js";
import {
  addAccount,
  decideBuildAccount,
  decodeP8,
  encodeP8,
  formatAccountSummary,
  getActiveKeyId,
  listAccounts,
  loadAscKeyById,
  matchAccount,
  migrateLegacyAccounts,
  removeAccount,
  renameAccount,
  setActiveKeyId,
  updateAccountIdentity,
} from "./accounts.js";
import { migrateLegacySigningIndex } from "../apple/credentials.js";

/** A realistic multi-line PKCS#8 PEM so the base64 round-trip exercises the real decode path. */
const PEM = ["-----BEGIN PRIVATE KEY-----", "MIGTAgEAMBMGByqGSM49AgEGCCqGSM49", "-----END PRIVATE KEY-----"].join("\n");

function file(active: string | null, ...labels: [string, string][]): AccountsFile {
  return {
    active,
    accounts: labels.map(([keyId, label]) => ({ keyId, label, issuerId: `issuer-${keyId}`, addedAt: "t" })),
  };
}

beforeEach(() => {
  secrets.store.clear();
  rmSync(ACCOUNTS_FILE, { force: true });
  rmSync(CREDENTIALS_DIR, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(home.dir, { recursive: true, force: true });
});

describe("encodeP8 / decodeP8", () => {
  it("round-trips a multi-line PEM through base64 unchanged", () => {
    expect(decodeP8(encodeP8(PEM))).toBe(PEM);
    expect(encodeP8(PEM)).not.toContain("\n");
  });

  it("repairs a legacy hex-encoded PEM (macOS `security -w` corruption)", () => {
    expect(decodeP8(Buffer.from(PEM, "utf8").toString("hex"))).toBe(PEM);
  });
});

describe("matchAccount", () => {
  const accounts = file(null, ["AAAA1111", "Personal"], ["BBBB2222", "Acme"]).accounts;

  it("matches by label, case-insensitively", () => {
    expect(matchAccount(accounts, "acme")?.keyId).toBe("BBBB2222");
  });
  it("matches by Key ID, case-insensitively", () => {
    expect(matchAccount(accounts, "aaaa1111")?.keyId).toBe("AAAA1111");
  });
  it("returns undefined for an unknown selector", () => {
    expect(matchAccount(accounts, "nope")).toBeUndefined();
  });
});

describe("formatAccountSummary", () => {
  const base: AccountRecord = { keyId: "F5763D97BY", issuerId: "issuer-x", label: "default", addedAt: "t" };

  it("degrades to label · team · key when no apps are cached", () => {
    expect(formatAccountSummary({ ...base, teamId: "5NS9ZUMYCS" })).toBe("default · team 5NS9ZUMYCS · key F5763D97BY");
  });

  it("omits the team segment when the account is unresolved", () => {
    expect(formatAccountSummary(base)).toBe("default · key F5763D97BY");
  });

  it("lists up to three app names inline with no +N suffix", () => {
    expect(formatAccountSummary({ ...base, teamId: "5NS9ZUMYCS", apps: ["OlyWell", "Zaatar", "Mealsy"] })).toBe(
      "default · OlyWell, Zaatar, Mealsy · team 5NS9ZUMYCS · key F5763D97BY",
    );
  });

  it("collapses the apps beyond the third into a +N count", () => {
    const apps = ["OlyWell", "Zaatar", "Mealsy", "Pomedero", "Looopi", "Sutton", "Nimbus"];
    expect(formatAccountSummary({ ...base, teamId: "5NS9ZUMYCS", apps })).toBe(
      "default · OlyWell, Zaatar, Mealsy +4 · team 5NS9ZUMYCS · key F5763D97BY",
    );
  });

  it("drops the leading label for the picker hint via includeLabel:false", () => {
    expect(formatAccountSummary({ ...base, teamId: "5NS9ZUMYCS", apps: ["OlyWell"] }, { includeLabel: false })).toBe(
      "OlyWell · team 5NS9ZUMYCS · key F5763D97BY",
    );
  });
});

describe("decideBuildAccount", () => {
  it("errors with a fix when no accounts exist", () => {
    expect(decideBuildAccount(file(null))).toEqual({ kind: "error", message: expect.stringContaining("set-key") });
  });
  it("uses an explicit selector match", () => {
    const decision = decideBuildAccount(file("AAAA1111", ["AAAA1111", "Personal"], ["BBBB2222", "Acme"]), "Acme");
    expect(decision).toMatchObject({ kind: "use", record: { keyId: "BBBB2222" } });
  });
  it("errors when the selector matches nothing", () => {
    expect(decideBuildAccount(file("AAAA1111", ["AAAA1111", "Personal"]), "ghost")).toMatchObject({ kind: "error" });
  });
  it("uses the active account when no selector is given", () => {
    const decision = decideBuildAccount(file("BBBB2222", ["AAAA1111", "Personal"], ["BBBB2222", "Acme"]));
    expect(decision).toMatchObject({ kind: "use", record: { keyId: "BBBB2222" } });
  });
  it("uses the sole account when none is active", () => {
    expect(decideBuildAccount(file(null, ["AAAA1111", "Personal"]))).toMatchObject({
      kind: "use",
      record: { keyId: "AAAA1111" },
    });
  });
  it("signals a pick when several accounts exist and none is active", () => {
    expect(decideBuildAccount(file(null, ["AAAA1111", "Personal"], ["BBBB2222", "Acme"]))).toEqual({ kind: "pick" });
  });
});

describe("registry mutations", () => {
  it("adds an account, stores its key namespaced, and makes it active", async () => {
    await addAccount({ keyId: "AAAA1111", issuerId: "issuer-a", label: "Personal", p8: PEM, teamId: "TEAM1" });
    expect(getActiveKeyId()).toBe("AAAA1111");
    expect(secrets.store.get("asc-p8:AAAA1111")).toBeDefined();
    const loaded = await loadAscKeyById("AAAA1111");
    expect(loaded).toEqual({ keyId: "AAAA1111", issuerId: "issuer-a", p8: PEM });
    expect(listAccounts()[0]).toMatchObject({ label: "Personal", teamId: "TEAM1", resolvedAt: expect.any(String) });
  });

  it("re-adding the same Key ID updates in place instead of duplicating", async () => {
    await addAccount({ keyId: "AAAA1111", issuerId: "issuer-a", label: "Personal", p8: PEM });
    await addAccount({ keyId: "AAAA1111", issuerId: "issuer-a", label: "Renamed", p8: PEM });
    expect(listAccounts()).toHaveLength(1);
    expect(listAccounts()[0]?.label).toBe("Renamed");
  });

  it("switches the active account and renames labels", async () => {
    await addAccount({ keyId: "AAAA1111", issuerId: "issuer-a", label: "Personal", p8: PEM });
    await addAccount({ keyId: "BBBB2222", issuerId: "issuer-b", label: "Acme", p8: PEM });
    setActiveKeyId("AAAA1111");
    expect(getActiveKeyId()).toBe("AAAA1111");
    renameAccount("AAAA1111", "Home");
    expect(matchAccount(listAccounts(), "Home")?.keyId).toBe("AAAA1111");
  });

  it("caches resolved identity in place", async () => {
    await addAccount({ keyId: "AAAA1111", issuerId: "issuer-a", label: "Personal", p8: PEM });
    updateAccountIdentity("AAAA1111", "TEAM9", ["Pomedero", "Looopi"]);
    expect(listAccounts()[0]).toMatchObject({ teamId: "TEAM9", apps: ["Pomedero", "Looopi"] });
  });

  it("removes an account, clears its secret, and re-points active to a survivor", async () => {
    await addAccount({ keyId: "AAAA1111", issuerId: "issuer-a", label: "Personal", p8: PEM });
    await addAccount({ keyId: "BBBB2222", issuerId: "issuer-b", label: "Acme", p8: PEM }); // becomes active
    await removeAccount("BBBB2222");
    expect(secrets.store.has("asc-p8:BBBB2222")).toBe(false);
    expect(listAccounts()).toHaveLength(1);
    expect(getActiveKeyId()).toBe("AAAA1111");
  });
});

describe("migrateLegacyAccounts", () => {
  it("moves a legacy single key into the registry as the active 'default' account", async () => {
    secrets.store.set("asc-key-id", "QS5924Q3MD");
    secrets.store.set("asc-issuer-id", "issuer-legacy");
    secrets.store.set("asc-p8", PEM);
    secrets.store.set("dist-cert-p12-password", "secret-pw");

    await migrateLegacyAccounts();

    expect(getActiveKeyId()).toBe("QS5924Q3MD");
    expect(listAccounts()[0]).toMatchObject({ keyId: "QS5924Q3MD", label: "default", issuerId: "issuer-legacy" });
    expect(secrets.store.get("asc-p8:QS5924Q3MD")).toBeDefined();
    expect(secrets.store.get("dist-cert-p12-password:QS5924Q3MD")).toBe("secret-pw");
    expect(secrets.store.has("asc-key-id")).toBe(false);
    expect(secrets.store.has("dist-cert-p12-password")).toBe(false);
    expect(vi.mocked(migrateLegacySigningIndex)).toHaveBeenCalledWith("QS5924Q3MD");
    expect(await loadAscKeyById("QS5924Q3MD")).toEqual({ keyId: "QS5924Q3MD", issuerId: "issuer-legacy", p8: PEM });
  });

  it("is a no-op when nothing was imported the old way", async () => {
    await migrateLegacyAccounts();
    expect(listAccounts()).toHaveLength(0);
  });
});
