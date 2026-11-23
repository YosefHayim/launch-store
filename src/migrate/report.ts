// Renders the migration report of what Launch mapped, skipped, or left to do by hand.

import type { MigrationNoteLevel, MigrationResult, MigrationSource } from '../types/migrate.ts';

const levelLabel: Record<MigrationNoteLevel, string> = {
  mapped: 'OK',
  manual: 'MANUAL',
  skipped: 'SKIP',
  info: 'INFO',
};

const levelHeading: Record<MigrationNoteLevel, string> = {
  manual: 'Needs your attention',
  mapped: 'Mapped automatically',
  skipped: 'Skipped (left as-is)',
  info: 'For your information',
};

const sourceLabel: Record<MigrationSource, string> = {
  eas: 'EAS (eas.json)',
  fastlane: 'fastlane',
};

const levelOrder: MigrationNoteLevel[] = ['manual', 'mapped', 'skipped', 'info'];

/** Render a migration as the migration-report.md document. */
export function renderReport(migration: MigrationResult): string {
  const reportLines: string[] = [
    '# Launch migration report',
    '',
    `Migrated from **${sourceLabel[migration.source]}**.`,
    '',
    '## Files',
    '',
  ];

  for (const migrationArtifact of migration.artifacts) {
    reportLines.push(`- \`${migrationArtifact.path}\``);
  }

  for (const noteLevel of levelOrder) {
    const levelNotes = migration.notes.filter(function noteMatchesLevel(migrationNote) {
      return migrationNote.level == noteLevel;
    });

    const hasNoNotes = levelNotes.length == 0;

    if (hasNoNotes) {
      continue;
    }

    reportLines.push('', `## ${levelHeading[noteLevel]}`, '');

    for (const migrationNote of levelNotes) {
      reportLines.push(`- ${levelLabel[noteLevel]} ${migrationNote.message}`);
    }
  }

  reportLines.push('');

  return reportLines.join('\n');
}
