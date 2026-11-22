interface CommandOption {
  readonly flags: string;
  readonly short?: string;
  readonly long?: string;
  readonly description: string;
  readonly defaultValue?: unknown;
  readonly required: boolean;
}

interface CommandArgument {
  name(): string;
  readonly required: boolean;
  readonly defaultValue?: unknown;
  readonly variadic: boolean;
  readonly hasDefault: boolean;
  readonly label: string;
}

interface CommandHelp {
  visibleCommands(command: Command): Command[];
}

interface CommandSettings {
  hidden?: boolean;
}

interface OptionMeta {
  attribute: string;
  takesValue: 'none' | 'required' | 'optional';
  isNegated: boolean;
  reducer: ((flagText: string, previous: unknown) => unknown) | null;
}

interface ParsedFlag {
  option: CommandOption;
  inlineValue: string | null;
}

// A method stays bivariant, so each command's own callback still fits this slot.
interface CommandListenerHost {
  run(...listenerArguments: unknown[]): unknown;
}

type CommandListener = CommandListenerHost['run'];

export function isUsageError(error: unknown): error is Error & { exitCode: number } {
  const isError = error instanceof Error;

  if (isError == false) {
    return false;
  }

  const isUsageName = error.name == 'UsageError';

  if (isUsageName == false) {
    return false;
  }

  const exitCode = Reflect.get(error, 'exitCode');

  return typeof exitCode == 'number';
}

function usageError(message: string, exitCode: number): Error {
  const error = new Error(message);

  error.name = 'UsageError';
  Object.assign(error, { exitCode });

  return error;
}

function copyDefaults(defaults: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const copied: Record<string, unknown> = {};

  for (const key of Object.keys(defaults)) {
    const stored = defaults[key];
    const isList = Array.isArray(stored);

    if (isList) {
      copied[key] = [...stored];
      continue;
    }

    copied[key] = stored;
  }

  return copied;
}

function attributeName(longFlag: string, isNegated: boolean): string {
  let words = longFlag.slice(2);

  if (isNegated) {
    words = words.slice('no-'.length);
  }

  const parts = words.split('-');
  let name = parts[0] ?? '';

  for (const part of parts.slice(1)) {
    name += part.charAt(0).toUpperCase() + part.slice(1);
  }

  return name;
}

function readArgumentSpec(
  spec: string,
  defaultValue: unknown,
  hasDefault: boolean,
): CommandArgument {
  const isRequired = spec.startsWith('<');
  const isVariadic = spec.endsWith('...');
  let labelBody = spec.slice(1, -1);

  if (isVariadic) {
    labelBody = labelBody.slice(0, -3);
  }

  const argument: CommandArgument = {
    name() {
      return labelBody;
    },
    required: isRequired,
    variadic: isVariadic,
    hasDefault,
    label: spec,
  };

  if (hasDefault) {
    return { ...argument, defaultValue };
  }

  return argument;
}

function canDescend(child: Command | null, positionalCount: number): child is Command {
  if (child == null) {
    return false;
  }

  if (positionalCount != 0) {
    return false;
  }

  return true;
}

function isOptionToken(token: string, optionsEnded: boolean): boolean {
  if (optionsEnded) {
    return false;
  }

  if (token == '-') {
    return false;
  }

  if (token.startsWith('-') == false) {
    return false;
  }

  return true;
}

function looksLikeOption(token: string): boolean {
  if (token == '-') {
    return false;
  }

  return token.startsWith('-');
}

export class Command {
  readonly commands: Command[] = [];
  readonly options: CommandOption[] = [];
  readonly registeredArguments: CommandArgument[] = [];
  parent: Command | null = null;
  private commandName = '';
  private commandDescription = '';
  private isHidden = false;
  private launchVersion: string | null = null;
  private listener: CommandListener | null = null;
  private readonly optionMeta = new Map<CommandOption, OptionMeta>();
  private defaultValues: Record<string, unknown> = {};
  private optionValues: Record<string, unknown> = {};
  private explicitKeys = new Set<string>();
  private readonly aliasNames: string[] = [];

  name(commandName: string): this;
  name(): string;
  name(commandName?: string): this | string {
    if (commandName == null) {
      return this.commandName;
    }

    this.commandName = commandName;

    return this;
  }

  description(text: string): this;
  description(): string;
  description(text?: string): this | string {
    if (text == null) {
      return this.commandDescription;
    }

    this.commandDescription = text;

    return this;
  }

  version(launchVersion: string): this;
  version(): string;
  version(launchVersion?: string): this | string {
    if (launchVersion == null) {
      return this.readVersion();
    }

    this.launchVersion = launchVersion;
    this.addVersionOption();

    return this;
  }

  alias(aliasName: string): this {
    this.aliasNames.push(aliasName);

    return this;
  }

  aliases(): string[] {
    return [...this.aliasNames];
  }

  command(spec: string, settings?: CommandSettings): Command {
    const child = new Command();
    // Splits "name <required> [optional]" on spaces.
    const tokens = spec.trim().split(/\s+/);
    const childName = tokens[0];

    if (childName == null) {
      return child;
    }

    child.name(childName);
    child.parent = this;

    if (settings?.hidden == true) {
      child.isHidden = true;
    }

    for (const argumentSpec of tokens.slice(1)) {
      child.registeredArguments.push(readArgumentSpec(argumentSpec, undefined, false));
    }

    this.commands.push(child);

    return child;
  }

  argument(spec: string, _description?: string, defaultValue?: unknown): this {
    const hasDefault = arguments.length >= 3;

    this.registeredArguments.push(readArgumentSpec(spec, defaultValue, hasDefault));

    return this;
  }

  option(
    flags: string,
    description?: string,
    defaultOrReducer?: unknown,
    reducerDefault?: unknown,
  ): this {
    this.addOption(flags, description ?? '', defaultOrReducer, reducerDefault, false);

    return this;
  }

  requiredOption(flags: string, description?: string): this {
    this.addOption(flags, description ?? '', undefined, undefined, true);

    return this;
  }

  action(listener: CommandListener): this {
    this.listener = listener;

    return this;
  }

  exitOverride(): this {
    return this;
  }

  opts<Flags extends Record<string, unknown> = Record<string, unknown>>(): Flags {
    return this.optionValues as Flags;
  }

  optsWithGlobals<Flags extends Record<string, unknown> = Record<string, unknown>>(): Flags {
    return this.mergeGlobalOptions() as Flags;
  }

  getOptionValueSource(attribute: string): 'cli' | 'default' | undefined {
    const wasTyped = this.explicitKeys.has(attribute);

    if (wasTyped) {
      return 'cli';
    }

    const hasDefault = Object.hasOwn(this.defaultValues, attribute);

    if (hasDefault) {
      return 'default';
    }

    return undefined;
  }

  createHelp(): CommandHelp {
    return {
      visibleCommands(command: Command): Command[] {
        return command.visibleSubcommands();
      },
    };
  }

  outputHelp(): void {
    process.stdout.write(this.helpText());
  }

  help(): never {
    this.outputHelp();

    throw usageError('(outputHelp)', 0);
  }

  async parseAsync(argv: readonly string[]): Promise<this> {
    await this.parseTokens(argv.slice(2));

    return this;
  }

  private visibleSubcommands(): Command[] {
    return this.commands.filter(function isShown(command: Command): boolean {
      return command.isHidden == false;
    });
  }

  private readVersion(): string {
    if (this.launchVersion != null) {
      return this.launchVersion;
    }

    if (this.parent == null) {
      return '';
    }

    return this.parent.readVersion();
  }

  private findVersionCommand(): Command | null {
    if (this.launchVersion != null) {
      return this;
    }

    if (this.parent == null) {
      return null;
    }

    return this.parent.findVersionCommand();
  }

  private addVersionOption(): void {
    const alreadyAdded = this.options.some(function hasVersion(option: CommandOption): boolean {
      return option.long == '--version';
    });

    if (alreadyAdded) {
      return;
    }

    const option: CommandOption = {
      flags: '-V, --version',
      short: '-V',
      long: '--version',
      description: 'output the version number',
      required: false,
    };

    this.options.push(option);
    this.optionMeta.set(option, {
      attribute: 'version',
      takesValue: 'none',
      isNegated: false,
      reducer: null,
    });
  }

  private addOption(
    flags: string,
    description: string,
    defaultOrReducer: unknown,
    reducerDefault: unknown,
    required: boolean,
  ): void {
    const parsed = parseFlagDeclaration(flags);
    const option: CommandOption = {
      flags,
      description,
      required,
    };
    const withShort = parsed.short == null ? option : { ...option, short: parsed.short };
    const withLong = parsed.long == null ? withShort : { ...withShort, long: parsed.long };
    const isReducer = typeof defaultOrReducer == 'function';
    let storedDefault: unknown;
    let hasDefault = false;

    if (isReducer) {
      storedDefault = reducerDefault;
      hasDefault = true;
    }

    if (isReducer == false && arguments.length >= 3 && defaultOrReducer !== undefined) {
      storedDefault = defaultOrReducer;
      hasDefault = true;
    }

    if (parsed.isNegated) {
      this.defaultValues[parsed.attribute] = true;
      this.optionValues[parsed.attribute] = true;
    }

    if (hasDefault) {
      this.defaultValues[parsed.attribute] = storedDefault;
      this.optionValues[parsed.attribute] = Array.isArray(storedDefault)
        ? [...storedDefault]
        : storedDefault;
    }

    const published = hasDefault ? { ...withLong, defaultValue: storedDefault } : withLong;

    this.options.push(published);
    this.optionMeta.set(published, {
      attribute: parsed.attribute,
      takesValue: parsed.takesValue,
      isNegated: parsed.isNegated,
      reducer: isReducer
        ? (defaultOrReducer as (flagText: string, previous: unknown) => unknown)
        : null,
    });
  }

  private resetValues(): void {
    this.optionValues = copyDefaults(this.defaultValues);
    this.explicitKeys = new Set();
  }

  private async parseTokens(tokens: string[]): Promise<void> {
    this.resetValues();
    const positionals: string[] = [];
    let index = 0;
    let optionsEnded = false;

    while (index < tokens.length) {
      const token = tokens[index];

      if (token == null) {
        break;
      }

      if (optionsEnded == false && token == '--') {
        optionsEnded = true;
        index += 1;
        continue;
      }

      if (isOptionToken(token, optionsEnded)) {
        index = this.consumeOption(tokens, index);
        continue;
      }

      const child = this.findChild(token);

      if (canDescend(child, positionals.length)) {
        await child.parseTokens(tokens.slice(index + 1));

        return;
      }

      if (this.slotIsOpen(positionals.length)) {
        positionals.push(token);
        index += 1;
        continue;
      }

      const hasSubcommands = this.commands.length > 0;

      if (hasSubcommands) {
        throw usageError(`error: unknown command '${token}'`, 1);
      }

      index += 1;
    }

    await this.finish(positionals);
  }

  private findChild(token: string): Command | null {
    for (const child of this.commands) {
      if (child.name() == token) {
        return child;
      }

      if (child.aliasNames.includes(token)) {
        return child;
      }
    }

    return null;
  }

  private slotIsOpen(positionalCount: number): boolean {
    for (const argument of this.registeredArguments) {
      if (argument.variadic) {
        return true;
      }
    }

    return positionalCount < this.registeredArguments.length;
  }

  private consumeOption(tokens: readonly string[], index: number): number {
    const token = tokens[index];

    if (token == null) {
      return index;
    }

    if (token == '--help' || token == '-h') {
      this.outputHelp();

      throw usageError('(outputHelp)', 0);
    }

    if (token == '--version' || token == '-V') {
      const versionCommand = this.findVersionCommand();

      if (versionCommand != null) {
        const launchVersion = versionCommand.readVersion();

        process.stdout.write(`${launchVersion}\n`);

        throw usageError(launchVersion, 0);
      }
    }

    const parsed = this.parseFlagToken(token);

    if (parsed == null) {
      throw usageError(`error: unknown option '${token}'`, 1);
    }

    const meta = this.optionMeta.get(parsed.option);

    if (meta == null) {
      throw usageError(`error: unknown option '${token}'`, 1);
    }

    if (meta.takesValue == 'none') {
      this.setOption(parsed.option, null);

      return index + 1;
    }

    if (parsed.inlineValue != null) {
      this.setOption(parsed.option, parsed.inlineValue);

      return index + 1;
    }

    const nextToken = tokens[index + 1];

    if (meta.takesValue == 'required') {
      if (nextToken == null) {
        throw usageError(`error: option '${parsed.option.flags}' argument missing`, 1);
      }

      this.setOption(parsed.option, nextToken);

      return index + 2;
    }

    if (nextToken == null || looksLikeOption(nextToken)) {
      this.setOption(parsed.option, null);

      return index + 1;
    }

    this.setOption(parsed.option, nextToken);

    return index + 2;
  }

  private parseFlagToken(token: string): ParsedFlag | null {
    const equalsAt = token.indexOf('=');
    let flag = token;
    let inlineValue: string | null = null;

    if (equalsAt > 0) {
      flag = token.slice(0, equalsAt);
      inlineValue = token.slice(equalsAt + 1);
    }

    const isLong = flag.startsWith('--');

    if (isLong) {
      const option = this.findOption(flag, 'long');

      if (option == null) {
        return null;
      }

      return { option, inlineValue };
    }

    const shortFlag = flag.slice(0, 2);
    const option = this.findOption(shortFlag, 'short');

    if (option == null) {
      return null;
    }

    const meta = this.optionMeta.get(option);
    const attached = flag.slice(2);
    const hasAttached = attached != '' && inlineValue == null;

    if (hasAttached && meta != null && meta.takesValue != 'none') {
      return { option, inlineValue: attached };
    }

    return { option, inlineValue };
  }

  private findOption(flag: string, kind: 'long' | 'short'): CommandOption | null {
    for (const option of this.options) {
      if (kind == 'long' && option.long == flag) {
        return option;
      }

      if (kind == 'short' && option.short == flag) {
        return option;
      }
    }

    return null;
  }

  private setOption(option: CommandOption, flagText: string | null): void {
    const meta = this.optionMeta.get(option);

    if (meta == null) {
      return;
    }

    if (meta.reducer != null && flagText != null) {
      const previous = this.optionValues[meta.attribute];

      this.optionValues[meta.attribute] = meta.reducer(flagText, previous);
      this.explicitKeys.add(meta.attribute);

      return;
    }

    if (meta.isNegated) {
      this.optionValues[meta.attribute] = false;
      this.explicitKeys.add(meta.attribute);

      return;
    }

    if (flagText == null) {
      this.optionValues[meta.attribute] = true;
      this.explicitKeys.add(meta.attribute);

      return;
    }

    this.optionValues[meta.attribute] = flagText;
    this.explicitKeys.add(meta.attribute);
  }

  private async finish(positionals: readonly string[]): Promise<void> {
    this.requireOptions();
    const slotValues = this.readSlotValues(positionals);

    if (this.listener == null) {
      const hasSubcommands = this.commands.length > 0;

      if (hasSubcommands) {
        this.outputHelp();

        throw usageError('(outputHelp)', 1);
      }

      return;
    }

    const listenerResult = this.listener(...slotValues, this.optionValues, this);

    await Promise.resolve(listenerResult);
  }

  private requireOptions(): void {
    for (const option of this.options) {
      if (option.required == false) {
        continue;
      }

      const meta = this.optionMeta.get(option);

      if (meta == null) {
        continue;
      }

      const wasProvided = this.explicitKeys.has(meta.attribute);

      if (wasProvided) {
        continue;
      }

      throw usageError(`error: required option '${option.flags}' not specified`, 1);
    }
  }

  private readSlotValues(positionals: readonly string[]): unknown[] {
    const slotValues: unknown[] = [];
    let index = 0;

    for (const argument of this.registeredArguments) {
      if (argument.variadic) {
        const remaining = positionals.slice(index);
        const isMissing = argument.required && remaining.length == 0;

        if (isMissing) {
          throw usageError(`error: missing required argument '${argument.name()}'`, 1);
        }

        slotValues.push(remaining);
        index = positionals.length;
        continue;
      }

      const positional = positionals[index];

      if (positional == null) {
        if (argument.required) {
          throw usageError(`error: missing required argument '${argument.name()}'`, 1);
        }

        if (argument.hasDefault) {
          slotValues.push(argument.defaultValue);
          continue;
        }

        slotValues.push(undefined);
        continue;
      }

      slotValues.push(positional);
      index += 1;
    }

    return slotValues;
  }

  private mergeGlobalOptions(): Record<string, unknown> {
    const chain: Command[] = [];
    let current: Command | null = this;

    while (current != null) {
      chain.unshift(current);
      current = current.parent;
    }

    const merged: Record<string, unknown> = {};
    const explicit: Record<string, unknown> = {};

    for (const command of chain) {
      Object.assign(merged, command.defaultValues);

      for (const key of command.explicitKeys) {
        explicit[key] = command.optionValues[key];
      }
    }

    Object.assign(merged, explicit);

    return merged;
  }

  private helpText(): string {
    const lines = [this.usageLine()];

    if (this.commandDescription != '') {
      lines.push('');
      lines.push(this.commandDescription);
    }

    if (this.options.length > 0) {
      lines.push('');
      lines.push('Options:');

      for (const option of this.options) {
        lines.push(`  ${option.flags}  ${option.description}`);
      }

      lines.push('  -h, --help  display help for command');
    }

    const shown = this.visibleSubcommands();

    if (shown.length > 0) {
      lines.push('');
      lines.push('Commands:');

      for (const child of shown) {
        lines.push(`  ${child.name()}  ${child.commandDescription}`);
      }
    }

    lines.push('');

    return lines.join('\n');
  }

  private usageLine(): string {
    const names: string[] = [];
    let current: Command | null = this;

    while (current != null) {
      if (current.commandName != '') {
        names.unshift(current.commandName);
      }

      current = current.parent;
    }

    let line = `Usage: ${names.join(' ')} [options]`;

    for (const argument of this.registeredArguments) {
      line += ` ${argument.label}`;
    }

    if (this.commands.length > 0) {
      line += ' [command]';
    }

    return line;
  }
}

interface FlagDeclaration {
  short: string | null;
  long: string | null;
  takesValue: 'none' | 'required' | 'optional';
  isNegated: boolean;
  attribute: string;
}

function isNegatedFlag(long: string | null, takesValue: 'none' | 'required' | 'optional'): boolean {
  if (long == null) {
    return false;
  }

  const isNoFlag = long.startsWith('--no-');

  if (isNoFlag == false) {
    return false;
  }

  return takesValue == 'none';
}

function parseFlagDeclaration(flags: string): FlagDeclaration {
  // Splits "-p, --profile <name>" into the flag tokens and the value marker.
  const tokens = flags.split(/[,\s]+/).filter(function hasText(token: string): boolean {
    return token != '';
  });
  let short: string | null = null;
  let long: string | null = null;
  let takesValue: 'none' | 'required' | 'optional' = 'none';

  for (const token of tokens) {
    if (token.startsWith('--')) {
      long = token;
      continue;
    }

    if (token.startsWith('-')) {
      short = token;
      continue;
    }

    if (token.startsWith('<')) {
      takesValue = 'required';
      continue;
    }

    if (token.startsWith('[')) {
      takesValue = 'optional';
    }
  }

  const isNegated = isNegatedFlag(long, takesValue);
  let attribute = '';

  if (long != null) {
    attribute = attributeName(long, isNegated);
  }

  return { short, long, takesValue, isNegated, attribute };
}
