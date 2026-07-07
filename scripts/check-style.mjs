#!/usr/bin/env node
/**
 * Migration-aware Launch style checks that Biome cannot express cleanly.
 *
 * The allowlist starts with the first migrated slice. Expand MIGRATED_PATTERNS whenever a module is
 * converted to CODE-STYLE.md. This keeps the repo green while preventing migrated code from drifting
 * back to Promise/throw/CLI-boilerplate style.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import process from 'node:process';

const repoRoot = process.cwd();
const MIGRATED_PATTERNS = [
  'src/cli/commands/build.ts',
  'src/core/build/buildCommandInput.ts',
  'src/core/build/buildCommandProgram.ts',
  'src/core/adopt/profileEntitlements.ts',
  'src/core/config/schema.ts',
  'src/core/release/confirmation.ts',
  'src/core/types/index.ts',
  'src/core/readiness',
];

const CHECKS = [
  {
    name: 'no async/await in migrated production code',
    pattern: /\basync\b|\bawait\b/,
    message: 'Return Effect values and compose them with Effect.gen / Effect.forEach.',
  },
  {
    name: 'no Promise.all in migrated production code',
    pattern: /\bPromise\.all\s*\(/,
    message: 'Use Effect.all or Effect.forEach(..., { concurrency }).',
  },
  {
    name: 'no try/catch/finally in migrated production code',
    pattern: /\btry\s*\{|\bcatch\s*\(|\bfinally\s*\{/,
    message: 'Use Effect.try, Effect.catchAll, and Effect.acquireRelease.',
  },
  {
    name: 'no raw throw new Error in migrated production code',
    pattern: /\bthrow\s+new\s+Error\b/,
    message: 'Use Data.TaggedError + Effect.fail.',
  },
  {
    name: 'no direct Clack imports in core',
    pattern: /from ['"]@clack\/prompts['"]/,
    message: 'Depend on PromptService; Clack belongs in its live layer.',
  },
  {
    name: 'no ritual abbreviations',
    pattern: /\b(ctx|cfg|res|req|opts|acc|curr)\b/,
    message: 'Use prose names that say what the value represents.',
  },
];

/**
 * Decide whether a path is a production TypeScript file the migration checks should scan.
 *
 * @param filePath - Repo-relative path being considered.
 * @returns True when the path is a non-test TypeScript file.
 */
const isTypeScriptFile = (filePath) => filePath.endsWith('.ts') && !filePath.endsWith('.test.ts');

/**
 * Read the closest leading TSDoc block for a function-like AST node.
 *
 * @param source - Full source text for the file.
 * @param node - Function-like node whose leading comments should be inspected.
 * @returns The TSDoc block text when one exists.
 */
const getLeadingTSDoc = (source, node) => {
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) ?? [];
  const tsdocRange = ranges.findLast((range) => source.startsWith('/**', range.pos));
  return tsdocRange ? source.slice(tsdocRange.pos, tsdocRange.end) : undefined;
};

/**
 * Count runtime-parameter documentation tags inside a TSDoc block.
 *
 * @param tsdoc - TSDoc block text to inspect.
 * @returns Number of `@param` tags in the block.
 */
const parameterTagCount = (tsdoc) => (tsdoc.match(/@param\b/g) ?? []).length;

/**
 * Resolve the syntax node that should carry TSDoc for a function-like declaration.
 *
 * @param node - Function-like node discovered during AST traversal.
 * @returns The node where leading TSDoc is expected.
 */
const getFunctionDocNode = (node) => {
  if (ts.isFunctionDeclaration(node)) {
    return node;
  }
  if (ts.isVariableDeclaration(node)) {
    return node.parent.parent;
  }
  return node;
};

/**
 * Render a readable function name for diagnostics.
 *
 * @param node - Function-like node discovered during AST traversal.
 * @param sourceFile - Parsed TypeScript source file used to render node text.
 * @returns A function name suitable for human-facing lint output.
 */
const functionName = (node, sourceFile) => {
  if (ts.isFunctionDeclaration(node)) {
    return node.name?.getText(sourceFile) ?? '<anonymous function>';
  }
  if (ts.isVariableDeclaration(node)) {
    return node.name.getText(sourceFile);
  }
  if (ts.isMethodDeclaration(node)) {
    return node.name.getText(sourceFile);
  }
  return '<function>';
};

/**
 * Check whether a function declaration lives directly at module scope.
 *
 * @param node - AST node being inspected.
 * @param sourceFile - Parsed TypeScript source file that owns the top-level scope.
 * @returns True when the node is a top-level function declaration.
 */
const isTopLevelFunctionDeclaration = (node, sourceFile) =>
  ts.isFunctionDeclaration(node) && node.parent === sourceFile;

/**
 * Check whether a variable declaration is a module-scope function value.
 *
 * @param node - AST node being inspected.
 * @returns True when the declaration initializes a top-level arrow or function expression.
 */
const isTopLevelFunctionVariable = (node) =>
  ts.isVariableDeclaration(node) &&
  node.parent.parent.parent.kind === ts.SyntaxKind.SourceFile &&
  Boolean(node.initializer) &&
  (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer));

/**
 * Check whether a method belongs to a module-scope provider or service object literal.
 *
 * @param node - AST node being inspected.
 * @returns True when the node is a function-valued member of a top-level object literal.
 */
const isTopLevelObjectMethod = (node) => {
  if (!(ts.isMethodDeclaration(node) || ts.isPropertyAssignment(node))) {
    return false;
  }
  if (
    ts.isPropertyAssignment(node) &&
    !(
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    )
  ) {
    return false;
  }
  const objectLiteral = node.parent;
  if (!ts.isObjectLiteralExpression(objectLiteral)) {
    return false;
  }
  const variableDeclaration = objectLiteral.parent;
  return (
    ts.isVariableDeclaration(variableDeclaration) &&
    variableDeclaration.parent.parent.parent.kind === ts.SyntaxKind.SourceFile
  );
};

/**
 * Read runtime parameters from any supported function-like declaration shape.
 *
 * @param node - Function-like node discovered during AST traversal.
 * @returns The runtime parameter declarations for the function.
 */
const functionParameters = (node) => {
  if (ts.isVariableDeclaration(node)) {
    return node.initializer?.parameters ?? [];
  }
  if (ts.isPropertyAssignment(node)) {
    if (!node.initializer) {
      return [];
    }
    if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
      return node.initializer.parameters;
    }
    return [];
  }
  return node.parameters ?? [];
};

/**
 * Decide whether a function-like node is inside the migrated TSDoc policy surface.
 *
 * @param node - Function-like node discovered during AST traversal.
 * @param sourceFile - Parsed TypeScript source file that owns the top-level scope.
 * @returns True when the function must include complete TSDoc.
 */
const functionNeedsDocs = (node, sourceFile) =>
  isTopLevelFunctionDeclaration(node, sourceFile) ||
  isTopLevelFunctionVariable(node) ||
  isTopLevelObjectMethod(node);

/**
 * Find nested ternaries in one TypeScript source file.
 *
 * @param filePath - Repo-relative file path used for parser context.
 * @param source - Full source text for the file.
 * @returns Nested-ternary violations with line numbers and messages.
 */
const findNestedTernaryViolations = (filePath, source) => {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations = [];

  const containsConditionalExpression = (node) => {
    let found = false;

    const visit = (child) => {
      if (found) {
        return;
      }
      if (ts.isConditionalExpression(child)) {
        found = true;
        return;
      }
      ts.forEachChild(child, visit);
    };

    ts.forEachChild(node, visit);
    return found;
  };

  const visit = (node) => {
    if (ts.isConditionalExpression(node) && containsConditionalExpression(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        line: line + 1,
        name: 'no nested ternary',
        message: 'Use guard clauses, switch, or a named domain lookup table.',
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};

/**
 * Find missing or incomplete TSDoc on migrated function-like declarations.
 *
 * @param filePath - Repo-relative file path used for parser context.
 * @param source - Full source text for the file.
 * @returns Function documentation violations with line numbers and messages.
 */
const findFunctionDocViolations = (filePath, source) => {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations = [];

  const visit = (node) => {
    if (functionNeedsDocs(node, sourceFile)) {
      const documentedNode = getFunctionDocNode(node);
      const tsdoc = getLeadingTSDoc(source, documentedNode);
      const name = functionName(node, sourceFile);
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const parameters = functionParameters(node);

      if (!tsdoc) {
        violations.push({
          line: line + 1,
          name: 'missing complete function TSDoc',
          message: `${name} needs TSDoc with purpose, @param tags, and @returns.`,
        });
      } else if (!tsdoc.includes('@returns')) {
        violations.push({
          line: line + 1,
          name: 'missing @returns in function TSDoc',
          message: `${name} must document its returned value or returned Effect with @returns.`,
        });
      } else if (parameters.length > 0 && parameterTagCount(tsdoc) < parameters.length) {
        violations.push({
          line: line + 1,
          name: 'missing @param in function TSDoc',
          message: `${name} must document every runtime parameter with @param.`,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};

/**
 * Recursively list production TypeScript files under a migrated path.
 *
 * @param path - Repo-relative file or directory path to scan.
 * @returns Repo-relative production TypeScript file paths.
 */
const listFiles = (path) => {
  const absolutePath = join(repoRoot, path);
  if (!existsSync(absolutePath)) {
    return [];
  }
  const entries = readdirSync(absolutePath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      return listFiles(child);
    }
    return isTypeScriptFile(child) ? [child] : [];
  });
};

const migratedFiles = MIGRATED_PATTERNS.flatMap((pattern) => {
  const absolutePath = join(repoRoot, pattern);
  if (!existsSync(absolutePath)) {
    return [];
  }
  return isTypeScriptFile(pattern) ? [pattern] : listFiles(pattern);
});

const violations = [];

for (const filePath of migratedFiles) {
  const source = readFileSync(join(repoRoot, filePath), 'utf8');
  for (const check of CHECKS) {
    if (check.pattern.test(source)) {
      violations.push({ filePath, check });
    }
  }

  for (const docViolation of findFunctionDocViolations(filePath, source)) {
    violations.push({
      filePath,
      line: docViolation.line,
      check: {
        name: docViolation.name,
        message: docViolation.message,
      },
    });
  }

  for (const nestedTernaryViolation of findNestedTernaryViolations(filePath, source)) {
    violations.push({
      filePath,
      line: nestedTernaryViolation.line,
      check: {
        name: nestedTernaryViolation.name,
        message: nestedTernaryViolation.message,
      },
    });
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    const location = violation.line
      ? `${relative(repoRoot, join(repoRoot, violation.filePath))}:${violation.line}`
      : relative(repoRoot, join(repoRoot, violation.filePath));
    process.stderr.write(`${location} ${violation.check.name}: ${violation.check.message}\n`);
  }
  process.exit(1);
}

process.stdout.write(`Launch style-check passed (${migratedFiles.length} migrated file(s)).\n`);
