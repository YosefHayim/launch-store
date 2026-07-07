/**
 * A bounded, read-only directory walk shared by the file-based IAP probes (`apple-iap-code-reference`,
 * `apple-storekit-config`). Both need to look through an app's own source — one for product-id references,
 * one for a `.storekit` file — without ever executing user code, following symlinks out of the tree, or
 * stalling on a large monorepo. This module centralizes that traversal (skip set + `.gitignore` honoring +
 * symlink refusal + hard caps) so each probe only supplies a per-file visitor, and the safety bounds can't
 * drift between them. No glob/ignore dependency is pulled in — AGENTS.md keeps the local-only install lean.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { extname, join } from 'node:path';
import { Effect } from 'effect';

/** Always-skip directories: generated, vendored, or native build output that can't hold hand-written source. */
const BASE_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.expo',
  '.launch',
  'dist',
  'build',
  '.next',
  'coverage',
  'vendor',
  'Pods',
]);

/** Depth and file-count caps so the walk stays bounded regardless of repo size (a backstop, not the budget). */
const MAX_DEPTH = 8;
const MAX_FILES = 5000;

/**
 * Plain directory names from an app's `.gitignore`, added to the skip set so the scan honors what the
 * project already excludes (an Expo app gitignores `ios`/`android`, for instance). Deliberately simple: only
 * bare directory entries (`ios`, `/build`, `.expo/`) are honored; glob, negation, and nested-path patterns
 * are ignored, since this only needs to prune obvious generated trees, not reimplement gitignore matching.
 *
 * @param rootDir - App root whose `.gitignore` should be read.
 * @returns An Effect that succeeds with directory names to skip during source scanning.
 */
function gitignoredDirs(rootDir: string): Effect.Effect<Set<string>> {
  return Effect.gen(function* () {
    const dirs = new Set<string>();
    const path = join(rootDir, '.gitignore');
    const exists = yield* Effect.sync(() => existsSync(path));
    if (!exists) return dirs;
    const content = yield* Effect.try({
      try: () => readFileSync(path, 'utf8'),
      catch: (readFailure) => readFailure,
    }).pipe(Effect.catchAll(() => Effect.succeed('')));
    for (const raw of content.split('\n')) {
      let line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('!') || line.includes('*')) continue;
      if (line.startsWith('/')) line = line.slice(1);
      if (line.endsWith('/')) line = line.slice(0, -1);
      if (line && !line.includes('/')) dirs.add(line);
    }
    return dirs;
  });
}

/**
 * Walk `rootDir` and invoke `onFile(absolutePath, lowercasedExt)` for each regular file, skipping
 * generated/vendored/gitignored and hidden directories and never following symlinks. `onFile` returns
 * `true` to stop the walk early (it found what it needed); the walk also stops at the depth/file caps. The
 * walker reads no file contents itself — a content-scanning visitor opens (and size-limits) only the files
 * it cares about — so the cost of reading is paid only where a probe actually needs it.
 *
 * @param rootDir - App root to walk.
 * @param onFile - Effectful visitor invoked for each regular file with its extension.
 * @returns An Effect that completes after the bounded walk finishes or stops early.
 */
export function walkAppSource(
  rootDir: string,
  onFile: (filePath: string, ext: string) => Effect.Effect<boolean>,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const ignoredDirs = yield* gitignoredDirs(rootDir);
    const skip = new Set([...BASE_SKIP_DIRS, ...ignoredDirs]);
    let files = 0;

    /** Returns `true` to stop the entire walk (a global cap was hit or `onFile` asked to stop). */
    const walk = (dir: string, depth: number): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        if (depth > MAX_DEPTH) return false; // prune this branch, but keep walking elsewhere
        if (files >= MAX_FILES) return true; // global file cap — stop everything
        const entries: Dirent[] = yield* Effect.try({
          try: () => readdirSync(dir, { withFileTypes: true }),
          catch: (readFailure) => readFailure,
        }).pipe(Effect.catchAll(() => Effect.succeed([])));
        for (const entry of entries) {
          if (files >= MAX_FILES) return true;
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            if (
              !skip.has(entry.name) &&
              !entry.name.startsWith('.') &&
              (yield* walk(join(dir, entry.name), depth + 1))
            )
              return true;
            continue;
          }
          if (!entry.isFile()) continue;
          files += 1;
          if (yield* onFile(join(dir, entry.name), extname(entry.name).toLowerCase())) return true;
        }
        return false;
      });
    yield* walk(rootDir, 0);
  });
}
