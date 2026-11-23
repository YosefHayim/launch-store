// Loads a TypeScript module, such as the Launch config, while the program is running.

import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Node 24 ships these two calls. The installed Node 20 type package does not list them.
declare module 'module' {
  namespace Module {
    function registerHooks(hooks: {
      resolve?: (
        specifier: string,
        context: { parentURL?: string },
        nextResolve: (specifier: string, context: { parentURL?: string }) => { url: string },
      ) => { url: string; shortCircuit?: boolean };
      load?: (
        url: string,
        context: { format?: string | null },
        nextLoad: (
          url: string,
          context: { format?: string | null },
        ) => { format: string; source?: string | Uint8Array },
      ) => { format: string; source?: string | Uint8Array; shortCircuit?: boolean };
    }): void;

    function stripTypeScriptTypes(
      code: string,
      options?: { mode?: 'strip' | 'transform'; sourceUrl?: string },
    ): string;
  }
}

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_ROOT = join(packageRoot, 'src');

const sourceAliases: readonly (readonly [string, string])[] = [
  ['@apple/', join(SOURCE_ROOT, 'apple')],
  ['@cli/', join(SOURCE_ROOT, 'cli')],
  ['@google/', join(SOURCE_ROOT, 'google')],
  ['@providers/', join(SOURCE_ROOT, 'providers')],
  ['@testkit/', join(SOURCE_ROOT, 'testkit')],
  ['@/', SOURCE_ROOT],
];

let hooksAreRegistered = false;
let launchStoreEntryUrl = '';

export async function importTypeScriptModule<Exported extends { default?: unknown }>(
  modulePath: string,
  runningEntryPath: string,
): Promise<Exported> {
  launchStoreEntryUrl = runningEntryUrl(runningEntryPath);
  registerLaunchStoreHooks();

  const moduleUrl = pathToFileURL(modulePath).href;
  const importedModule = (await import(moduleUrl)) as Exported;

  return importedModule;
}

function runningEntryUrl(runningEntryPath: string): string {
  if (existsSync(runningEntryPath)) {
    return pathToFileURL(runningEntryPath).href;
  }

  const isJavaScriptEntry = runningEntryPath.endsWith('.js');

  if (isJavaScriptEntry == false) {
    return pathToFileURL(runningEntryPath).href;
  }

  const typescriptPath = `${runningEntryPath.slice(0, -3)}.ts`;

  if (existsSync(typescriptPath)) {
    return pathToFileURL(typescriptPath).href;
  }

  return pathToFileURL(runningEntryPath).href;
}

function registerLaunchStoreHooks(): void {
  if (hooksAreRegistered) {
    return;
  }

  hooksAreRegistered = true;
  keepTypeStripWarningQuiet();
  registerHooks({
    resolve: resolveLaunchStore,
    load: loadLaunchStoreSource,
  });
}

function keepTypeStripWarningQuiet(): void {
  const warningListeners = process.listeners('warning');

  function reportWarning(warning: Error): void {
    const isTypeStrip = isTypeStripWarning(warning);

    if (isTypeStrip) {
      return;
    }

    for (const warningListener of warningListeners) {
      warningListener.call(process, warning);
    }
  }

  process.removeAllListeners('warning');
  process.on('warning', reportWarning);
}

function isTypeStripWarning(warning: Error): boolean {
  const isExperimental = warning.name == 'ExperimentalWarning';

  if (isExperimental == false) {
    return false;
  }

  return warning.message.includes('stripTypeScriptTypes');
}

function resolveLaunchStore(
  specifier: string,
  context: { parentURL?: string },
  nextResolve: (specifier: string, context: { parentURL?: string }) => { url: string },
): { url: string; shortCircuit?: boolean } {
  if (specifier == 'launch-store') {
    return { url: launchStoreEntryUrl, shortCircuit: true };
  }

  const aliasUrl = aliasUrlFor(specifier);

  if (aliasUrl != null) {
    return { url: aliasUrl, shortCircuit: true };
  }

  const siblingUrl = typescriptSiblingUrl(specifier, context.parentURL);

  if (siblingUrl != null) {
    return { url: siblingUrl, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}

function loadLaunchStoreSource(
  url: string,
  context: { format?: string | null },
  nextLoad: (
    url: string,
    context: { format?: string | null },
  ) => { format: string; source?: string | Uint8Array },
): { format: string; source?: string | Uint8Array; shortCircuit?: boolean } {
  const isFile = url.startsWith('file:');
  const isTypeScript = url.endsWith('.ts') || url.endsWith('.tsx');

  if (isFile == false) {
    return nextLoad(url, context);
  }

  if (isTypeScript == false) {
    return nextLoad(url, context);
  }

  const filePath = fileURLToPath(url);
  const isPackageSource = filePath.startsWith(SOURCE_ROOT);

  if (isPackageSource == false) {
    return nextLoad(url, context);
  }

  const sourceText = readFileSync(filePath, 'utf8');
  const javascript = stripTypeScriptTypes(sourceText, { mode: 'transform' });

  return { format: 'module', source: javascript, shortCircuit: true };
}

function aliasUrlFor(specifier: string): string | null {
  for (const [prefix, folder] of sourceAliases) {
    if (specifier.startsWith(prefix) == false) {
      continue;
    }

    const relativePath = specifier.slice(prefix.length);

    const joinedPath = join(folder, relativePath);
    const existingFile = existingSourceFile(joinedPath);

    return pathToFileURL(existingFile).href;
  }

  return null;
}

function typescriptSiblingUrl(specifier: string, parentURL: string | undefined): string | null {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');

  if (isRelative == false) {
    return null;
  }

  if (parentURL == null) {
    return null;
  }

  if (parentURL.startsWith('file:') == false) {
    return null;
  }

  const parentPath = fileURLToPath(parentURL);
  const parentDirectory = dirname(parentPath);
  const resolvedPath = join(parentDirectory, specifier);
  const existingPath = existingSourceFile(resolvedPath);

  const changed = existingPath != resolvedPath;

  if (changed) {
    return pathToFileURL(existingPath).href;
  }

  return urlWhenSpecifierNamesTheFile(specifier, existingPath);
}

function urlWhenSpecifierNamesTheFile(specifier: string, existingPath: string): string | null {
  const namesTypeScript = specifier.endsWith('.ts');

  if (namesTypeScript) {
    return urlForExistingFile(existingPath);
  }

  const namesTsx = specifier.endsWith('.tsx');

  if (namesTsx) {
    return urlForExistingFile(existingPath);
  }

  return null;
}

function urlForExistingFile(existingPath: string): string | null {
  const fileIsThere = existsSync(existingPath);

  if (fileIsThere == false) {
    return null;
  }

  return pathToFileURL(existingPath).href;
}

function existingSourceFile(filePath: string): string {
  if (existsSync(filePath)) {
    return filePath;
  }

  const isJavaScript = filePath.endsWith('.js');

  if (isJavaScript == false) {
    return filePath;
  }

  const typescriptPath = `${filePath.slice(0, -3)}.ts`;

  if (existsSync(typescriptPath)) {
    return typescriptPath;
  }

  const tsxPath = `${filePath.slice(0, -3)}.tsx`;

  if (existsSync(tsxPath)) {
    return tsxPath;
  }

  return filePath;
}
