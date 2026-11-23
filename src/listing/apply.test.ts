import { describe, expect, it } from 'vitest';
import type { AppleLocaleInfo, StoreConfig } from '../store/shared/store-config.ts';
import {
  applyDraft,
  briefFor,
  clampDraft,
  deriveAndroidLocale,
  renderDraftPreview,
} from './apply.ts';
import type { DraftListing } from '../types/listing.ts';

function describeClampDraft() {
  function passesThroughFieldsWithinTheirLimitsAndReportsNoWarnings() {
    const { draft, warnings } = clampDraft({ title: 'Focus Timer', subtitle: 'Stay on task' });
    expect(draft).toEqual({ title: 'Focus Timer', subtitle: 'Stay on task' });
    expect(warnings).toEqual([]);
  }

  it(
    'passes through fields within their limits and reports no warnings',
    passesThroughFieldsWithinTheirLimitsAndReportsNoWarnings,
  );

  function trimsAnOverLengthTitleAndWarns() {
    const { draft, warnings } = clampDraft({ title: 'x'.repeat(40) });
    expect(draft.title).toHaveLength(30);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('title');
  }

  it('trims an over-length title and warns', trimsAnOverLengthTitleAndWarns);

  function keepsOnlyTheKeywordsThatFitTheCommaJoined100CharBudget() {
    function fromPiece(_: unknown, index: number) {
      return `keyword${index}`;
    }

    const keywords = Array.from({ length: 20 }, fromPiece);
    const { draft, warnings } = clampDraft({ keywords });

    expect(draft.keywords?.length).toBeLessThan(keywords.length);
    expect(draft.keywords?.join(', ').length).toBeLessThanOrEqual(100);
    expect(warnings[0]).toContain('keywords');
  }

  it(
    'keeps only the keywords that fit the comma-joined 100-char budget',
    keepsOnlyTheKeywordsThatFitTheCommaJoined100CharBudget,
  );

  function omitsAnEmptyAfterClampKeywordListRatherThanWritingAnEmptyArray() {
    const { draft } = clampDraft({ keywords: ['a'.repeat(200)] });
    expect(draft.keywords).toBeUndefined();
  }

  it(
    'omits an empty-after-clamp keyword list rather than writing an empty array',
    omitsAnEmptyAfterClampKeywordListRatherThanWritingAnEmptyArray,
  );
}

describe('clampDraft', describeClampDraft);

function describeBriefFor() {
  function seedsAboutFromTheOverrideWhenGiven() {
    const brief = briefFor('en-US', 'MyApp', undefined, 'A focus timer');
    expect(brief).toEqual({ locale: 'en-US', appName: 'MyApp', about: 'A focus timer' });
  }

  it('seeds `about` from the override when given', seedsAboutFromTheOverrideWhenGiven);

  function fallsBackToTheCurrentPromotionalPieceThenSubtitleAndCarriesExistingKeywords() {
    const current: AppleLocaleInfo = { subtitle: 'Old subtitle', keywords: ['focus', 'timer'] };
    const brief = briefFor('fr-FR', 'MyApp', current, undefined);

    expect(brief.about).toBe('Old subtitle');
    expect(brief.keywords).toEqual(['focus', 'timer']);
    expect(brief.current).toBe(current);
  }

  it(
    'falls back to the current promotional text, then subtitle, and carries existing keywords',
    fallsBackToTheCurrentPromotionalPieceThenSubtitleAndCarriesExistingKeywords,
  );

  function leavesOptionalFieldsAbsentWhenThereSNoSeed() {
    expect(briefFor('en-US', 'MyApp', undefined, undefined)).toEqual({
      locale: 'en-US',
      appName: 'MyApp',
    });
  }

  it(
    "leaves optional fields absent when there's no seed",
    leavesOptionalFieldsAbsentWhenThereSNoSeed,
  );
}

describe('briefFor', describeBriefFor);

function describeDeriveAndroidLocale() {
  function mapsTitleDescriptionAcrossAndBorrowsTheSubtitleForTheShortDescription() {
    const android = deriveAndroidLocale({
      title: 'MyApp',
      subtitle: 'Stay on task',
      description: 'Long copy.',
    });

    expect(android).toEqual({
      title: 'MyApp',
      shortDescription: 'Stay on task',
      fullDescription: 'Long copy.',
    });
  }

  it(
    'maps title/description across and borrows the subtitle for the short description',
    mapsTitleDescriptionAcrossAndBorrowsTheSubtitleForTheShortDescription,
  );

  function fallsBackToPromotionalPieceAndClampsTheShortDescriptionTo80Chars() {
    const android = deriveAndroidLocale({ promotionalText: 'p'.repeat(120) });
    expect(android.shortDescription).toHaveLength(80);
  }

  it(
    'falls back to promotional text and clamps the short description to 80 chars',
    fallsBackToPromotionalPieceAndClampsTheShortDescriptionTo80Chars,
  );
}

describe('deriveAndroidLocale', describeDeriveAndroidLocale);

function describeApplyDraft() {
  const draft: DraftListing = { title: 'New Title', keywords: ['focus'] };

  function mergesIntoTheTargetedLocalePreservingOtherFieldsAndOtherLocales() {
    const config: StoreConfig = {
      apple: { info: { 'en-US': { subtitle: 'Keep me' }, 'fr-FR': { title: 'Bonjour' } } },
    };
    const next = applyDraft(config, 'en-US', draft, { ios: true, android: false });

    expect(next.apple?.info['en-US']).toEqual({
      subtitle: 'Keep me',
      title: 'New Title',
      keywords: ['focus'],
    });
    expect(next.apple?.info['fr-FR']).toEqual({ title: 'Bonjour' });
  }

  it(
    'merges into the targeted locale, preserving other fields and other locales',
    mergesIntoTheTargetedLocalePreservingOtherFieldsAndOtherLocales,
  );

  function doesNotMutateThePiecePiece() {
    const config: StoreConfig = { apple: { info: { 'en-US': {} } } };
    applyDraft(config, 'en-US', draft, { ios: true, android: false });
    expect(config.apple?.info['en-US']).toEqual({});
  }

  it('does not mutate the input config', doesNotMutateThePiecePiece);

  function writesTheDerivedAndroidSectionWhenAndroidIsTargeted() {
    const next = applyDraft(
      {},
      'en-US',
      { title: 'MyApp', description: 'Long.' },
      { ios: false, android: true },
    );

    expect(next.apple).toBeUndefined();
    expect(next.android?.info['en-US']).toEqual({ title: 'MyApp', fullDescription: 'Long.' });
  }

  it(
    'writes the derived android section when android is targeted',
    writesTheDerivedAndroidSectionWhenAndroidIsTargeted,
  );
}

describe('applyDraft', describeApplyDraft);

function describeRenderDraftPreview() {
  function showsIOSFieldsWithCharacterBudgetsAndSurfacesWarnings() {
    const preview = renderDraftPreview(
      [
        {
          locale: 'en-US',
          draft: { title: 'MyApp', keywords: ['a', 'b'] },
          warnings: ['title was trimmed'],
        },
      ],
      { ios: true, android: false },
    );

    expect(preview).toContain('en-US');
    expect(preview).toContain('(5/30)');
    expect(preview).toContain('a, b');
    expect(preview).toContain('WARN title was trimmed');
  }

  it(
    'shows iOS fields with character budgets and surfaces warnings',
    showsIOSFieldsWithCharacterBudgetsAndSurfacesWarnings,
  );

  function includesTheDerivedAndroidBlockWhenAndroidIsTargeted() {
    const preview = renderDraftPreview(
      [{ locale: 'en-US', draft: { title: 'MyApp', subtitle: 'Short' }, warnings: [] }],
      { ios: false, android: true },
    );

    expect(preview).toContain('android');
    expect(preview).toContain('short desc');
  }

  it(
    'includes the derived android block when android is targeted',
    includesTheDerivedAndroidBlockWhenAndroidIsTargeted,
  );
}

describe('renderDraftPreview', describeRenderDraftPreview);
