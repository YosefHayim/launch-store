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

/** Stand-in for a binary (gzip) response: the report/segment paths read `arrayBuffer`, errors read `text`. */
function fakeBinaryResponse(status: number, bytes: string, errorBody = "") {
  // TextEncoder yields a Uint8Array whose buffer is exactly the bytes — Buffer.from(str).buffer would
  // expose Node's shared allocation pool, so arrayBuffer() must return this precisely-sized slice.
  return {
    status,
    ok: status >= 200 && status < 300,
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(bytes).buffer),
    text: () => Promise.resolve(errorBody),
  };
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

describe("AppStoreConnectClient — transient-failure retry", () => {
  it("retries a 429 then succeeds, surfacing the eventual result", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(429, JSON.stringify({ errors: [{ title: "Rate limited" }] })))
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [{ id: "42", attributes: {} }] })));
    expect(await client.getAppId("com.example.hello")).toBe("42");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 4xx (a permanent failure surfaces immediately)", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(403, JSON.stringify({ errors: [{ detail: "Forbidden" }] })));
    await expect(client.assertReady()).rejects.toThrow(/403.*Forbidden/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("AppStoreConnectClient — product catalog", () => {
  it("enables a capability with the bundleId relationship", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: "cap1", attributes: { capabilityType: "PUSH_NOTIFICATIONS" } } })),
    );
    const created = await client.enableCapability("bundle1", "PUSH_NOTIFICATIONS");
    expect(created).toEqual({ id: "cap1", capabilityType: "PUSH_NOTIFICATIONS" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/bundleIdCapabilities");
    expect(JSON.parse(init.body as string)).toMatchObject({
      data: {
        type: "bundleIdCapabilities",
        attributes: { capabilityType: "PUSH_NOTIFICATIONS" },
        relationships: { bundleId: { data: { type: "bundleIds", id: "bundle1" } } },
      },
    });
  });

  it("creates an in-app purchase against the /v2 endpoint with the app relationship", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: {
            id: "iap1",
            attributes: { productId: "com.x.coins", name: "Coins", inAppPurchaseType: "CONSUMABLE" },
          },
        }),
      ),
    );
    const created = await client.createInAppPurchase("app1", {
      productId: "com.x.coins",
      name: "Coins",
      inAppPurchaseType: "CONSUMABLE",
    });
    expect(created).toMatchObject({ id: "iap1", productId: "com.x.coins", inAppPurchaseType: "CONSUMABLE" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.appstoreconnect.apple.com/v2/inAppPurchases");
    expect(JSON.parse(init.body as string)).toMatchObject({
      data: {
        type: "inAppPurchases",
        attributes: { productId: "com.x.coins", name: "Coins", inAppPurchaseType: "CONSUMABLE" },
        relationships: { app: { data: { type: "apps", id: "app1" } } },
      },
    });
  });

  it("creates a subscription with its billing period and group relationship", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: "sub1", attributes: { productId: "com.x.pro", name: "Pro" } } })),
    );
    await client.createSubscription("group1", {
      productId: "com.x.pro",
      name: "Pro Monthly",
      subscriptionPeriod: "ONE_MONTH",
      groupLevel: 1,
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.data.type).toBe("subscriptions");
    expect(body.data.attributes).toMatchObject({ subscriptionPeriod: "ONE_MONTH", groupLevel: 1 });
    expect(body.data.relationships.group.data).toEqual({ type: "subscriptionGroups", id: "group1" });
  });

  it("creates a subscription localization through the shared helper with the right parent relationship", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: "loc1", attributes: { locale: "en-US", name: "Pro" } } })),
    );
    await client.createSubscriptionLocalization("sub1", { locale: "en-US", name: "Pro", description: "All features" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/subscriptionLocalizations");
    expect(JSON.parse(init.body as string)).toMatchObject({
      data: {
        type: "subscriptionLocalizations",
        attributes: { locale: "en-US", name: "Pro", description: "All features" },
        relationships: { subscription: { data: { type: "subscriptions", id: "sub1" } } },
      },
    });
  });

  it("omits description on a group localization (groups carry a name only)", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: "gl1", attributes: { locale: "en-US", name: "Pro Tiers" } } })),
    );
    await client.createSubscriptionGroupLocalization("group1", { locale: "en-US", name: "Pro Tiers" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.data.attributes).toEqual({ locale: "en-US", name: "Pro Tiers" });
    expect(body.data.attributes).not.toHaveProperty("description");
  });

  it("resolves a subscription price point by exact customer price", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: "pp1", attributes: { customerPrice: "4.99", territory: "USA" } },
            { id: "pp2", attributes: { customerPrice: "9.99", territory: "USA" } },
          ],
        }),
      ),
    );
    const point = await client.findSubscriptionPricePoint("sub1", "USA", 9.99);
    expect(point).toEqual({ id: "pp2", customerPrice: "9.99", territory: "USA" });
    expect(fetchMock.mock.calls[0]![0]).toContain("/subscriptions/sub1/pricePoints?filter[territory]=USA");
  });

  it("returns null when no price point matches the requested amount", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: [{ id: "pp1", attributes: { customerPrice: "4.99", territory: "USA" } }] }),
      ),
    );
    expect(await client.findSubscriptionPricePoint("sub1", "USA", 9.99)).toBeNull();
  });

  it("sets a subscription price by linking the resolved price point", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(201, JSON.stringify({ data: { id: "spr1", attributes: {} } })));
    await client.createSubscriptionPrice("sub1", "pp2");
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.data.type).toBe("subscriptionPrices");
    expect(body.data.relationships).toMatchObject({
      subscription: { data: { type: "subscriptions", id: "sub1" } },
      subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: "pp2" } },
    });
  });

  it("builds an IAP price schedule with a base territory and a temp-id included price", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(201, JSON.stringify({ data: { id: "sched1", attributes: {} } })));
    await client.createInAppPurchasePriceSchedule("iap1", "USA", "pp9");
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.data.type).toBe("inAppPurchasePriceSchedules");
    expect(body.data.relationships.baseTerritory.data).toEqual({ type: "territories", id: "USA" });
    const tempId = body.data.relationships.manualPrices.data[0].id;
    expect(body.included[0]).toMatchObject({
      type: "inAppPurchasePrices",
      id: tempId,
      relationships: { inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: "pp9" } } },
    });
  });

  it("reports an unpriced in-app purchase when the price-schedule relationship is empty/404", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404, JSON.stringify({ errors: [{ title: "Not Found" }] })));
    expect(await client.inAppPurchaseHasPrice("iap1")).toBe(false);
  });
});

describe("AppStoreConnectClient — export compliance", () => {
  it("resolves a build's id and export-compliance answer by build number", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [{ id: "app1", attributes: {} }] })))
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: "build9", attributes: { usesNonExemptEncryption: false } }] })),
      );

    expect(await client.findBuild("com.example.hello", 9)).toEqual({ id: "build9", usesNonExemptEncryption: false });
    expect(fetchMock.mock.calls[1]![0]).toContain("/builds?filter[app]=app1&filter[version]=9");
  });

  it("reports null usesNonExemptEncryption when the build hasn't answered yet", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [{ id: "app1", attributes: {} }] })))
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [{ id: "build9", attributes: {} }] })));

    expect(await client.findBuild("com.example.hello", 9)).toEqual({ id: "build9", usesNonExemptEncryption: null });
  });

  it("returns null for findBuild when the app record is missing", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.findBuild("com.example.missing", 9)).toBeNull();
  });

  it("PATCHes the build's usesNonExemptEncryption attribute", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: { id: "build9", attributes: {} } })));

    await client.setBuildUsesNonExemptEncryption("build9", false);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/builds/build9");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      data: { type: "builds", id: "build9", attributes: { usesNonExemptEncryption: false } },
    });
  });

  it("lists an app's encryption declarations with their review state", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [{ id: "app1", attributes: {} }] })))
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: "decl1", attributes: { appEncryptionDeclarationState: "APPROVED" } }],
          }),
        ),
      );

    expect(await client.listEncryptionDeclarations("com.example.hello")).toEqual([{ id: "decl1", state: "APPROVED" }]);
  });

  it("links a build to a declaration via the relationships endpoint", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ""));

    await client.linkBuildToDeclaration("decl1", "build9");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/appEncryptionDeclarations/decl1/relationships/builds");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ data: [{ type: "builds", id: "build9" }] });
  });
});

describe("AppStoreConnectClient — listing localizations", () => {
  it("picks the editable App Store version, ignoring a live one", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: "v-live", attributes: { appStoreState: "READY_FOR_SALE" } },
            { id: "v-edit", attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" } },
          ],
        }),
      ),
    );
    expect(await client.getEditableVersionId("app1")).toBe("v-edit");
    expect(fetchMock.mock.calls[0]![0]).toContain("/apps/app1/appStoreVersions");
  });

  it("returns null when no App Store version is editable", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: [{ id: "v-live", attributes: { appStoreState: "READY_FOR_SALE" } }] })),
    );
    expect(await client.getEditableVersionId("app1")).toBeNull();
  });

  it("picks the editable appInfo by state", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: "ai-live", attributes: { state: "READY_FOR_DISTRIBUTION" } },
            { id: "ai-edit", attributes: { state: "PREPARE_FOR_SUBMISSION" } },
          ],
        }),
      ),
    );
    expect(await client.getEditableAppInfoId("app1")).toBe("ai-edit");
  });

  it("lists version localizations, keeping only present non-empty fields", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: "vl1",
              attributes: { locale: "en-US", description: "Copy", keywords: "a,b", whatsNew: null, marketingUrl: "" },
            },
          ],
        }),
      ),
    );
    expect(await client.listVersionLocalizations("v-edit")).toEqual([
      { id: "vl1", locale: "en-US", fields: { description: "Copy", keywords: "a,b" } },
    ]);
  });

  it("POSTs a new version localization with the appStoreVersion relationship", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(201, JSON.stringify({ data: { id: "vl-new", attributes: {} } })));
    await client.createVersionLocalization("v-edit", "fr-FR", { description: "Texte" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/appStoreVersionLocalizations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      data: {
        type: "appStoreVersionLocalizations",
        attributes: { locale: "fr-FR", description: "Texte" },
        relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: "v-edit" } } },
      },
    });
  });

  it("PATCHes only the changed fields on an app-level localization", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: { id: "ail1", attributes: {} } })));
    await client.updateAppInfoLocalization("ail1", { name: "New" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/appInfoLocalizations/ail1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      data: { type: "appInfoLocalizations", id: "ail1", attributes: { name: "New" } },
    });
  });
});

describe("AppStoreConnectClient — TestFlight beta groups + testers", () => {
  it("creates an external beta group with the app relationship", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: "bg1", attributes: { name: "External Testers" } } })),
    );
    const group = await client.createBetaGroup("app1", "External Testers");
    expect(group).toEqual({ id: "bg1", name: "External Testers" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/betaGroups");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      data: {
        type: "betaGroups",
        attributes: { name: "External Testers" },
        relationships: { app: { data: { type: "apps", id: "app1" } } },
      },
    });
  });

  it("lists beta groups, dropping a nameless row and surfacing internal/public-link", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: "bg1", attributes: { name: "External", isInternalGroup: false, publicLink: "https://tf/x" } },
            { id: "bg2", attributes: { name: "Team", isInternalGroup: true } },
            { id: "bg3", attributes: {} },
          ],
        }),
      ),
    );
    expect(await client.listBetaGroups("app1")).toEqual([
      { id: "bg1", name: "External", isInternal: false, publicLink: "https://tf/x" },
      { id: "bg2", name: "Team", isInternal: true },
    ]);
    expect(fetchMock.mock.calls[0]![0]).toContain("/apps/app1/betaGroups");
  });

  it("finds a beta group by name case-insensitively", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: [{ id: "bg1", attributes: { name: "External Testers" } }] })),
    );
    expect((await client.findBetaGroupByName("app1", "external testers"))?.id).toBe("bg1");
  });

  it("creates a tester with the betaGroups relationship (the invite-sending path)", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({ data: { id: "t1", attributes: { email: "a@x.com", firstName: "Dana", state: "INVITED" } } }),
      ),
    );
    const tester = await client.createBetaTester("bg1", { email: "a@x.com", firstName: "Dana" });
    expect(tester).toMatchObject({ id: "t1", email: "a@x.com", firstName: "Dana", state: "INVITED" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/betaTesters");
    expect(JSON.parse(init.body as string)).toMatchObject({
      data: {
        type: "betaTesters",
        attributes: { email: "a@x.com", firstName: "Dana" },
        relationships: { betaGroups: { data: [{ type: "betaGroups", id: "bg1" }] } },
      },
    });
  });

  it("finds a tester by email via the filter, matching case-insensitively", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: [{ id: "t1", attributes: { email: "A@X.com" } }] })),
    );
    expect((await client.findBetaTesterByEmail("a@x.com"))?.id).toBe("t1");
    expect(fetchMock.mock.calls[0]![0]).toContain("/betaTesters?filter[email]=a%40x.com");
  });

  it("bulk-adds existing testers to a group via the relationship endpoint", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ""));
    await client.addTestersToGroup("bg1", ["t1", "t2"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/betaGroups/bg1/relationships/betaTesters");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      data: [
        { type: "betaTesters", id: "t1" },
        { type: "betaTesters", id: "t2" },
      ],
    });
  });

  it("removes testers from a group with a DELETE carrying the relationship body", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ""));
    await client.removeTestersFromGroup("bg1", ["t1"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/betaGroups/bg1/relationships/betaTesters");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({ data: [{ type: "betaTesters", id: "t1" }] });
  });
});

describe("AppStoreConnectClient — customer reviews", () => {
  it("lists reviews with include=response, computing `answered` from the response relationship", async () => {
    const page2 = "https://api.appstoreconnect.apple.com/v1/apps/app1/customerReviews?cursor=P2";
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              {
                id: "r1",
                attributes: { rating: 5, title: "Love it", body: "Great", reviewerNickname: "fan", territory: "USA" },
                relationships: { response: { data: { id: "resp1" } } },
              },
            ],
            links: { next: page2 },
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: "r2", attributes: { rating: 1 }, relationships: { response: { data: null } } }],
          }),
        ),
      );

    const reviews = await client.listCustomerReviews("app1", { rating: 5, territory: "USA" });

    expect(reviews).toEqual([
      {
        id: "r1",
        rating: 5,
        title: "Love it",
        body: "Great",
        reviewerNickname: "fan",
        territory: "USA",
        answered: true,
      },
      { id: "r2", rating: 1, answered: false },
    ]);
    const firstUrl = String(fetchMock.mock.calls[0]![0]);
    expect(firstUrl).toContain("/apps/app1/customerReviews?include=response&sort=-createdDate");
    expect(firstUrl).toContain("filter[rating]=5");
    expect(firstUrl).toContain("filter[territory]=USA");
    // Page 2 follows the absolute cursor verbatim — no /v1/v1 double-prefix.
    expect(String(fetchMock.mock.calls[1]![0])).toBe(page2);
  });

  it("returns null for a review with no developer response (Apple 404s)", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404, JSON.stringify({ errors: [{ title: "Not Found" }] })));
    expect(await client.getCustomerReviewResponse("r1")).toBeNull();
  });

  it("creates/replaces a response with the review relationship", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({ data: { id: "resp1", attributes: { responseBody: "Thanks!", state: "PENDING_PUBLISH" } } }),
      ),
    );
    const response = await client.createCustomerReviewResponse("r1", "Thanks!");
    expect(response).toEqual({ id: "resp1", responseBody: "Thanks!", state: "PENDING_PUBLISH" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/customerReviewResponses");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      data: {
        type: "customerReviewResponses",
        attributes: { responseBody: "Thanks!" },
        relationships: { review: { data: { type: "customerReviews", id: "r1" } } },
      },
    });
  });

  it("deletes a response by id", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ""));
    await client.deleteCustomerReviewResponse("resp1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("DELETE");
    expect(url).toContain("/customerReviewResponses/resp1");
  });
});

describe("AppStoreConnectClient — reports", () => {
  it("downloads a sales report with the right filters and gzip Accept header", async () => {
    fetchMock.mockResolvedValueOnce(fakeBinaryResponse(200, "gzip-bytes"));
    const bytes = await client.getSalesReport({
      vendorNumber: "12345678",
      frequency: "DAILY",
      reportType: "SALES",
      reportSubType: "SUMMARY",
      reportDate: "2026-06-01",
      version: "1_0",
    });
    expect(bytes.toString()).toBe("gzip-bytes");
    const [url, init] = fetchMock.mock.calls[0]!;
    const path = String(url);
    expect(path).toContain("/salesReports?");
    expect(path).toContain("filter[frequency]=DAILY");
    expect(path).toContain("filter[reportType]=SALES");
    expect(path).toContain("filter[reportSubType]=SUMMARY");
    expect(path).toContain("filter[vendorNumber]=12345678");
    expect(path).toContain("filter[reportDate]=2026-06-01");
    expect(path).toContain("filter[version]=1_0");
    expect((init.headers as Record<string, string>)["Accept"]).toBe("application/a-gzip, application/json");
  });

  it("defaults the finance report type to FINANCE_DETAIL", async () => {
    fetchMock.mockResolvedValueOnce(fakeBinaryResponse(200, "fin"));
    await client.getFinanceReport({ vendorNumber: "12345678", reportDate: "2026-05", regionCode: "ZZ" });
    const path = String(fetchMock.mock.calls[0]![0]);
    expect(path).toContain("/financeReports?");
    expect(path).toContain("filter[regionCode]=ZZ");
    expect(path).toContain("filter[reportType]=FINANCE_DETAIL");
  });

  it("surfaces Apple's 'no sales' detail on a report 404", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeBinaryResponse(
        404,
        "",
        JSON.stringify({ errors: [{ detail: "There were no sales for the date specified." }] }),
      ),
    );
    await expect(
      client.getSalesReport({
        vendorNumber: "1",
        frequency: "DAILY",
        reportType: "SALES",
        reportSubType: "SUMMARY",
        reportDate: "2026-06-01",
      }),
    ).rejects.toThrow(/404.*no sales/);
  });

  it("creates an analytics report request with the app relationship", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: "req1", attributes: { accessType: "ONGOING" } } })),
    );
    const request = await client.createAnalyticsReportRequest("app1", "ONGOING");
    expect(request).toEqual({ id: "req1", accessType: "ONGOING" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/analyticsReportRequests");
    expect(JSON.parse(init.body as string)).toMatchObject({
      data: {
        type: "analyticsReportRequests",
        attributes: { accessType: "ONGOING" },
        relationships: { app: { data: { type: "apps", id: "app1" } } },
      },
    });
  });

  it("filters reports by category and instances by granularity/date", async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({ data: [{ id: "rep1", attributes: { name: "App Sessions", category: "APP_USAGE" } }] }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: "inst1", attributes: { granularity: "DAILY", processingDate: "2026-06-01" } }],
          }),
        ),
      );

    const reports = await client.listAnalyticsReports("req1", { category: "APP_USAGE" });
    expect(reports).toEqual([{ id: "rep1", name: "App Sessions", category: "APP_USAGE" }]);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      "/analyticsReportRequests/req1/reports?limit=200&filter[category]=APP_USAGE",
    );

    const instances = await client.listAnalyticsReportInstances("rep1", {
      granularity: "DAILY",
      processingDate: "2026-06-01",
    });
    expect(instances).toEqual([{ id: "inst1", granularity: "DAILY", processingDate: "2026-06-01" }]);
    const instUrl = String(fetchMock.mock.calls[1]![0]);
    expect(instUrl).toContain("/analyticsReports/rep1/instances?limit=200&filter[granularity]=DAILY");
    expect(instUrl).toContain("filter[processingDate]=2026-06-01");
  });

  it("lists segments (dropping any without a url) and downloads one unauthenticated", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: "seg1", attributes: { url: "https://store.example/seg1.gz", checksum: "abc", sizeInBytes: 10 } },
            { id: "seg2", attributes: {} },
          ],
        }),
      ),
    );
    const segments = await client.listAnalyticsReportSegments("inst1");
    expect(segments).toEqual([{ id: "seg1", url: "https://store.example/seg1.gz", checksum: "abc", sizeInBytes: 10 }]);

    fetchMock.mockResolvedValueOnce(fakeBinaryResponse(200, "segment-gzip"));
    const bytes = await client.downloadAnalyticsSegment("https://store.example/seg1.gz");
    expect(bytes.toString()).toBe("segment-gzip");
    // Presigned URL → no init (and therefore no Authorization), so the storage backend doesn't 400 on dual auth.
    expect(fetchMock.mock.calls[1]![1]).toBeUndefined();
  });
});

describe("app-level release attributes", () => {
  it("resolves the editable app info and its current category ids", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: "live", attributes: { state: "READY_FOR_DISTRIBUTION" }, relationships: {} },
            {
              id: "editable",
              attributes: { state: "PREPARE_FOR_SUBMISSION" },
              relationships: {
                primaryCategory: { data: { type: "appCategories", id: "PRODUCTIVITY" } },
                secondaryCategory: { data: { type: "appCategories", id: "BUSINESS" } },
              },
            },
          ],
        }),
      ),
    );
    const info = await client.getAppInfo("app1");
    expect(fetchMock.mock.calls[0]![0]).toContain("/apps/app1/appInfos?include=primaryCategory,secondaryCategory");
    expect(info).toEqual({
      id: "editable",
      state: "PREPARE_FOR_SUBMISSION",
      primaryCategoryId: "PRODUCTIVITY",
      secondaryCategoryId: "BUSINESS",
    });
  });

  it("PATCHes only the categories provided, as appCategories relationships", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: { id: "editable", attributes: {} } })));
    await client.updateAppInfoCategories("editable", { primaryCategoryId: "GAMES" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("PATCH");
    expect(url).toContain("/appInfos/editable");
    const body = JSON.parse(init.body as string);
    expect(body.data.relationships.primaryCategory.data).toEqual({ type: "appCategories", id: "GAMES" });
    expect(body.data.relationships.secondaryCategory).toBeUndefined();
  });

  it("reads an age-rating declaration and treats a 404 as none", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: { id: "age1", attributes: { violenceCartoonOrFantasy: "NONE" } } })),
    );
    expect(await client.getAgeRatingDeclaration("editable")).toEqual({
      id: "age1",
      attributes: { violenceCartoonOrFantasy: "NONE" },
    });
    fetchMock.mockResolvedValueOnce(fakeResponse(404, JSON.stringify({ errors: [{ title: "Not Found" }] })));
    expect(await client.getAgeRatingDeclaration("editable")).toBeNull();
  });

  it("PATCHes age-rating answers verbatim", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: { id: "age1", attributes: {} } })));
    await client.updateAgeRatingDeclaration("age1", { gambling: false, violenceRealistic: "INFREQUENT_OR_MILD" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.data).toEqual({
      type: "ageRatingDeclarations",
      id: "age1",
      attributes: { gambling: false, violenceRealistic: "INFREQUENT_OR_MILD" },
    });
  });

  it("matches an app price point by territory and customer price", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: "pp1", attributes: { customerPrice: "4.99", territory: "USA" } },
            { id: "pp2", attributes: { customerPrice: "9.99", territory: "USA" } },
          ],
        }),
      ),
    );
    const point = await client.findAppPricePoint("app1", "USA", 9.99);
    expect(fetchMock.mock.calls[0]![0]).toContain("/apps/app1/appPricePoints?filter[territory]=USA");
    expect(point).toEqual({ id: "pp2", customerPrice: "9.99", territory: "USA" });
  });

  it("reads the open-interval manual app price and skips scheduled future prices", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            // A future scheduled change for USA — must be ignored, not mistaken for the current price.
            {
              attributes: { startDate: "2026-12-01", endDate: null },
              relationships: { appPricePoint: { data: { id: "future" } } },
            },
            // The currently-effective price: open interval (no start, no end).
            {
              attributes: { startDate: null, endDate: null },
              relationships: { appPricePoint: { data: { id: "pp2" } } },
            },
          ],
          included: [
            { type: "appPricePoints", id: "future", attributes: { customerPrice: "12.99", territory: "USA" } },
            { type: "appPricePoints", id: "pp2", attributes: { customerPrice: "9.99", territory: "USA" } },
          ],
        }),
      ),
    );
    expect(await client.getCurrentAppPrice("app1", "USA")).toBe("9.99");
    expect(fetchMock.mock.calls[0]![0]).toContain("/apps/app1/appPriceSchedule/manualPrices?include=appPricePoint");
  });

  it("returns null for the current app price when the schedule is absent (404)", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404, JSON.stringify({ errors: [{ title: "Not Found" }] })));
    expect(await client.getCurrentAppPrice("app1", "USA")).toBeNull();
  });

  it("builds an app price schedule with a base territory and a temp-id included price", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(201, JSON.stringify({ data: { id: "sched1", attributes: {} } })));
    await client.createAppPriceSchedule("app1", "USA", "pp2");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/appPriceSchedules");
    const body = JSON.parse(init.body as string);
    expect(body.data.type).toBe("appPriceSchedules");
    expect(body.data.relationships.app.data).toEqual({ type: "apps", id: "app1" });
    expect(body.data.relationships.baseTerritory.data).toEqual({ type: "territories", id: "USA" });
    const tempId = body.data.relationships.manualPrices.data[0].id;
    expect(body.included[0]).toMatchObject({
      type: "appPrices",
      id: tempId,
      relationships: { appPricePoint: { data: { type: "appPricePoints", id: "pp2" } } },
    });
  });

  it("finds the editable App Store version and skips frozen ones", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: "v-live", attributes: { appVersionState: "READY_FOR_DISTRIBUTION" } },
            { id: "v-edit", attributes: { appVersionState: "PREPARE_FOR_SUBMISSION" } },
          ],
        }),
      ),
    );
    expect(await client.findEditableAppStoreVersion("app1", "IOS")).toEqual({ id: "v-edit" });
    expect(fetchMock.mock.calls[0]![0]).toContain("/apps/app1/appStoreVersions?filter[platform]=IOS");
  });

  it("returns null when no App Store version is editable", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: [{ id: "v-live", attributes: { appVersionState: "REPLACED_WITH_NEW_VERSION" } }] }),
      ),
    );
    expect(await client.findEditableAppStoreVersion("app1", "IOS")).toBeNull();
  });

  it("reads review details, creates them with the version relationship, and patches updates", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: { id: "rd1", attributes: { contactEmail: "a@b.co" } } })),
    );
    expect(await client.getAppStoreReviewDetail("v-edit")).toEqual({
      id: "rd1",
      attributes: { contactEmail: "a@b.co" },
    });

    fetchMock.mockResolvedValueOnce(fakeResponse(201, JSON.stringify({ data: { id: "rd2", attributes: {} } })));
    const created = await client.createAppStoreReviewDetail("v-edit", {
      contactEmail: "a@b.co",
      demoAccountRequired: false,
    });
    expect(created).toEqual({ id: "rd2" });
    const createBody = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(createBody.data.relationships.appStoreVersion.data).toEqual({ type: "appStoreVersions", id: "v-edit" });
    expect(createBody.data.attributes).toEqual({ contactEmail: "a@b.co", demoAccountRequired: false });

    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: { id: "rd2", attributes: {} } })));
    await client.updateAppStoreReviewDetail("rd2", { notes: "use the QR code" });
    const [patchUrl, patchInit] = fetchMock.mock.calls[2]!;
    expect(patchInit.method).toBe("PATCH");
    expect(patchUrl).toContain("/appStoreReviewDetails/rd2");
  });

  it("returns null review details on a 404", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404, JSON.stringify({ errors: [{ title: "Not Found" }] })));
    expect(await client.getAppStoreReviewDetail("v-edit")).toBeNull();
  });
});

describe("App Clips", () => {
  it("lists default experiences with the version each releases with (from the relationship)", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: "exp-1",
              attributes: { action: "OPEN" },
              relationships: { releaseWithAppStoreVersion: { data: { type: "appStoreVersions", id: "ver-1" } } },
            },
            { id: "exp-2", attributes: {}, relationships: {} },
          ],
        }),
      ),
    );
    const experiences = await client.listAppClipDefaultExperiences("clip-1");
    expect(fetchMock.mock.calls[0]![0]).toContain("/appClips/clip-1/appClipDefaultExperiences");
    expect(fetchMock.mock.calls[0]![0]).toContain("include=releaseWithAppStoreVersion");
    expect(experiences).toEqual([{ id: "exp-1", action: "OPEN", versionId: "ver-1" }, { id: "exp-2" }]);
  });

  it("creates a default experience with the appClip + version relationships and the action", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(201, JSON.stringify({ data: { id: "exp-new", attributes: {} } })));
    const created = await client.createAppClipDefaultExperience("clip-1", "ver-1", "VIEW");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect(url).toContain("/appClipDefaultExperiences");
    const body = JSON.parse(init.body as string);
    expect(body.data.attributes.action).toBe("VIEW");
    expect(body.data.relationships.appClip.data).toEqual({ type: "appClips", id: "clip-1" });
    expect(body.data.relationships.releaseWithAppStoreVersion.data).toEqual({ type: "appStoreVersions", id: "ver-1" });
    expect(created).toEqual({ id: "exp-new" });
  });

  it("omits the attributes block when no action is given on create", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(201, JSON.stringify({ data: { id: "exp-new", attributes: {} } })));
    await client.createAppClipDefaultExperience("clip-1", "ver-1");
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.data.attributes).toBeUndefined();
  });

  it("creates a card localization with locale + subtitle under the experience", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(201, JSON.stringify({ data: { id: "loc-new", attributes: {} } })));
    await client.createAppClipDefaultExperienceLocalization("exp-1", "en-US", "Order now");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/appClipDefaultExperienceLocalizations");
    const body = JSON.parse(init.body as string);
    expect(body.data.attributes).toEqual({ locale: "en-US", subtitle: "Order now" });
    expect(body.data.relationships.appClipDefaultExperience.data).toEqual({
      type: "appClipDefaultExperiences",
      id: "exp-1",
    });
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

describe("AppStoreConnectClient — App Store release lifecycle", () => {
  it("lists recent builds with processing state and expiry, newest upload first", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [{ id: "b1", attributes: { version: "42", processingState: "VALID", expired: false } }],
        }),
      ),
    );
    const builds = await client.listBuilds("app1");
    expect(builds[0]).toEqual({ id: "b1", version: "42", processingState: "VALID", expired: false });
    expect(fetchMock.mock.calls[0]![0]).toContain("/builds?filter[app]=app1&sort=-uploadedDate");
  });

  it("declares export compliance with a PATCH to the build", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ""));
    await client.setBuildUsesNonExemptEncryption("b1", false);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("PATCH");
    expect(url).toContain("/builds/b1");
    expect(JSON.parse(init.body as string)).toMatchObject({
      data: { type: "builds", id: "b1", attributes: { usesNonExemptEncryption: false } },
    });
  });

  it("creates an App Store version with the app relationship and release type", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: "v1", attributes: { versionString: "1.2.0", appStoreState: "PREPARE_FOR_SUBMISSION" } },
        }),
      ),
    );
    const version = await client.createAppStoreVersion("app1", {
      versionString: "1.2.0",
      platform: "IOS",
      releaseType: "AFTER_APPROVAL",
    });
    expect(version).toMatchObject({ id: "v1", versionString: "1.2.0", appStoreState: "PREPARE_FOR_SUBMISSION" });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toMatchObject({
      data: {
        type: "appStoreVersions",
        attributes: { platform: "IOS", versionString: "1.2.0", releaseType: "AFTER_APPROVAL" },
        relationships: { app: { data: { type: "apps", id: "app1" } } },
      },
    });
  });

  it("attaches a build via the relationships/build PATCH", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ""));
    await client.selectBuildForVersion("v1", "b1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("PATCH");
    expect(url).toContain("/appStoreVersions/v1/relationships/build");
    expect(JSON.parse(init.body as string)).toEqual({ data: { type: "builds", id: "b1" } });
  });

  it("opens a review submission, adds the version as an item, and submits it", async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(201, JSON.stringify({ data: { id: "rs1", attributes: { state: "READY_FOR_REVIEW" } } })),
      )
      .mockResolvedValueOnce(fakeResponse(201, JSON.stringify({ data: { id: "item1", attributes: {} } })))
      .mockResolvedValueOnce(fakeResponse(204, ""));

    const submission = await client.createReviewSubmission("app1", "IOS");
    expect(submission).toEqual({ id: "rs1", state: "READY_FOR_REVIEW" });
    await client.addReviewSubmissionItem("rs1", "v1");
    await client.submitReviewSubmission("rs1");

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toMatchObject({
      data: {
        type: "reviewSubmissions",
        attributes: { platform: "IOS" },
        relationships: { app: { data: { id: "app1" } } },
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toMatchObject({
      data: {
        type: "reviewSubmissionItems",
        relationships: { reviewSubmission: { data: { id: "rs1" } }, appStoreVersion: { data: { id: "v1" } } },
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body as string)).toMatchObject({
      data: { type: "reviewSubmissions", id: "rs1", attributes: { submitted: true } },
    });
  });

  it("returns null for a phased release that doesn't exist (404 or empty relationship)", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404, JSON.stringify({ errors: [{ title: "Not Found" }] })));
    expect(await client.getPhasedRelease("v1")).toBeNull();

    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: null })));
    expect(await client.getPhasedRelease("v2")).toBeNull();
  });

  it("steers a phased release with a state PATCH", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ""));
    await client.updatePhasedRelease("ph1", "PAUSE");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("PATCH");
    expect(url).toContain("/appStoreVersionPhasedReleases/ph1");
    expect(JSON.parse(init.body as string)).toMatchObject({
      data: { type: "appStoreVersionPhasedReleases", id: "ph1", attributes: { phasedReleaseState: "PAUSE" } },
    });
  });
});
