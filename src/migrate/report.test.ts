import { describe, expect, it } from 'vitest';
import { renderReport } from './report.ts';
import type { MigrationResult } from '../types/migrate.ts';

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

function describeRenderReport() {
  function titlesTheReportAndNamesThePiece() {
    const reportMarkdown = renderReport(RESULT);

    expect(reportMarkdown).toContain('# Launch migration report');
    expect(reportMarkdown).toContain('EAS (eas.json)');
  }

  it('titles the report and names the source', titlesTheReportAndNamesThePiece);

  function listsTheEmittedArtifacts() {
    const reportMarkdown = renderReport(RESULT);

    expect(reportMarkdown).toContain('- `launch.config.ts`');
    expect(reportMarkdown).toContain('- `.env.example`');
  }

  it('lists the emitted artifacts', listsTheEmittedArtifacts);

  function rendersASectionPerPresentNoteLevelActionableFirst() {
    const reportMarkdown = renderReport(RESULT);

    expect(reportMarkdown).toContain('## Needs your attention');
    expect(reportMarkdown).toContain('## Mapped automatically');
    expect(reportMarkdown).toContain('## Skipped (left as-is)');
    expect(reportMarkdown).toContain('## For your information');
    expect(reportMarkdown.indexOf('## Needs your attention')).toBeLessThan(
      reportMarkdown.indexOf('## For your information'),
    );
  }

  it(
    'renders a section per present note level, actionable first',
    rendersASectionPerPresentNoteLevelActionableFirst,
  );

  function omitsSectionsWithNoNotes() {
    const reportMarkdown = renderReport({
      ...RESULT,
      notes: [{ level: 'manual', message: 'x' }],
    });

    expect(reportMarkdown).toContain('## Needs your attention');
    expect(reportMarkdown).not.toContain('## For your information');
  }

  it('omits sections with no notes', omitsSectionsWithNoNotes);
}

describe('renderReport', describeRenderReport);
