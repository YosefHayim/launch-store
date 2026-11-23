import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));

function javascriptPath(specifier) {
  const insideSrc = specifier.slice(2);

  if (insideSrc.endsWith('.tsx')) {
    return `${insideSrc.slice(0, -4)}.js`;
  }

  if (insideSrc.endsWith('.mts')) {
    return `${insideSrc.slice(0, -4)}.mjs`;
  }

  if (insideSrc.endsWith('.ts')) {
    return `${insideSrc.slice(0, -3)}.js`;
  }

  return insideSrc;
}

function relativeSpecifier(fromFile, specifier) {
  const targetPath = path.join(distRoot, javascriptPath(specifier));
  const fromDirectory = path.dirname(fromFile);
  let relativePath = path.relative(fromDirectory, targetPath);
  const isNotRelative = relativePath.startsWith('.') == false;

  if (isNotRelative) {
    relativePath = `./${relativePath}`;
  }

  return relativePath.split(path.sep).join('/');
}

function rewriteModuleText(filePath, moduleText) {
  function replaceQuotedAlias(quoted, quote, specifier) {
    const isAlias = specifier.startsWith('@/');

    if (isAlias == false) {
      return quoted;
    }

    const relativePath = relativeSpecifier(filePath, specifier);

    return `${quote}${relativePath}${quote}`;
  }

  // Quoted @/ specifiers left by tsc, which does not rewrite path aliases.
  return moduleText.replace(/(['"])(@\/[^'"]+)\1/g, replaceQuotedAlias);
}

async function listEmittedFiles(directory) {
  const directoryChildren = await readdir(directory, { withFileTypes: true });
  const emittedFiles = [];

  for (const directoryChild of directoryChildren) {
    const childPath = path.join(directory, directoryChild.name);
    const isDirectory = directoryChild.isDirectory();

    if (isDirectory) {
      const nestedFiles = await listEmittedFiles(childPath);

      emittedFiles.push(...nestedFiles);
      continue;
    }

    const isDeclaration = directoryChild.name.endsWith('.d.ts');

    if (isDeclaration) {
      emittedFiles.push(childPath);
      continue;
    }

    const isJavaScript = directoryChild.name.endsWith('.js');

    if (isJavaScript) {
      emittedFiles.push(childPath);
    }
  }

  return emittedFiles;
}

const emittedFiles = await listEmittedFiles(distRoot);
let rewrittenFileCount = 0;

for (const emittedFile of emittedFiles) {
  const moduleText = await readFile(emittedFile, 'utf8');
  const rewrittenText = rewriteModuleText(emittedFile, moduleText);
  const isUnchanged = rewrittenText == moduleText;

  if (isUnchanged) {
    continue;
  }

  await writeFile(emittedFile, rewrittenText);
  rewrittenFileCount += 1;
}

console.log(`rewrote @/ imports in ${rewrittenFileCount} files`);
