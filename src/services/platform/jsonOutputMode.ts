let jsonOutput = false;

/** Set by the CLI's `--json` flag - keeps child tools off stdout so it carries only NDJSON events. */
export const setJsonOutput = (enabled: boolean): void => {
  jsonOutput = enabled;
};

export const isJsonOutput = (): boolean => jsonOutput;
