import { describe, expect, it } from "vitest";
import { listSnapshotSources, registerBuiltinSources } from "./registry.js";

describe("snapshot source registry", () => {
  it("registers the four built-in sources", () => {
    registerBuiltinSources();
    const ids = listSnapshotSources()
      .map((source) => source.id)
      .sort();
    expect(ids).toEqual(["apple-products", "apple-subscriptions", "play-products", "play-subscriptions"]);
  });

  it("is idempotent — re-registering keyed by id does not duplicate", () => {
    registerBuiltinSources();
    registerBuiltinSources();
    expect(listSnapshotSources()).toHaveLength(4);
  });
});
