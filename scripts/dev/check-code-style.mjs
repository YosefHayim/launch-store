#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, sep } from 'node:path';
import process from 'node:process';
import ts from 'typescript';
const repositoryRoot = process.cwd();
const styleRulesPath = join(repositoryRoot, 'code-style.rules.json');
const styleGuidePath = join(repositoryRoot, 'CODE-STYLE.md');
const styleRulesDocument = JSON.parse(readFileSync(styleRulesPath, 'utf8'));
const forbiddenBindings = new Set(styleRulesDocument.forbiddenBindings);
const authoredExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.mjs']);
const excludedPathParts = ['/apple/generated/', '/node_modules/', '/dist/', '/coverage/'];
const allowedRuntimeEntryPoints = new Set(['src/cli/index.ts']);
const allowedPromiseContractPaths = new Set(['src/cli/program.ts']);
const allowedProcessPaths = new Set([
  'src/cli/index.ts',
  'src/cli/runCliProgram.ts',
  'src/core/services/environment.ts',
]);
const directPlatformModules = new Set([
  'node:child_process',
  'node:fs',
  'node:fs/promises',
  'node:path',
]);
const guideSeparator = String.fromCodePoint(183);
const chosenMarker = '[GOOD]';
const rejectedMarker = '[AVOID]';
const forbiddenPresentationPattern =
  /[\p{Extended_Pictographic}\u00d7\u2013-\u2015\u2022\u2026\u2190-\u21ff\u2500-\u257f\u2713-\u2718\u2800-\u28ff]/gu;
const normalizedRepositoryPath = (filePath) => filePath.split(sep).join('/');
const isExcludedPath = (filePath) => {
  const normalizedPath = `/${normalizedRepositoryPath(filePath)}`;
  return excludedPathParts.some((excludedPart) => normalizedPath.includes(excludedPart));
};
const isTestPath = (filePath) =>
  [
    ['.test.ts', '.e2e.ts', '.testkit.ts'].some((testSuffix) => filePath.endsWith(testSuffix)),
    filePath.startsWith('src/testkit/'),
  ].includes(true);
const isProductionPath = (filePath) => filePath.startsWith('src/') && !isTestPath(filePath);
const isAppleTransportBoundary = (filePath) =>
  ['src/apple/ascClient.ts', 'src/apple/transportHelpers.ts'].includes(filePath);
const appleTransportFailureConstructors = new Set([
  'AscAvailabilityUpdateError',
  'AscRequestError',
]);
const isTypedAppleTransportThrow = (filePath, throwStatement) => {
  if (!isAppleTransportBoundary(filePath)) return false;
  const thrownExpression = throwStatement.expression;
  if (ts.isIdentifier(thrownExpression)) return true;
  if (!ts.isNewExpression(thrownExpression)) return false;
  if (!ts.isIdentifier(thrownExpression.expression)) return false;
  return appleTransportFailureConstructors.has(thrownExpression.expression.text);
};
const listAuthoredFiles = (directoryPath) => {
  const authoredFiles = [];
  if (!existsSync(directoryPath)) return authoredFiles;
  for (const directoryEntry of readdirSync(directoryPath, { withFileTypes: true })) {
    const absolutePath = join(directoryPath, directoryEntry.name);
    const repositoryPath = relative(repositoryRoot, absolutePath);
    if (isExcludedPath(repositoryPath)) continue;
    if (directoryEntry.isDirectory()) {
      authoredFiles.push(...listAuthoredFiles(absolutePath));
      continue;
    }
    if (authoredExtensions.has(extname(directoryEntry.name))) authoredFiles.push(repositoryPath);
  }
  return authoredFiles;
};
const lineNumber = (sourceFile, sourceNode) =>
  sourceFile.getLineAndCharacterOfPosition(sourceNode.getStart(sourceFile)).line + 1;
const pushViolation = (violations, filePath, line, ruleId, message) => {
  violations.push({ filePath, line, ruleId, message });
};
const bindingIdentifiers = (bindingNode) => {
  if (ts.isIdentifier(bindingNode)) return [bindingNode];
  if (!ts.isObjectBindingPattern(bindingNode) && !ts.isArrayBindingPattern(bindingNode)) return [];
  const identifiers = [];
  for (const bindingElement of bindingNode.elements) {
    if (ts.isOmittedExpression(bindingElement)) continue;
    identifiers.push(...bindingIdentifiers(bindingElement.name));
  }
  return identifiers;
};
const pathMatchesPattern = (filePath, pathPattern) => {
  if (!pathPattern.includes('*')) return filePath === pathPattern;
  const fixedPrefix = pathPattern.slice(0, pathPattern.indexOf('*'));
  return filePath.startsWith(fixedPrefix);
};
const bindingIsAllowed = (filePath, bindingText) => {
  if (bindingText !== 'build') return !forbiddenBindings.has(bindingText);
  const allowedPatterns = styleRulesDocument.domainScopedBindings.build;
  return allowedPatterns.some((pathPattern) => pathMatchesPattern(filePath, pathPattern));
};
const checkBinding = (request) => {
  const bindingText = request.bindingNode.text;
  if (bindingIsAllowed(request.filePath, bindingText)) return;
  pushViolation(
    request.violations,
    request.filePath,
    lineNumber(request.sourceFile, request.bindingNode),
    'name.domain-prose',
    `Rename the generic binding "${bindingText}" to the domain value it holds.`,
  );
};
const internalTargetPath = (filePath, moduleSpecifier) => {
  if (moduleSpecifier.startsWith('@apple/'))
    return `src/apple/${moduleSpecifier.slice('@apple/'.length)}`;
  if (moduleSpecifier.startsWith('@cli/'))
    return `src/cli/${moduleSpecifier.slice('@cli/'.length)}`;
  if (moduleSpecifier.startsWith('@core/'))
    return `src/core/${moduleSpecifier.slice('@core/'.length)}`;
  if (moduleSpecifier.startsWith('@google/'))
    return `src/google/${moduleSpecifier.slice('@google/'.length)}`;
  if (moduleSpecifier.startsWith('@providers/'))
    return `src/providers/${moduleSpecifier.slice('@providers/'.length)}`;
  if (moduleSpecifier.startsWith('@testkit/'))
    return `src/testkit/${moduleSpecifier.slice('@testkit/'.length)}`;
  if (!moduleSpecifier.startsWith('.')) return undefined;
  return normalizedRepositoryPath(normalize(join(dirname(filePath), moduleSpecifier)));
};
const ownerOfPath = (filePath) => {
  const ownerMatch = /^src\/([^/]+)/u.exec(filePath);
  return ownerMatch?.[1];
};
const ownershipAllows = (sourcePath, targetPath) => {
  const sourceOwner = ownerOfPath(sourcePath);
  const targetOwner = ownerOfPath(targetPath);
  if ([sourceOwner, targetOwner].some((ownerName) => ownerName === undefined)) return true;
  if (isTestPath(sourcePath) && targetOwner === 'testkit') return true;
  if (sourceOwner === targetOwner) return true;
  if (sourceOwner === 'cli') {
    if (sourcePath === 'src/cli/index.ts' && targetOwner === 'providers') return true;
    return targetOwner === 'core';
  }
  if (sourceOwner === 'providers') {
    if (targetOwner !== 'core') return false;
    return ['src/core/types/', 'src/core/services/'].some((allowedPrefix) =>
      targetPath.startsWith(allowedPrefix),
    );
  }
  if (sourceOwner === 'core') {
    return sourcePath.startsWith('src/core/services/') && ['apple', 'google'].includes(targetOwner);
  }
  if (['apple', 'google'].includes(sourceOwner)) {
    return targetOwner === 'core' && targetPath.startsWith('src/core/types/');
  }
  return true;
};
const checkImport = (request) => {
  const moduleSpecifier = request.importNode.moduleSpecifier;
  if (!ts.isStringLiteral(moduleSpecifier)) return;
  const moduleText = moduleSpecifier.text;
  if (isProductionPath(request.filePath) && directPlatformModules.has(moduleText)) {
    pushViolation(
      request.violations,
      request.filePath,
      lineNumber(request.sourceFile, request.importNode),
      'effect.platform',
      `Use the official Effect Platform service instead of ${moduleText}.`,
    );
  }
  if (
    isProductionPath(request.filePath) &&
    moduleText === '@clack/prompts' &&
    request.filePath !== 'src/core/services/prompt.ts'
  ) {
    pushViolation(
      request.violations,
      request.filePath,
      lineNumber(request.sourceFile, request.importNode),
      'effect.platform',
      'Use the Launch prompt service instead of importing @clack/prompts directly.',
    );
  }
  const targetPath = internalTargetPath(request.filePath, moduleText);
  if (targetPath && moduleText.startsWith('@')) {
    const relativeTarget = normalizedRepositoryPath(
      relative(dirname(request.filePath), targetPath),
    );
    if (!relativeTarget.startsWith('../../')) {
      pushViolation(
        request.violations,
        request.filePath,
        lineNumber(request.sourceFile, request.importNode),
        'import.alias-depth',
        'Use a relative import for a module in the same directory or one parent away.',
      );
    }
  }
  if (moduleText.startsWith('../../')) {
    pushViolation(
      request.violations,
      request.filePath,
      lineNumber(request.sourceFile, request.importNode),
      'import.alias-depth',
      'Use an approved at-sign alias for imports deeper than one parent.',
    );
  }
  if (targetPath && !ownershipAllows(request.filePath, targetPath)) {
    pushViolation(
      request.violations,
      request.filePath,
      lineNumber(request.sourceFile, request.importNode),
      'import.ownership',
      `Import from ${targetPath} crosses the ${ownerOfPath(request.filePath)} ownership boundary.`,
    );
  }
};
const checkReExport = (request) => {
  if (request.filePath === 'src/index.ts') return;
  const moduleSpecifier = request.exportNode.moduleSpecifier;
  if (!moduleSpecifier) return;
  if (!ts.isStringLiteral(moduleSpecifier)) return;
  if (!internalTargetPath(request.filePath, moduleSpecifier.text)) return;
  pushViolation(
    request.violations,
    request.filePath,
    lineNumber(request.sourceFile, request.exportNode),
    'module.public-entrypoint',
    'Import from the owning module directly instead of re-exporting an internal module.',
  );
};
const checkSourceNode = (request) => {
  const { filePath, sourceFile, sourceNode, violations } = request;
  if (ts.isFunctionDeclaration(sourceNode) && sourceNode.parent === sourceFile) {
    pushViolation(
      violations,
      filePath,
      lineNumber(sourceFile, sourceNode),
      'function.arrow-only',
      'Convert the module function declaration to a const arrow declared before first use.',
    );
  }
  if (
    isProductionPath(filePath) &&
    !isAppleTransportBoundary(filePath) &&
    !allowedRuntimeEntryPoints.has(filePath) &&
    ts.canHaveModifiers(sourceNode) &&
    ts
      .getModifiers(sourceNode)
      ?.some((sourceModifier) => sourceModifier.kind === ts.SyntaxKind.AsyncKeyword)
  ) {
    pushViolation(
      violations,
      filePath,
      lineNumber(sourceFile, sourceNode),
      'effect.production',
      'Return an Effect instead of declaring async production behavior.',
    );
  }
  if (
    isProductionPath(filePath) &&
    !isAppleTransportBoundary(filePath) &&
    !allowedPromiseContractPaths.has(filePath) &&
    ts.isTypeReferenceNode(sourceNode) &&
    sourceNode.typeName.getText(sourceFile) === 'Promise'
  ) {
    pushViolation(
      violations,
      filePath,
      lineNumber(sourceFile, sourceNode),
      'effect.production',
      'Replace the Promise contract with Effect.',
    );
  }
  if (
    isProductionPath(filePath) &&
    !isAppleTransportBoundary(filePath) &&
    ts.isCallExpression(sourceNode) &&
    sourceNode.expression.getText(sourceFile) === 'Promise.all'
  ) {
    pushViolation(
      violations,
      filePath,
      lineNumber(sourceFile, sourceNode),
      'effect.concurrency',
      'Use Effect.all or Effect.forEach with explicit concurrency.',
    );
  }
  if (
    isProductionPath(filePath) &&
    !isAppleTransportBoundary(filePath) &&
    ts.isCallExpression(sourceNode) &&
    sourceNode.expression.getText(sourceFile) === 'fetch'
  ) {
    pushViolation(
      violations,
      filePath,
      lineNumber(sourceFile, sourceNode),
      'effect.platform',
      'Use Effect Platform HttpClient instead of global fetch.',
    );
  }
  if (
    isProductionPath(filePath) &&
    ts.isThrowStatement(sourceNode) &&
    !isTypedAppleTransportThrow(filePath, sourceNode)
  ) {
    pushViolation(
      violations,
      filePath,
      lineNumber(sourceFile, sourceNode),
      'failure.tagged-data',
      'Return a tagged failure through Effect.fail instead of throwing.',
    );
  }
  if (isProductionPath(filePath) && ts.isClassDeclaration(sourceNode)) {
    const extendedType = sourceNode.heritageClauses
      ?.find((heritageClause) => heritageClause.token === ts.SyntaxKind.ExtendsKeyword)
      ?.types[0]?.expression.getText(sourceFile);
    if (
      [
        sourceNode.name?.text.endsWith('Error'),
        extendedType?.startsWith('Data.TaggedError'),
      ].includes(true) &&
      !(
        isAppleTransportBoundary(filePath) &&
        appleTransportFailureConstructors.has(sourceNode.name?.text)
      )
    ) {
      pushViolation(
        violations,
        filePath,
        lineNumber(sourceFile, sourceNode),
        'failure.tagged-data',
        'Replace the error class with a readonly tagged failure type and Data.tagged constructor.',
      );
    }
    if (extendedType?.startsWith('Context.Tag')) {
      pushViolation(
        violations,
        filePath,
        lineNumber(sourceFile, sourceNode),
        'service.domain-only',
        'Replace the service class with a readonly service type and Context.GenericTag value.',
      );
    }
  }
  if (ts.isInterfaceDeclaration(sourceNode)) {
    pushViolation(
      violations,
      filePath,
      lineNumber(sourceFile, sourceNode),
      'type.alias-only',
      'Use a type alias unless this is documented third-party declaration augmentation.',
    );
  }
  if (sourceNode.kind === ts.SyntaxKind.AnyKeyword) {
    pushViolation(
      violations,
      filePath,
      lineNumber(sourceFile, sourceNode),
      'type.safe',
      'Replace any with unknown and decode it.',
    );
  }
  if (ts.isAsExpression(sourceNode) && sourceNode.type.getText(sourceFile) !== 'const') {
    pushViolation(
      violations,
      filePath,
      lineNumber(sourceFile, sourceNode),
      'type.safe',
      'Decode or narrow the source instead of asserting its type.',
    );
  }
  if (
    [ts.isTypeAssertionExpression(sourceNode), ts.isNonNullExpression(sourceNode)].includes(true)
  ) {
    pushViolation(
      violations,
      filePath,
      lineNumber(sourceFile, sourceNode),
      'type.safe',
      'Decode or prove the type instead of asserting it.',
    );
  }
  if (ts.isConditionalExpression(sourceNode)) {
    pushViolation(
      violations,
      filePath,
      lineNumber(sourceFile, sourceNode),
      'control.explicit',
      'Replace the ternary with a guard, switch, or named lookup.',
    );
  }
  if (ts.isCallExpression(sourceNode)) {
    let calledExpression = sourceNode.expression;
    if (ts.isParenthesizedExpression(calledExpression)) {
      calledExpression = calledExpression.expression;
    }
    if (
      [ts.isArrowFunction(calledExpression), ts.isFunctionExpression(calledExpression)].includes(
        true,
      )
    ) {
      pushViolation(
        violations,
        filePath,
        lineNumber(sourceFile, sourceNode),
        'control.explicit',
        'Replace the immediately invoked function with a named value, guard, or switch.',
      );
    }
  }
  if (
    ts.isBinaryExpression(sourceNode) &&
    [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(
      sourceNode.operatorToken.kind,
    )
  ) {
    pushViolation(
      violations,
      filePath,
      lineNumber(sourceFile, sourceNode),
      'control.explicit',
      'Replace fallback operators with an explicit absence or domain branch.',
    );
  }
  if (
    [
      ts.isVariableDeclaration(sourceNode),
      ts.isParameter(sourceNode),
      ts.isBindingElement(sourceNode),
    ].includes(true)
  ) {
    for (const bindingIdentifier of bindingIdentifiers(sourceNode.name)) {
      checkBinding({ filePath, sourceFile, bindingNode: bindingIdentifier, violations });
    }
  }
  if (ts.isFunctionDeclaration(sourceNode) && sourceNode.name) {
    checkBinding({ filePath, sourceFile, bindingNode: sourceNode.name, violations });
  }
  if (
    [ts.isMethodDeclaration(sourceNode), ts.isMethodSignature(sourceNode)].includes(true) &&
    ts.isIdentifier(sourceNode.name)
  ) {
    checkBinding({ filePath, sourceFile, bindingNode: sourceNode.name, violations });
  }
  if (
    ts.isPropertyAssignment(sourceNode) &&
    ts.isIdentifier(sourceNode.name) &&
    [
      ts.isArrowFunction(sourceNode.initializer),
      ts.isFunctionExpression(sourceNode.initializer),
    ].includes(true)
  ) {
    checkBinding({ filePath, sourceFile, bindingNode: sourceNode.name, violations });
  }
  if (ts.isCatchClause(sourceNode) && sourceNode.variableDeclaration) {
    for (const bindingIdentifier of bindingIdentifiers(sourceNode.variableDeclaration.name)) {
      checkBinding({ filePath, sourceFile, bindingNode: bindingIdentifier, violations });
    }
  }
  if (ts.isImportDeclaration(sourceNode))
    checkImport({ filePath, sourceFile, importNode: sourceNode, violations });
  if (ts.isExportDeclaration(sourceNode))
    checkReExport({ filePath, sourceFile, exportNode: sourceNode, violations });
  ts.forEachChild(sourceNode, (childNode) =>
    checkSourceNode({ filePath, sourceFile, sourceNode: childNode, violations }),
  );
};
const checkFileText = (filePath, sourceText, violations) => {
  if (/^\s*\/\*\*/u.test(sourceText)) {
    pushViolation(
      violations,
      filePath,
      1,
      'comment.hidden-intent',
      'Remove the narrated module header and keep only comments that explain a hidden constraint.',
    );
  }
  if (/\/(?:\/|\*)\s*@ts-(?:ignore|expect-error|nocheck)/u.test(sourceText)) {
    pushViolation(
      violations,
      filePath,
      1,
      'type.safe',
      'Remove the TypeScript suppression and repair the contract.',
    );
  }
  const forbiddenPresentationMatches = sourceText.match(forbiddenPresentationPattern);
  if (forbiddenPresentationMatches) {
    pushViolation(
      violations,
      filePath,
      1,
      'presentation.ascii',
      `Replace decorative Unicode with ASCII: ${[...new Set(forbiddenPresentationMatches)].join(' ')}`,
    );
  }
  if (
    isProductionPath(filePath) &&
    filePath !== 'src/core/services/environment.ts' &&
    /\bprocess\.env\b/u.test(sourceText)
  ) {
    pushViolation(
      violations,
      filePath,
      1,
      'schema.environment',
      'Read the decoded LaunchEnvironment service instead of process.env.',
    );
  }
  if (
    isProductionPath(filePath) &&
    !allowedProcessPaths.has(filePath) &&
    /\bprocess\.(?!env\b)/u.test(sourceText)
  ) {
    pushViolation(
      violations,
      filePath,
      1,
      'effect.platform',
      'Read process state through an Effect Platform service or the root runtime boundary.',
    );
  }
  if (
    isProductionPath(filePath) &&
    filePath !== 'src/core/services/logger.ts' &&
    /\bconsole\.(?:log|info|warn|error|debug)\b/u.test(sourceText)
  ) {
    pushViolation(
      violations,
      filePath,
      1,
      'presentation.ascii',
      'Use Effect logging instead of console output.',
    );
  }
};
const checkPassiveBarrel = (filePath, sourceFile, violations) => {
  if (filePath === 'src/index.ts') return;
  if (sourceFile.statements.length === 0) return;
  const isPassiveBarrel = sourceFile.statements.every((sourceStatement) =>
    [
      ts.isExportDeclaration(sourceStatement),
      ts.isImportDeclaration(sourceStatement),
      ts.isEmptyStatement(sourceStatement),
    ].includes(true),
  );
  if (!isPassiveBarrel) return;
  pushViolation(
    violations,
    filePath,
    1,
    'module.public-entrypoint',
    'Delete the internal passive barrel and import each owning module directly.',
  );
};
const checkScriptLocation = (filePath, violations) => {
  if (!filePath.startsWith('scripts/')) return;
  const scriptRemainder = filePath.slice('scripts/'.length);
  if (scriptRemainder.includes('/')) return;
  pushViolation(
    violations,
    filePath,
    1,
    'tooling.script-location',
    'Move the script into scripts/dev or scripts/production according to its lifecycle.',
  );
};
const metadataPattern = new RegExp(
  `^\\[rule:([a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)\\] ${guideSeparator} verify: (?:\\x60([^\\x60]+)\\x60|judgment)$`,
  'u',
);
const checkStyleGuide = (violations) => {
  const guideLines = readFileSync(styleGuidePath, 'utf8').split('\n');
  const requiredSections = [
    '## Rules',
    '## Canonical example',
    '## Golden path',
    '## Exemplars',
    '## Never',
  ];
  for (const requiredSection of requiredSections) {
    if (!guideLines.some((guideLine) => guideLine.startsWith(requiredSection))) {
      pushViolation(
        violations,
        'CODE-STYLE.md',
        1,
        'format.rule-card',
        `Add the required ${requiredSection} section.`,
      );
    }
  }
  const documentedRules = new Map();
  for (let lineIndex = 0; lineIndex < guideLines.length; lineIndex += 1) {
    if (!guideLines[lineIndex]?.startsWith('### ')) continue;
    const metadataLine = guideLines[lineIndex + 1];
    let metadataMatch;
    if (metadataLine) metadataMatch = metadataPattern.exec(metadataLine);
    if (!metadataMatch) continue;
    const ruleId = metadataMatch[1];
    const verifyCommand = metadataMatch[2];
    const recordedVerify = verifyCommand;
    if (!recordedVerify) documentedRules.set(ruleId, { verify: 'judgment', line: lineIndex + 2 });
    if (recordedVerify)
      documentedRules.set(ruleId, { verify: recordedVerify, line: lineIndex + 2 });
  }
  for (const styleRule of styleRulesDocument.rules) {
    const documentedRule = documentedRules.get(styleRule.id);
    if (!documentedRule) {
      pushViolation(
        violations,
        'CODE-STYLE.md',
        1,
        'format.rule-card',
        `Document rule ${styleRule.id}.`,
      );
      continue;
    }
    if (documentedRule.verify !== styleRule.verify) {
      pushViolation(
        violations,
        'CODE-STYLE.md',
        documentedRule.line,
        styleRule.id,
        `Mirror verify command "${styleRule.verify}" exactly.`,
      );
    }
    const assertionText = guideLines[documentedRule.line + 1];
    if (assertionText !== styleRule.statement) {
      pushViolation(
        violations,
        'CODE-STYLE.md',
        documentedRule.line + 2,
        styleRule.id,
        'Mirror the JSON statement byte for byte.',
      );
    }
    const nextHeadingOffset = guideLines
      .slice(documentedRule.line + 1)
      .findIndex((guideLine) =>
        [guideLine.startsWith('### '), guideLine.startsWith('## ')].includes(true),
      );
    let cardEnd = guideLines.length;
    if (nextHeadingOffset >= 0) cardEnd = documentedRule.line + 1 + nextHeadingOffset;
    const cardText = guideLines.slice(documentedRule.line + 1, cardEnd).join('\n');
    const requiredCardSlots = [
      cardText.includes(`// ${chosenMarker}`),
      cardText.includes(`// ${rejectedMarker}`),
      cardText.includes('\nWhy:'),
    ];
    if (requiredCardSlots.includes(false)) {
      pushViolation(
        violations,
        'CODE-STYLE.md',
        documentedRule.line,
        styleRule.id,
        'Include chosen, rejected, and Why slots in the rule card.',
      );
    }
  }
};
const scanSource = (filePath, sourceText, violations) => {
  let scriptKind = ts.ScriptKind.TS;
  if (extname(filePath) === '.tsx') scriptKind = ts.ScriptKind.TSX;
  if (extname(filePath) === '.mjs') scriptKind = ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  checkFileText(filePath, sourceText, violations);
  checkPassiveBarrel(filePath, sourceFile, violations);
  checkScriptLocation(filePath, violations);
  checkSourceNode({ filePath, sourceFile, sourceNode: sourceFile, violations });
};
const runSelfTest = () => {
  const warningSymbol = String.fromCodePoint(0x26a0);
  const selfTestCases = [
    {
      expectedRuleId: 'function.arrow-only',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: 'export function chooseConfig() { return {}; }',
    },
    {
      expectedRuleId: 'effect.production',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: 'export const loadConfig = async (): Promise<string> => "config";',
    },
    {
      expectedRuleId: 'effect.concurrency',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: 'export const loadConfigs = () => Promise.all([]);',
    },
    {
      expectedRuleId: 'effect.platform',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: 'import { readFileSync } from "node:fs";',
    },
    {
      expectedRuleId: 'effect.platform',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: 'export const loadConfig = () => fetch("https://example.com/config");',
    },
    {
      expectedRuleId: 'failure.tagged-data',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: 'export const loadConfig = () => { throw new Error("missing"); };',
    },
    {
      expectedRuleId: 'failure.tagged-data',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: 'export class ConfigFailure extends Data.TaggedError("ConfigFailure")<{}> {}',
    },
    {
      expectedRuleId: 'service.domain-only',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText:
        'export class ConfigService extends Context.Tag("ConfigService")<ConfigService, {}>() {}',
    },
    {
      expectedRuleId: 'schema.environment',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: 'export const key = process.env.KEY;',
    },
    {
      expectedRuleId: 'type.alias-only',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: 'export interface LaunchConfig {}',
    },
    {
      expectedRuleId: 'type.safe',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: 'export const parseConfig = (candidate: any) => candidate as LaunchConfig;',
    },
    {
      expectedRuleId: 'name.domain-prose',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: 'export const loadConfig = () => { const result = {}; return result; };',
    },
    {
      expectedRuleId: 'name.domain-prose',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: 'export const configService = { resolve(): void {} };',
    },
    {
      expectedRuleId: 'control.explicit',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: 'export const mode = selectedMode ?? (interactive ? "prompt" : "blocked");',
    },
    {
      expectedRuleId: 'import.ownership',
      filePath: 'src/cli/commands/styleFixture.ts',
      sourceText: 'import { GooglePlayClient } from "@google/playClient.js";',
    },
    {
      expectedRuleId: 'import.alias-depth',
      filePath: 'src/cli/commands/styleFixture.ts',
      sourceText: 'import { syncStore } from "../../../core/store/sync.js";',
    },
    {
      expectedRuleId: 'import.alias-depth',
      filePath: 'src/core/services/styleFixture.ts',
      sourceText: 'import type { LaunchConfig } from "@core/types/config.js";',
    },
    {
      expectedRuleId: 'module.public-entrypoint',
      filePath: 'src/core/types/index.ts',
      sourceText: 'export type * from "./config.js";',
    },
    {
      expectedRuleId: 'module.public-entrypoint',
      filePath: 'src/google/styleFixture.ts',
      sourceText:
        'export type { LaunchConfig } from "../core/types/config.js"; export const client = {};',
    },
    {
      expectedRuleId: 'presentation.ascii',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: `export const showConfig = () => console.log("${warningSymbol}");`,
    },
    {
      expectedRuleId: 'presentation.ascii',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: `export const dimensions = "1290${String.fromCodePoint(0xd7)}2796";`,
    },
    {
      expectedRuleId: 'comment.hidden-intent',
      filePath: 'src/core/config/styleFixture.ts',
      sourceText: '/** Config utilities. */\nexport const config = {};',
    },
    {
      expectedRuleId: 'tooling.script-location',
      filePath: 'scripts/styleFixture.ts',
      sourceText: 'export const runFixture = () => undefined;',
    },
  ];
  const selfTestFailures = [];
  for (const selfTestCase of selfTestCases) {
    const selfTestViolations = [];
    scanSource(selfTestCase.filePath, selfTestCase.sourceText, selfTestViolations);
    if (
      !selfTestViolations.some(
        (styleViolation) => styleViolation.ruleId === selfTestCase.expectedRuleId,
      )
    ) {
      selfTestFailures.push(selfTestCase.expectedRuleId);
    }
  }
  if (selfTestFailures.length > 0) {
    process.stderr.write(`Style checker self-test missed: ${selfTestFailures.join(', ')}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `Style checker self-test passed ${selfTestCases.length} planted violation(s).\n`,
  );
};
if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}
const authoredFiles = [
  ...listAuthoredFiles(join(repositoryRoot, 'src')),
  ...listAuthoredFiles(join(repositoryRoot, 'scripts')),
  ...listAuthoredFiles(join(repositoryRoot, 'examples')),
];
const rootExamplePath = 'launch.config.example.ts';
if (existsSync(join(repositoryRoot, rootExamplePath))) authoredFiles.push(rootExamplePath);
const violations = [];
checkStyleGuide(violations);
for (const filePath of authoredFiles) {
  const sourceText = readFileSync(join(repositoryRoot, filePath), 'utf8');
  scanSource(filePath, sourceText, violations);
}
violations.sort((leftViolation, rightViolation) => {
  const pathOrder = leftViolation.filePath.localeCompare(rightViolation.filePath);
  if (pathOrder !== 0) return pathOrder;
  return leftViolation.line - rightViolation.line;
});
if (violations.length > 0) {
  for (const styleViolation of violations) {
    process.stderr.write(
      `${styleViolation.filePath}:${styleViolation.line} [${styleViolation.ruleId}] ${styleViolation.message}\n`,
    );
  }
  process.stderr.write(`Launch style check failed with ${violations.length} violation(s).\n`);
  process.exit(1);
}
process.stdout.write(
  `Launch style check passed across ${authoredFiles.length} authored file(s).\n`,
);
