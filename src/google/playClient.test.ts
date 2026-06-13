import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { GooglePlayClient, PlayAppNotFoundError, describePlayErrors, parseServiceAccount } from "./playClient.js";

/** A real RSA PKCS#8 key so `jose` can actually sign — the client mints a genuine RS256 assertion. */
function makeServiceAccountJson(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    type: "service_account",
    client_email: "launch@proj.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    private_key_id: "kid-123",
    token_uri: "https://oauth2.googleapis.com/token",
  });
}

/** Minimal stand-in for the parts of `Response` the client reads. */
function fakeResponse(status: number, body: string) {
  return { status, ok: status >= 200 && status < 300, text: () => Promise.resolve(body) };
}

/** Decode a JWT payload (no verification needed — we only assert the claims we set). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload!, "base64url").toString());
}

describe("parseServiceAccount", () => {
  it("extracts the fields Launch needs from a valid key", () => {
    const account = parseServiceAccount(makeServiceAccountJson());
    expect(account.clientEmail).toBe("launch@proj.iam.gserviceaccount.com");
    expect(account.privateKey).toContain("PRIVATE KEY");
    expect(account.tokenUri).toBe("https://oauth2.googleapis.com/token");
    expect(account.privateKeyId).toBe("kid-123");
  });

  it("defaults the token endpoint when absent", () => {
    const account = parseServiceAccount(
      JSON.stringify({
        client_email: "a@b.iam",
        private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----",
      }),
    );
    expect(account.tokenUri).toBe("https://oauth2.googleapis.com/token");
  });

  it("rejects non-JSON and the wrong kind of key with an actionable error", () => {
    expect(() => parseServiceAccount("not json")).toThrow(/not valid JSON/);
    expect(() => parseServiceAccount(JSON.stringify({ type: "authorized_user" }))).toThrow(/client_email.*private_key/);
  });
});

describe("describePlayErrors", () => {
  it("extracts Google's error message", () => {
    expect(describePlayErrors(JSON.stringify({ error: { message: "The app was not found." } }))).toBe(
      "The app was not found.",
    );
  });

  it("flags a sensitive-permission rejection with the fix", () => {
    const body = JSON.stringify({ error: { message: "Your app uses a sensitive permission." } });
    expect(describePlayErrors(body)).toMatch(/Permissions Declaration/);
  });

  it("falls back to raw text, then a placeholder when empty", () => {
    expect(describePlayErrors("plain failure")).toBe("plain failure");
    expect(describePlayErrors("")).toBe("no response body");
  });
});

const fetchMock = vi.fn();
let client: GooglePlayClient;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  client = new GooglePlayClient(parseServiceAccount(makeServiceAccountJson()));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GooglePlayClient — auth + reads", () => {
  it("exchanges a JWT-bearer assertion for a token, then returns the highest versionCode", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ access_token: "tok", expires_in: 3600 })))
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ id: "edit1" })))
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ bundles: [{ versionCode: 3 }, { versionCode: 7 }] })))
      .mockResolvedValueOnce(fakeResponse(204, ""));

    expect(await client.getLatestVersionCode("com.example.hello")).toBe(7);

    // The first call is the token exchange, carrying a JWT-bearer assertion bound to the account.
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    const assertion = (tokenInit.body as URLSearchParams).get("assertion")!;
    expect((tokenInit.body as URLSearchParams).get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const payload = decodeJwtPayload(assertion);
    expect(payload["iss"]).toBe("launch@proj.iam.gserviceaccount.com");
    expect(payload["scope"]).toBe("https://www.googleapis.com/auth/androidpublisher");
    expect(payload["aud"]).toBe("https://oauth2.googleapis.com/token");

    // The edit call carries the resolved bearer token.
    const [editUrl, editInit] = fetchMock.mock.calls[1]!;
    expect(editUrl).toContain("/applications/com.example.hello/edits");
    expect((editInit.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
  });

  it("reports zero when no bundles have been uploaded yet", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ access_token: "tok", expires_in: 3600 })))
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ id: "edit1" })))
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({})))
      .mockResolvedValueOnce(fakeResponse(204, ""));

    expect(await client.getLatestVersionCode("com.example.fresh")).toBe(0);
  });

  it("raises PlayAppNotFoundError when the app record is missing (404 on edit creation)", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ access_token: "tok", expires_in: 3600 })))
      .mockResolvedValueOnce(fakeResponse(404, JSON.stringify({ error: { message: "Application not found." } })));

    await expect(client.assertAppExists("com.example.missing")).rejects.toBeInstanceOf(PlayAppNotFoundError);
  });
});
