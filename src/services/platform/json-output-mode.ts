// Remembers a JSON-only run so child programs stay off the stream that carries events.

let jsonOutput = false;

/** Set by the CLI's `--json` flag - keeps child tools off stdout so it carries only NDJSON events. */
export function setJsonOutput(enabled: boolean): void {
  jsonOutput = enabled;
}

export function isJsonOutput(): boolean {
  return jsonOutput;
}
