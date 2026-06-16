import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { registerStoreCommand } from "./storeDoctor.js";

describe("registerStoreCommand", () => {
  it("attaches a `store` group with a `doctor` subcommand and its options", () => {
    const program = new Command();
    registerStoreCommand(program);

    const store = program.commands.find((command) => command.name() === "store");
    expect(store).toBeDefined();

    const doctor = store?.commands.find((command) => command.name() === "doctor");
    expect(doctor).toBeDefined();

    const options = doctor?.options.map((option) => option.long);
    expect(options).toContain("--app");
    expect(options).toContain("--json");
  });
});
