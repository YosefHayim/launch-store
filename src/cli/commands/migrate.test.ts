import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { registerMigrateCommand } from "./migrate.js";

/** Find the `migrate` group's named subcommand, asserting the group exists. */
function subcommand(name: string) {
  const program = new Command();
  registerMigrateCommand(program);
  const migrate = program.commands.find((command) => command.name() === "migrate");
  expect(migrate).toBeDefined();
  return migrate?.commands.find((command) => command.name() === name);
}

describe("registerMigrateCommand", () => {
  it("attaches a `migrate` group with `eas` and `fastlane` subcommands", () => {
    const program = new Command();
    registerMigrateCommand(program);
    const migrate = program.commands.find((command) => command.name() === "migrate");
    expect(migrate?.commands.map((command) => command.name())).toEqual(["eas", "fastlane"]);
  });

  it.each(["eas", "fastlane"])("%s takes --force, --dry-run, and --out", (name) => {
    const options = subcommand(name)?.options.map((option) => option.long);
    expect(options).toContain("--force");
    expect(options).toContain("--dry-run");
    expect(options).toContain("--out");
  });
});
