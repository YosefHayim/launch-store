#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, sep } from 'node:path';
import process from 'node:process';
import ts from 'typescript';
const repositoryRoot = process.cwd();
const configPath = ts.findConfigFile(repositoryRoot, ts.sys.fileExists, 'tsconfig.json');
if (!configPath) throw new Error('tsconfig.json is required');
const configSource = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(configSource.config, ts.sys, repositoryRoot);
const typeProgram = ts.createProgram({
  rootNames: parsedConfig.fileNames,
  options: parsedConfig.options,
});
const typeChecker = typeProgram.getTypeChecker();
const normalizedPath = (filePath) => filePath.split(sep).join('/');
const isTypeBarrelSpecifier = (importerPath, moduleText) => {
  const resolvedModule = ts.resolveModuleName(
    moduleText,
    importerPath,
    parsedConfig.options,
    ts.sys,
  ).resolvedModule;
  if (!resolvedModule) return false;
  return normalizedPath(resolvedModule.resolvedFileName).endsWith('/src/core/types/index.ts');
};
const owningModuleSpecifier = (importerPath, declarationPath) => {
  const repositoryDeclarationPath = normalizedPath(relative(repositoryRoot, declarationPath));
  const moduleBase = repositoryDeclarationPath
    .replace(/^src\/core\/types\//u, '')
    .replace(/\.ts$/u, '.js');
  const repositoryImporterPath = normalizedPath(relative(repositoryRoot, importerPath));
  if (repositoryImporterPath === 'src/index.ts') return `./core/types/${moduleBase}`;
  const relativeModule = normalizedPath(relative(dirname(importerPath), declarationPath)).replace(
    /\.ts$/u,
    '.js',
  );
  if (!relativeModule.startsWith('../')) return `./${relativeModule}`;
  const parentDepth = relativeModule.split('/').filter((pathPart) => pathPart === '..').length;
  if (parentDepth === 1) return relativeModule;
  return `@core/types/${moduleBase}`;
};
const declarationPathForSpecifier = (importSpecifier) => {
  const localSymbol = typeChecker.getSymbolAtLocation(importSpecifier.name);
  if (!localSymbol) return undefined;
  const exportedSymbol = typeChecker.getAliasedSymbol(localSymbol);
  const declarations = exportedSymbol.getDeclarations();
  if (!declarations) return undefined;
  const sourceDeclaration = declarations.find(
    (declarationNode) => !declarationNode.getSourceFile().isDeclarationFile,
  );
  return sourceDeclaration?.getSourceFile().fileName;
};
const renderedSpecifier = (importSpecifier) => {
  if (!importSpecifier.propertyName) return importSpecifier.name.text;
  return `${importSpecifier.propertyName.text} as ${importSpecifier.name.text}`;
};
const replacementImports = (sourceFile, importNode) => {
  const importClause = importNode.importClause;
  if (!importClause?.namedBindings) return undefined;
  if (!ts.isNamedImports(importClause.namedBindings)) return undefined;
  const groupedSpecifiers = new Map();
  for (const importSpecifier of importClause.namedBindings.elements) {
    const declarationPath = declarationPathForSpecifier(importSpecifier);
    if (!declarationPath) return undefined;
    const moduleSpecifier = owningModuleSpecifier(sourceFile.fileName, declarationPath);
    const existingSpecifiers = groupedSpecifiers.get(moduleSpecifier);
    if (existingSpecifiers) {
      existingSpecifiers.push(renderedSpecifier(importSpecifier));
      continue;
    }
    groupedSpecifiers.set(moduleSpecifier, [renderedSpecifier(importSpecifier)]);
  }
  let importKeyword = 'import';
  if (importClause.isTypeOnly) importKeyword = 'import type';
  return [...groupedSpecifiers.entries()]
    .sort(([leftModule], [rightModule]) => leftModule.localeCompare(rightModule))
    .map(
      ([moduleSpecifier, importedNames]) =>
        `${importKeyword} { ${importedNames.sort().join(', ')} } from '${moduleSpecifier}';`,
    )
    .join('\n');
};
const replacementExports = (sourceFile, exportNode) => {
  if (!exportNode.exportClause) return undefined;
  if (!ts.isNamedExports(exportNode.exportClause)) return undefined;
  const groupedSpecifiers = new Map();
  for (const exportSpecifier of exportNode.exportClause.elements) {
    const declarationPath = declarationPathForSpecifier(exportSpecifier);
    if (!declarationPath) return undefined;
    const moduleSpecifier = owningModuleSpecifier(sourceFile.fileName, declarationPath);
    const existingSpecifiers = groupedSpecifiers.get(moduleSpecifier);
    if (existingSpecifiers) {
      existingSpecifiers.push(renderedSpecifier(exportSpecifier));
      continue;
    }
    groupedSpecifiers.set(moduleSpecifier, [renderedSpecifier(exportSpecifier)]);
  }
  let exportKeyword = 'export';
  if (exportNode.isTypeOnly) exportKeyword = 'export type';
  return [...groupedSpecifiers.entries()]
    .sort(([leftModule], [rightModule]) => leftModule.localeCompare(rightModule))
    .map(
      ([moduleSpecifier, exportedNames]) =>
        `${exportKeyword} { ${exportedNames.sort().join(', ')} } from '${moduleSpecifier}';`,
    )
    .join('\n');
};
const editsForSource = (sourceFile) => {
  const sourceEdits = [];
  for (const sourceStatement of sourceFile.statements) {
    if (
      ![ts.isImportDeclaration(sourceStatement), ts.isExportDeclaration(sourceStatement)].includes(
        true,
      )
    ) {
      continue;
    }
    if (!sourceStatement.moduleSpecifier) continue;
    if (!ts.isStringLiteral(sourceStatement.moduleSpecifier)) continue;
    if (!isTypeBarrelSpecifier(sourceFile.fileName, sourceStatement.moduleSpecifier.text)) continue;
    let replacementText;
    if (ts.isImportDeclaration(sourceStatement)) {
      replacementText = replacementImports(sourceFile, sourceStatement);
    }
    if (ts.isExportDeclaration(sourceStatement)) {
      replacementText = replacementExports(sourceFile, sourceStatement);
    }
    if (!replacementText) continue;
    sourceEdits.push({
      start: sourceStatement.getStart(sourceFile),
      end: sourceStatement.getEnd(),
      replacementText,
    });
  }
  return sourceEdits;
};
const migrateSourceFile = async (sourceFile, sourceEdits) => {
  const originalSource = await readFile(sourceFile.fileName, 'utf8');
  let migratedSource = originalSource;
  for (const sourceEdit of sourceEdits.toReversed()) {
    migratedSource = `${migratedSource.slice(0, sourceEdit.start)}${sourceEdit.replacementText}${migratedSource.slice(sourceEdit.end)}`;
  }
  await writeFile(sourceFile.fileName, migratedSource);
};
const migrationTasks = [];
for (const sourceFile of typeProgram.getSourceFiles()) {
  if (sourceFile.isDeclarationFile) continue;
  const sourceEdits = editsForSource(sourceFile);
  if (sourceEdits.length === 0) continue;
  migrationTasks.push(migrateSourceFile(sourceFile, sourceEdits));
}
await Promise.all(migrationTasks);
const changedFileCount = migrationTasks.length;
process.stdout.write(`Replaced type-barrel imports in ${changedFileCount} file(s).\n`);
