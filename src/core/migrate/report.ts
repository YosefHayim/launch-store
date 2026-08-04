import { Effect } from 'effect';
import type { MigrationNoteLevel, MigrationResult, MigrationSource } from '../types/migrate.js';

const LEVEL_LABEL: Record<MigrationNoteLevel, string> = {
  mapped: 'OK',
  manual: 'MANUAL',
  skipped: 'SKIP',
  info: 'INFO',
};

const LEVEL_HEADING: Record<MigrationNoteLevel, string> = {
  manual: 'Needs your attention',
  mapped: 'Mapped automatically',
  skipped: 'Skipped (left as-is)',
  info: 'For your information',
};

const SOURCE_LABEL: Record<MigrationSource, string> = {
  eas: 'EAS (eas.json)',
  fastlane: 'fastlane',
};

const LEVEL_ORDER: MigrationNoteLevel[] = ['manual', 'mapped', 'skipped', 'info'];

/** Render a migration as the migration-report.md document. */
export const renderReport = (migration: MigrationResult): Effect.Effect<string> =>
  Effect.sync(() => {
    const reportLines: string[] = [
      '# Launch migration report',
      '',
      `Migrated from **${SOURCE_LABEL[migration.source]}**.`,
      '',
      '## Files',
      '',
      ...migration.artifacts.map((migrationArtifact) => `- \`${migrationArtifact.path}\``),
    ];
    for (const noteLevel of LEVEL_ORDER) {
      const levelNotes = migration.notes.filter(
        (migrationNote) => migrationNote.level === noteLevel,
      );
      if (levelNotes.length === 0) continue;
      reportLines.push('', `## ${LEVEL_HEADING[noteLevel]}`, '');
      for (const migrationNote of levelNotes) {
        reportLines.push(`- ${LEVEL_LABEL[noteLevel]} ${migrationNote.message}`);
      }
    }
    reportLines.push('');
    return reportLines.join('\n');
  });
