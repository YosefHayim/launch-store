/**
 * Render a {@link MigrationResult} as `migration-report.md` — the durable, reviewable summary of a
 * `launch migrate` run. Shared across every migration source (EAS today, fastlane in #172): a source
 * returns its artifacts + notes, this turns them into one markdown document, most-actionable section
 * first so a reader sees what they must still do before the informational noise.
 */

import type { MigrationNoteLevel, MigrationResult, MigrationSource } from "./types.js";

/** Leading glyph per note level, shared with the terminal output for a consistent vocabulary. */
const LEVEL_GLYPH: Record<MigrationNoteLevel, string> = { mapped: "✓", manual: "~", skipped: "•", info: "ⓘ" };

/** Section heading per note level. */
const LEVEL_HEADING: Record<MigrationNoteLevel, string> = {
  manual: "Needs your attention",
  mapped: "Mapped automatically",
  skipped: "Skipped (left as-is)",
  info: "For your information",
};

/** Human label for the toolchain a migration read from. */
const SOURCE_LABEL: Record<MigrationSource, string> = { eas: "EAS (eas.json)", fastlane: "fastlane" };

/** Render order: actionable first, FYI last — matches {@link LEVEL_HEADING}'s intent. */
const LEVEL_ORDER: MigrationNoteLevel[] = ["manual", "mapped", "skipped", "info"];

/** Render a migration result as the `migration-report.md` document text. */
export function renderReport(result: MigrationResult): string {
  const lines: string[] = [
    "# Launch migration report",
    "",
    `Migrated from **${SOURCE_LABEL[result.source]}**.`,
    "",
    "## Files",
    "",
    ...result.artifacts.map((artifact) => `- \`${artifact.path}\``),
  ];

  for (const level of LEVEL_ORDER) {
    const notes = result.notes.filter((note) => note.level === level);
    if (notes.length === 0) continue;
    lines.push("", `## ${LEVEL_HEADING[level]}`, "");
    for (const note of notes) lines.push(`- ${LEVEL_GLYPH[level]} ${note.message}`);
  }

  lines.push("");
  return lines.join("\n");
}
