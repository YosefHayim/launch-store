import { describe, expect, it } from "vitest";
import { listAdopters, registerAdopter, registerBuiltinAdopters } from "./registry.js";
import type { Adopter } from "./types.js";

describe("adopter registry", () => {
  it("registers the four built-in adopters, smallest-blast-radius first", () => {
    registerBuiltinAdopters();
    expect(listAdopters().map((adopter) => adopter.domain)).toEqual(["products", "capabilities", "certs", "listing"]);
  });

  it("replaces an adopter registered under the same domain rather than duplicating it", () => {
    registerBuiltinAdopters();
    const stub: Adopter = { domain: "products", fidelity: "importable", read: () => Promise.resolve([]) };
    registerAdopter(stub);
    const products = listAdopters().filter((adopter) => adopter.domain === "products");
    expect(products).toHaveLength(1);
    expect(products[0]).toBe(stub);
  });
});
