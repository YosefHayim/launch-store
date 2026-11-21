import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { renderReport } from './report.js';
import type { MigrationResult } from '../types/migrate.js';
/** A result exercising every note level plus a couple of artifacts. */
const RESULT: MigrationResult = {
  source: 'eas',
  artifacts: [
    { path: 'launch.config.ts', contents: '' },
    { path: '.env.example', contents: '' },
  ],
  notes: [
    { level: 'mapped', message: 'Build profile mapped.' },
    { level: 'manual', message: 'Configure your Apple key.' },
    { level: 'skipped', message: 'store.config.json kept.' },
    { level: 'info', message: 'Detected bundle id.' },
  ],
};
describe('renderReport', () => {
  const renderMigrationReport = (migration: MigrationResult) =>
    Effect.runSync(renderReport(migration));
  it('titles the report and names the source', () => {
    const reportMarkdown = renderMigrationReport(RESULT);
    expect(reportMarkdown).toContain('# Launch migration report');
    expect(reportMarkdown).toContain('EAS (eas.json)');
  });
  it('lists the emitted artifacts', () => {
    const reportMarkdown = renderMigrationReport(RESULT);
    expect(reportMarkdown).toContain('- `launch.config.ts`');
    expect(reportMarkdown).toContain('- `.env.example`');
  });
  it('renders a section per present note level, actionable first', () => {
    const reportMarkdown = renderMigrationReport(RESULT);
    expect(reportMarkdown).toContain('## Needs your attention');
    expect(reportMarkdown).toContain('## Mapped automatically');
    expect(reportMarkdown).toContain('## Skipped (left as-is)');
    expect(reportMarkdown).toContain('## For your information');
    expect(reportMarkdown.indexOf('## Needs your attention')).toBeLessThan(
      reportMarkdown.indexOf('## For your information'),
    );
  });
  it('omits sections with no notes', () => {
    const reportMarkdown = renderMigrationReport({
      ...RESULT,
      notes: [{ level: 'manual', message: 'x' }],
    });
    expect(reportMarkdown).toContain('## Needs your attention');
    expect(reportMarkdown).not.toContain('## For your information');
  });
});
