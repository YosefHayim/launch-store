#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, relative, sep } from 'node:path';
import process from 'node:process';
import ts from 'typescript';
const repositoryRoot = process.cwd();
const authoredRoots = ['src', 'scripts', 'examples'];
const authoredExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.mjs']);
const presentationExtensions = new Set([
  '.css',
  '.grit',
  '.html',
  '.json',
  '.jsonc',
  '.md',
  '.sh',
  '.toml',
  '.yaml',
  '.yml',
]);
const excludedPathParts = ['/.git/', '/apple/generated/', '/node_modules/', '/dist/', '/coverage/'];
const internalAliases = new Map([
  ['@apple/', 'src/apple/'],
  ['@cli/', 'src/cli/'],
  ['@core/', 'src/core/'],
  ['@google/', 'src/google/'],
  ['@providers/', 'src/providers/'],
  ['@testkit/', 'src/testkit/'],
]);
const unicodeReplacements = new Map([
  [String.fromCodePoint(0x2705), '[OK]'],
  [String.fromCodePoint(0x274c), '[ERROR]'],
  [String.fromCodePoint(0x26a0, 0xfe0f), '[WARN]'],
  [String.fromCodePoint(0x26a0), '[WARN]'],
  [String.fromCodePoint(0x2139, 0xfe0f), '[RUN]'],
  [String.fromCodePoint(0x2139), '[RUN]'],
  [String.fromCodePoint(0x23ed, 0xfe0f), '[SKIP]'],
  [String.fromCodePoint(0x23ed), '[SKIP]'],
  [String.fromCodePoint(0x25b6, 0xfe0f), '[RUN]'],
  [String.fromCodePoint(0x25b6), '[RUN]'],
  [String.fromCodePoint(0x2713), 'OK'],
  [String.fromCodePoint(0x2714), 'OK'],
  [String.fromCodePoint(0x2717), 'x'],
  [String.fromCodePoint(0x2718), 'x'],
  [String.fromCodePoint(0x2716), 'x'],
  [String.fromCodePoint(0x2192), '->'],
  [String.fromCodePoint(0x2190), '<-'],
  [String.fromCodePoint(0x21b3), '->'],
  [String.fromCodePoint(0x00d7), 'x'],
  [String.fromCodePoint(0x2026), '...'],
  [String.fromCodePoint(0x2014), '-'],
  [String.fromCodePoint(0x2013), '-'],
  [String.fromCodePoint(0x2015), '-'],
  [String.fromCodePoint(0x2022), '-'],
  [String.fromCodePoint(0x00b7), '-'],
  [String.fromCodePoint(0x2212), '-'],
  [String.fromCodePoint(0x2260), '!='],
  [String.fromCodePoint(0x2264), '<='],
  [String.fromCodePoint(0x2265), '>='],
  [String.fromCodePoint(0x2248), '~'],
]);
const isExcludedPath = (filePath) => {
  const normalizedPath = `/${filePath.replaceAll('\\', '/')}`;
  return excludedPathParts.some((excludedPart) => normalizedPath.includes(excludedPart));
};
const normalizedPathText = (filePath) => filePath.split(sep).join('/');
const internalTargetPath = (filePath, moduleSpecifier) => {
  for (const [aliasPrefix, repositoryPrefix] of internalAliases) {
    if (moduleSpecifier.startsWith(aliasPrefix)) {
      return `${repositoryPrefix}${moduleSpecifier.slice(aliasPrefix.length)}`;
    }
  }
  if (!moduleSpecifier.startsWith('.')) return undefined;
  return normalizedPathText(normalize(join(dirname(filePath), moduleSpecifier)));
};
const preferredImportSpecifier = (filePath, moduleSpecifier) => {
  const targetPath = internalTargetPath(filePath, moduleSpecifier);
  if (!targetPath) return undefined;
  const relativeTarget = normalizedPathText(relative(dirname(filePath), targetPath));
  if (!relativeTarget.startsWith('../../')) {
    if (relativeTarget.startsWith('.')) return relativeTarget;
    return `./${relativeTarget}`;
  }
  for (const [aliasPrefix, repositoryPrefix] of internalAliases) {
    if (targetPath.startsWith(repositoryPrefix)) {
      return `${aliasPrefix}${targetPath.slice(repositoryPrefix.length)}`;
    }
  }
  return undefined;
};
const listAuthoredFiles = async (directoryPath) => {
  const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  const authoredFiles = await Promise.all(
    directoryEntries.map(async (directoryEntry) => {
      const absolutePath = join(directoryPath, directoryEntry.name);
      const repositoryPath = relative(repositoryRoot, absolutePath);
      if (isExcludedPath(repositoryPath)) return [];
      if (directoryEntry.isDirectory()) {
        return listAuthoredFiles(absolutePath);
      }
      if (authoredExtensions.has(extname(directoryEntry.name))) return [absolutePath];
      return [];
    }),
  );
  return authoredFiles.flat();
};
const removeNarratedModuleHeader = (sourceText) => {
  const moduleHeaderMatch = sourceText.match(/^#![^\n]*\n(?:\s*)|^/u);
  const headerOffset = moduleHeaderMatch?.[0].length;
  if (headerOffset === undefined) return sourceText;
  const sourceAfterShebang = sourceText.slice(headerOffset);
  const leadingCommentMatch = sourceAfterShebang.match(/^\s*\/\*\*[\s\S]*?\*\/\s*/u);
  if (!leadingCommentMatch) return sourceText;
  return `${sourceText.slice(0, headerOffset)}${sourceAfterShebang.slice(leadingCommentMatch[0].length)}`;
};
const replaceDecorativeUnicode = (sourceText) => {
  let cleanedSource = sourceText;
  for (const [unicodeText, asciiText] of unicodeReplacements) {
    cleanedSource = cleanedSource.replaceAll(unicodeText, asciiText);
  }
  cleanedSource = cleanedSource.replace(/[\p{Extended_Pictographic}]/gu, '');
  cleanedSource = cleanedSource.replace(/[\u2500-\u257f\u2800-\u28ff]|\ufe0f/gu, '');
  return cleanedSource;
};
const modifierText = (functionNode, sourceFile) => {
  const retainedModifiers = [];
  const functionModifiers = functionNode.modifiers;
  if (!functionModifiers) return '';
  for (const functionModifier of functionModifiers) {
    if (functionModifier.kind === ts.SyntaxKind.AsyncKeyword) continue;
    if (functionModifier.kind === ts.SyntaxKind.DefaultKeyword) continue;
    retainedModifiers.push(functionModifier.getText(sourceFile));
  }
  if (retainedModifiers.length === 0) return '';
  return `${retainedModifiers.join(' ')} `;
};
const arrowReplacement = (functionNode, sourceFile) => {
  if ([functionNode.name, functionNode.body].some((functionPart) => functionPart === undefined)) {
    return undefined;
  }
  if (functionNode.asteriskToken) return undefined;
  if (
    functionNode.modifiers?.some(
      (functionModifier) => functionModifier.kind === ts.SyntaxKind.DefaultKeyword,
    )
  ) {
    return undefined;
  }
  if (
    functionNode.parameters.some(
      (parameterNode) => parameterNode.name.getText(sourceFile) === 'this',
    )
  ) {
    return undefined;
  }
  const functionName = functionNode.name.getText(sourceFile);
  const isAsyncFunction = functionNode.modifiers?.some(
    (functionModifier) => functionModifier.kind === ts.SyntaxKind.AsyncKeyword,
  );
  let asyncPrefix = '';
  if (isAsyncFunction) asyncPrefix = 'async ';
  const typeParameters = functionNode.typeParameters;
  let genericText = '';
  if (typeParameters) {
    genericText = `<${typeParameters.map((typeParameter) => typeParameter.getText(sourceFile)).join(', ')}>`;
  }
  const parametersText = functionNode.parameters
    .map((parameterNode) => parameterNode.getText(sourceFile))
    .join(', ');
  let returnTypeText = '';
  if (functionNode.type) returnTypeText = `: ${functionNode.type.getText(sourceFile)}`;
  const functionBlock = functionNode.body.getText(sourceFile);
  return `${modifierText(functionNode, sourceFile)}const ${functionName} = ${asyncPrefix}${genericText}(${parametersText})${returnTypeText} => ${functionBlock};`;
};
const interfaceReplacement = (interfaceNode, sourceFile) => {
  const hasDeclareModifier = interfaceNode.modifiers?.some(
    (interfaceModifier) => interfaceModifier.kind === ts.SyntaxKind.DeclareKeyword,
  );
  if (hasDeclareModifier) return undefined;
  const retainedModifiers = [];
  if (interfaceNode.modifiers) {
    for (const interfaceModifier of interfaceNode.modifiers) {
      retainedModifiers.push(interfaceModifier.getText(sourceFile));
    }
  }
  let declarationPrefix = '';
  if (retainedModifiers.length > 0) declarationPrefix = `${retainedModifiers.join(' ')} `;
  let genericText = '';
  if (interfaceNode.typeParameters) {
    genericText = `<${interfaceNode.typeParameters
      .map((typeParameter) => typeParameter.getText(sourceFile))
      .join(', ')}>`;
  }
  const inheritedTypes = [];
  if (interfaceNode.heritageClauses) {
    for (const heritageClause of interfaceNode.heritageClauses) {
      inheritedTypes.push(
        ...heritageClause.types.map((inheritedType) => inheritedType.getText(sourceFile)),
      );
    }
  }
  const memberText = interfaceNode.members
    .map((interfaceMember) => interfaceMember.getText(sourceFile))
    .join('\n');
  const shapeText = `{\n${memberText}\n}`;
  const typeParts = [...inheritedTypes, shapeText];
  return `${declarationPrefix}type ${interfaceNode.name.getText(sourceFile)}${genericText} = ${typeParts.join(' & ')};`;
};
const documentationEdit = (sourceStatement, sourceText) => {
  const commentRanges = ts.getLeadingCommentRanges(sourceText, sourceStatement.getFullStart());
  if (!commentRanges) return undefined;
  const documentationRange = commentRanges.findLast((commentRange) =>
    sourceText.startsWith('/**', commentRange.pos),
  );
  if (!documentationRange) return undefined;
  const documentationText = sourceText.slice(documentationRange.pos, documentationRange.end);
  if (
    !['@param', '@returns'].some((documentationTag) => documentationText.includes(documentationTag))
  ) {
    return undefined;
  }
  let editEnd = documentationRange.end;
  while (['\n', '\r'].includes(sourceText[editEnd])) editEnd += 1;
  return { start: documentationRange.pos, end: editEnd, replacementText: '' };
};
const statementOwnsModuleFunction = (sourceStatement) => {
  if (ts.isFunctionDeclaration(sourceStatement)) return true;
  if (!ts.isVariableStatement(sourceStatement)) return false;
  return sourceStatement.declarationList.declarations.some((variableDeclaration) => {
    const initializer = variableDeclaration.initializer;
    if (!initializer) return false;
    return [ts.isArrowFunction(initializer), ts.isFunctionExpression(initializer)].includes(true);
  });
};
const convertModuleDeclarations = (filePath, sourceText) => {
  if (extname(filePath) === '.mjs') return { convertedSource: sourceText, skippedFunctions: [] };
  let scriptKind = ts.ScriptKind.TS;
  if (extname(filePath) === '.tsx') scriptKind = ts.ScriptKind.TSX;
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const sourceEdits = [];
  const skippedFunctions = [];
  for (const sourceStatement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(sourceStatement) &&
      ts.isStringLiteral(sourceStatement.moduleSpecifier)
    ) {
      const currentSpecifier = sourceStatement.moduleSpecifier.text;
      const preferredSpecifier = preferredImportSpecifier(filePath, currentSpecifier);
      if (preferredSpecifier && preferredSpecifier !== currentSpecifier) {
        sourceEdits.push({
          start: sourceStatement.moduleSpecifier.getStart(sourceFile),
          end: sourceStatement.moduleSpecifier.getEnd(),
          replacementText: `'${preferredSpecifier}'`,
        });
      }
    }
    if (statementOwnsModuleFunction(sourceStatement)) {
      const documentationRemoval = documentationEdit(sourceStatement, sourceText);
      if (documentationRemoval) sourceEdits.push(documentationRemoval);
    }
    if (ts.isFunctionDeclaration(sourceStatement)) {
      const replacementText = arrowReplacement(sourceStatement, sourceFile);
      if (!replacementText) {
        const skippedName = sourceStatement.name?.getText(sourceFile);
        if (skippedName) skippedFunctions.push(skippedName);
        continue;
      }
      sourceEdits.push({
        start: sourceStatement.getStart(sourceFile),
        end: sourceStatement.getEnd(),
        replacementText,
      });
      continue;
    }
    if (!ts.isInterfaceDeclaration(sourceStatement)) continue;
    const replacementText = interfaceReplacement(sourceStatement, sourceFile);
    if (!replacementText) continue;
    sourceEdits.push({
      start: sourceStatement.getStart(sourceFile),
      end: sourceStatement.getEnd(),
      replacementText,
    });
  }
  let convertedSource = sourceText;
  for (const sourceEdit of sourceEdits.toReversed()) {
    convertedSource = `${convertedSource.slice(0, sourceEdit.start)}${sourceEdit.replacementText}${convertedSource.slice(sourceEdit.end)}`;
  }
  return { convertedSource, skippedFunctions };
};
const migrateFile = async (absolutePath) => {
  const repositoryPath = relative(repositoryRoot, absolutePath);
  const originalSource = await readFile(absolutePath, 'utf8');
  const withoutModuleHeader = removeNarratedModuleHeader(originalSource);
  const asciiSource = replaceDecorativeUnicode(withoutModuleHeader);
  const migration = convertModuleDeclarations(repositoryPath, asciiSource);
  if (migration.convertedSource !== originalSource) {
    await writeFile(absolutePath, migration.convertedSource);
  }
  return {
    changed: migration.convertedSource !== originalSource,
    repositoryPath,
    skippedFunctions: migration.skippedFunctions,
  };
};
const listPresentationFiles = async (directoryPath) => {
  const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  const presentationFiles = await Promise.all(
    directoryEntries.map(async (directoryEntry) => {
      const absolutePath = join(directoryPath, directoryEntry.name);
      const repositoryPath = relative(repositoryRoot, absolutePath);
      if (isExcludedPath(repositoryPath)) return [];
      if (repositoryPath === 'CODE-STYLE.md') return [];
      if (directoryEntry.isDirectory()) {
        return listPresentationFiles(absolutePath);
      }
      if (presentationExtensions.has(extname(directoryEntry.name))) return [absolutePath];
      return [];
    }),
  );
  return presentationFiles.flat();
};
const cleanPresentationFile = async (absolutePath) => {
  const originalSource = await readFile(absolutePath, 'utf8');
  const asciiSource = replaceDecorativeUnicode(originalSource);
  if (asciiSource === originalSource) return false;
  await writeFile(absolutePath, asciiSource);
  return true;
};
const runImportMigrationSelfTest = () => {
  const importCases = [
    {
      filePath: 'src/core/services/appleStoreClient.ts',
      currentSpecifier: '@core/types/credentials.js',
      expectedSpecifier: '../types/credentials.js',
    },
    {
      filePath: 'src/cli/commands/release.ts',
      currentSpecifier: '@core/types/credentials.js',
      expectedSpecifier: '@core/types/credentials.js',
    },
    {
      filePath: 'src/core/services/appleStoreClient.ts',
      currentSpecifier: '../../apple/ascClient.js',
      expectedSpecifier: '@apple/ascClient.js',
    },
  ];
  for (const importCase of importCases) {
    const migratedSpecifier = preferredImportSpecifier(
      importCase.filePath,
      importCase.currentSpecifier,
    );
    if (migratedSpecifier !== importCase.expectedSpecifier) {
      throw new Error(
        `${importCase.filePath}: expected ${importCase.expectedSpecifier}, received ${migratedSpecifier}`,
      );
    }
  }
  process.stdout.write(`Import migration self-test passed ${importCases.length} case(s).\n`);
};
if (process.argv.includes('--self-test')) {
  runImportMigrationSelfTest();
  process.exit(0);
}
const authoredFiles = (
  await Promise.all(
    authoredRoots.map((authoredRoot) => listAuthoredFiles(join(repositoryRoot, authoredRoot))),
  )
).flat();
authoredFiles.push(join(repositoryRoot, 'launch.config.example.ts'));
const migrationReports = await Promise.all(authoredFiles.map(migrateFile));
const changedFileCount = migrationReports.filter(
  (migrationReport) => migrationReport.changed,
).length;
const skippedFunctionReports = migrationReports.filter(
  (migrationReport) => migrationReport.skippedFunctions.length > 0,
);
const presentationFiles = await listPresentationFiles(repositoryRoot);
const presentationReports = await Promise.all(presentationFiles.map(cleanPresentationFile));
const changedPresentationCount = presentationReports.filter(
  (presentationChanged) => presentationChanged,
).length;
process.stdout.write(`Migrated ${changedFileCount} of ${authoredFiles.length} authored files.\n`);
process.stdout.write(`Cleaned presentation text in ${changedPresentationCount} file(s).\n`);
for (const skippedFunctionReport of skippedFunctionReports) {
  process.stdout.write(
    `Skipped ${skippedFunctionReport.repositoryPath}: ${skippedFunctionReport.skippedFunctions.join(', ')}\n`,
  );
}
