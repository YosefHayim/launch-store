import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { AscKey } from "../core/types.js";
import { AppStoreConnectClient, describeErrors } from "./ascClient.js";

/** A real P-256 PKCS#8 key so `jose` can actually sign — the client mints a genuine ES256 JWT. */
function makeKey(): AscKey {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    keyId: "KEY123",
    issuerId: "issuer-uuid",
    p8: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** Minimal stand-in for the parts of `Response` the client reads. */
function fakeResponse(status: number, body: string) {
  return { status, ok: status >= 200 && status < 300, text: () => Promise.resolve(body) };
}

/** Decode a JWT's header + payload (no verification needed — we only assert the claims we set). */
function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [header, payload] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(header!, "base64url").toString()),
    payload: JSON.parse(Buffer.from(payload!, "base64url").toString()),
  };
}

const fetchMock = vi.fn();
let client: AppStoreConnectClient;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  client = new AppStoreConnectClient(makeKey());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppStoreConnectClient — auth + request building", () => {
  it("signs each request with a short-lived ES256 JWT bound to the key", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [{ id: "42", attributes: {} }] })));

    const id = await client.getAppId("com.example.hello");

    expect(id).toBe("42");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/apps?filter[bundleId]=com.example.hello&limit=1");
    const auth = (init.headers as Record<string, string>)["Authorization"]!;
    expect(auth).toMatch(/^Bearer /);
    const { header, payload } = decodeJwt(auth.slice("Bearer ".length));
    expect(header).toMatchObject({ alg: "ES256", kid: "KEY123", typ: "JWT" });
    expect(payload["iss"]).toBe("issuer-uuid");
    expect(payload["aud"]).toBe("appstoreconnect-v1");
    // Apple rejects tokens older than 20 minutes; the client stays at 19.
    expect((payload["exp"] as number) - (payload["iat"] as number)).toBe(19 * 60);
  });

  it("returns null when no app record exists for the bundle id", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.getAppId("com.example.missing")).toBeNull();
  });

  it("authenticates only with a Bearer API-key JWT — never a password or session cookie (the EAS 2FA dodge)", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    await client.assertReady();
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    // Bearer <JWT> (JWTs start `eyJ`) — Apple-ID 2FA can't enter the loop, so EAS's 2FA failures can't either.
    expect(headers["Authorization"]).toMatch(/^Bearer eyJ/);
    expect(headers["Cookie"]).toBeUndefined();
  });

  it("resolves the app id then the latest build number", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [{ id: "app1", attributes: {} }] })))
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [{ id: "b", attributes: { version: "7" } }] })));

    expect(await client.getLatestBuildNumber("com.example.hello")).toBe(7);
    expect(fetchMock.mock.calls[1]![0]).toContain("/builds?filter[app]=app1");
  });

  it("reports zero builds when the app record is missing", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.getLatestBuildNumber("com.example.missing")).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("folds App Store + TestFlight versions and picks the highest numerically", async () => {
    // Route by URL, not call order: getLatestMarketingVersion fires the App Store + TestFlight
    // lookups through Promise.all, so which fetch lands first is a race (each awaits JWT signing).
    // Keying the mock on the path keeps the test deterministic regardless of dispatch order.
    fetchMock.mockImplementation((url: string | URL) => {
      const path = String(url);
      if (path.includes("/appStoreVersions"))
        return Promise.resolve(
          fakeResponse(200, JSON.stringify({ data: [{ id: "v1", attributes: { versionString: "1.9.0" } }] })),
        );
      if (path.includes("/preReleaseVersions"))
        return Promise.resolve(
          fakeResponse(200, JSON.stringify({ data: [{ id: "p1", attributes: { version: "1.10.0" } }] })),
        );
      return Promise.resolve(fakeResponse(200, JSON.stringify({ data: [{ id: "app1", attributes: {} }] })));
    });

    // 1.10.0 (TestFlight) beats 1.9.0 (App Store) — a lexical sort would wrongly pick 1.9.0.
    expect(await client.getLatestMarketingVersion("com.example.hello")).toBe("1.10.0");
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((path) => path.includes("/apps/app1/appStoreVersions"))).toBe(true);
    expect(urls.some((path) => path.includes("/apps/app1/preReleaseVersions"))).toBe(true);
  });

  it("returns null for marketing version when the app record is missing", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.getLatestMarketingVersion("com.example.missing")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the app exists but has no versions yet", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [{ id: "app1", attributes: {} }] })))
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })))
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.getLatestMarketingVersion("com.example.hello")).toBeNull();
  });

  it("surfaces Apple's error detail (not a bare status) on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        403,
        JSON.stringify({
          errors: [{ status: "403", code: "X", title: "Forbidden", detail: "A required agreement is missing." }],
        }),
      ),
    );
    await expect(client.assertReady()).rejects.toThrow(/403.*A required agreement is missing\./);
  });

  it("POSTs a correctly-shaped bundle-id registration with a JSON content type", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: "b1", attributes: { identifier: "com.x", seedId: "SEED" } } })),
    );

    const created = await client.createBundleId("com.x", "X App");

    expect(created).toEqual({ id: "b1", identifier: "com.x", seedId: "SEED" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toMatchObject({
      data: { type: "bundleIds", attributes: { identifier: "com.x", name: "X App", platform: "IOS" } },
    });
  });

  it("resolves the Team ID from the first bundle id's seedId", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: [{ id: "b1", attributes: { seedId: "5NS9ZUMYCS" } }] })),
    );
    expect(await client.resolveTeamId()).toBe("5NS9ZUMYCS");
    expect(fetchMock.mock.calls[0]![0]).toContain("/bundleIds?limit=1&fields[bundleIds]=seedId");
  });

  it("returns null for the Team ID when the account has no bundle ids yet", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.resolveTeamId()).toBeNull();
  });

  it("lists accessible app names, dropping any without a name", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [{ attributes: { name: "Pomedero" } }, { attributes: {} }, { attributes: { name: "Looopi" } }],
        }),
      ),
    );
    expect(await client.listAppNames()).toEqual(["Pomedero", "Looopi"]);
    expect(fetchMock.mock.calls[0]![0]).toContain("/apps?fields[apps]=name");
  });

  it("treats a 204 as success with no body (profile deletion)", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ""));
    await expect(client.deleteProfile("p1")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("DELETE");
    expect(url).toContain("/profiles/p1");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });
});

describe("AppStoreConnectClient — pagination (links.next)", () => {
  it("follows the absolute links.next URL verbatim, without the /v1/v1 double-prefix", async () => {
    const page2Url = "https://api.appstoreconnect.apple.com/v1/devices?cursor=PAGE2";
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: "d1", attributes: { udid: "AAAA", name: "Phone A", status: "ENABLED" } }],
            links: { next: page2Url },
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: "d2", attributes: { udid: "BBBB", name: "Phone B" } }] })),
      );

    const devices = await client.listDevices();

    // Both pages folded into one list — reading only page 1 would silently truncate the team.
    expect(devices.map((d) => d.udid)).toEqual(["AAAA", "BBBB"]);
    // The crux of the #3764 regression: the second request hits the absolute next URL exactly,
    // NOT https://…/v1/v1/devices?… (which is what re-prefixing BASE_URL would produce).
    expect(String(fetchMock.mock.calls[1]![0])).toBe(page2Url);
    expect(String(fetchMock.mock.calls[1]![0])).not.toContain("/v1/v1");
  });

  it("stops after one page when there is no links.next", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: [{ id: "d1", attributes: { udid: "AAAA", name: "Phone A" } }] })),
    );
    expect(await client.listDevices()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("AppStoreConnectClient — device registration + ad-hoc profile", () => {
  it("finds a registered device by UDID case-insensitively", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: [{ id: "d1", attributes: { udid: "abcd1234", name: "Phone" } }] })),
    );
    const found = await client.findDeviceByUdid("ABCD1234");
    expect(found?.id).toBe("d1");
  });

  it("POSTs a correctly-shaped device registration", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: "d9", attributes: { udid: "UDID9", name: "Dana's iPhone" } } })),
    );
    const created = await client.registerDevice("UDID9", "Dana's iPhone");
    expect(created).toMatchObject({ id: "d9", udid: "UDID9", name: "Dana's iPhone" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      data: { type: "devices", attributes: { udid: "UDID9", name: "Dana's iPhone", platform: "IOS" } },
    });
  });

  it("creates an ad-hoc profile linking the bundle, cert, and every listed device", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({ data: { id: "pf1", attributes: { name: "AdHoc", uuid: "U", profileContent: "B64" } } }),
      ),
    );
    const profile = await client.createAdHocProfile("AdHoc", "bundle1", "cert1", ["d1", "d2"]);
    expect(profile).toEqual({ id: "pf1", name: "AdHoc", uuid: "U", profileContent: "B64" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.data.attributes.profileType).toBe("IOS_APP_ADHOC");
    expect(body.data.relationships.devices.data).toEqual([
      { type: "devices", id: "d1" },
      { type: "devices", id: "d2" },
    ]);
  });
});

describe("describeErrors", () => {
  it("joins Apple's error details, falling back to titles", () => {
    expect(describeErrors(JSON.stringify({ errors: [{ detail: "d1" }, { title: "t2" }] }))).toBe("d1; t2");
  });

  it("returns the raw body when it isn't JSON, and a placeholder when empty", () => {
    expect(describeErrors("plain text failure")).toBe("plain text failure");
    expect(describeErrors("")).toBe("no response body");
  });
});
