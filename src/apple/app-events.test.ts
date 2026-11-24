import { describe, expect, it, vi } from 'vitest';
import type { AppEventLocalizationInput, NewAppEvent } from '../types/apple-catalog.ts';
import { AppEvents, type AscAppEventsApi } from './app-events.ts';

function readThrownMessage(cause: unknown): string | null {
  const isError = cause instanceof Error;

  if (isError) {
    return cause.message;
  }

  const isMissing = cause == null;

  if (isMissing) return null;

  const isNotObject = typeof cause != 'object';

  if (isNotObject) return null;

  const fields = Object.entries(cause);

  for (const field of fields) {
    const message = readMessageField(field[0], field[1]);

    const hasMessage = message != null;

    if (hasMessage) return message;
  }

  return null;
}

function readMessageField(fieldName: string | undefined, fieldText: unknown): string | null {
  const isNotMessage = fieldName != 'message';

  if (isNotMessage) return null;

  const isText = typeof fieldText == 'string';

  if (isText) return fieldText;

  return null;
}

async function captureThrown(work: Promise<unknown>): Promise<{ message: string }> {
  try {
    await work;
  } catch (cause) {
    const message = readThrownMessage(cause);

    const isMissingMessage = message == null;

    if (isMissingMessage) throw new Error('expected a failure');

    return { message };
  }

  throw new Error('expected a failure');
}

/** A stubbed {@link AscAppEventsApi}: one app, no events; writes echo their input. Override per test. */
function makeApi(overrides: Partial<AscAppEventsApi> = {}): AscAppEventsApi {
  function mockCall() {
    return Promise.resolve('app1');
  }

  function mockCall2() {
    return Promise.resolve([]);
  }

  function mockCall3() {
    return Promise.resolve([]);
  }

  function mockImplementationAppId(_appId: string, attributes: NewAppEvent) {
    return Promise.resolve({ id: 'evt-new', eventState: 'DRAFT', ...attributes });
  }

  function mockCall4() {
    return Promise.resolve();
  }

  function mockImplementationEventId(
    _eventId: string,
    locale: string,
    attributes: AppEventLocalizationInput,
  ) {
    return Promise.resolve({ id: 'loc-new', locale, ...attributes });
  }

  function mockImplementationId(id: string, attributes: AppEventLocalizationInput) {
    return Promise.resolve({ id, locale: '', ...attributes });
  }

  const base: AscAppEventsApi = {
    getAppId: vi.fn(mockCall),
    listAppEvents: vi.fn(mockCall2),
    listAppEventLocalizations: vi.fn(mockCall3),
    createAppEvent: vi.fn().mockImplementation(mockImplementationAppId),
    deleteAppEvent: vi.fn(mockCall4),
    createAppEventLocalization: vi.fn().mockImplementation(mockImplementationEventId),
    updateAppEventLocalization: vi.fn().mockImplementation(mockImplementationId),
  };

  return { ...base, ...overrides };
}

function describeListEvents() {
  async function pairsEachEventWithItsLocalizations() {
    function mockCall5() {
      return Promise.resolve([{ id: 'e1', referenceName: 'Summer' }]);
    }

    function mockImplementationPiece() {
      return Promise.resolve([{ id: 'l1', locale: 'en-US', name: 'Summer Sale' }]);
    }

    const api = makeApi({
      listAppEvents: vi.fn(mockCall5),
      listAppEventLocalizations: vi.fn().mockImplementation(mockImplementationPiece),
    });
    const found = await new AppEvents(api).list('com.acme.app');

    expect(found).toHaveLength(1);
    expect(found[0]?.event.referenceName).toBe('Summer');
    expect(found[0]?.localizations).toHaveLength(1);
    expect(api.listAppEventLocalizations).toHaveBeenCalledWith('e1');
  }

  it('pairs each event with its localizations', pairsEachEventWithItsLocalizations);

  async function throwsAnActionableErrorWhenTheAppHasNoAppStoreConnectPiece() {
    function mockCall6() {
      return Promise.resolve(null);
    }

    const api = makeApi({ getAppId: vi.fn(mockCall6) });
    const events = new AppEvents(api).list('com.acme.app');
    const missingApp = await captureThrown(events);

    expect(missingApp.message).toContain('No App Store Connect app record');
  }

  it(
    'throws an actionable error when the app has no App Store Connect record',
    throwsAnActionableErrorWhenTheAppHasNoAppStoreConnectPiece,
  );
}

describe('listEvents', describeListEvents);

function describeCreateEvent() {
  async function createsWithATrimmedNameAndUpperCasedValidatedEnums() {
    const api = makeApi();

    await new AppEvents(api).create('com.acme.app', {
      referenceName: ' Summer Sale ',
      badge: 'live_event',
      priority: 'high',
      purpose: 'attract_new_users',
      primaryLocale: 'en-US',
      deepLink: ' myapp://summer ',
    });
    expect(api.createAppEvent).toHaveBeenCalledWith('app1', {
      referenceName: 'Summer Sale',
      badge: 'LIVE_EVENT',
      primaryLocale: 'en-US',
      deepLink: 'myapp://summer',
      priority: 'HIGH',
      purpose: 'ATTRACT_NEW_USERS',
    });
  }

  it(
    'creates with a trimmed name and upper-cased, validated enums',
    createsWithATrimmedNameAndUpperCasedValidatedEnums,
  );

  async function rejectsAnEmptyReferenceName() {
    const api = makeApi();
    const event = new AppEvents(api).create('com.acme.app', { referenceName: '  ' });
    const invalidEvent = await captureThrown(event);
    expect(invalidEvent.message).toContain('reference name is required');
  }

  it('rejects an empty reference name', rejectsAnEmptyReferenceName);

  async function rejectsAnUnknownBadgeWithTheValidList() {
    const api = makeApi();
    const event = new AppEvents(api).create('com.acme.app', {
      referenceName: 'X',
      badge: 'MEGA_EVENT',
    });
    const invalidBadge = await captureThrown(event);

    expect(invalidBadge.message).toContain('Invalid badge "MEGA_EVENT"');
  }

  it('rejects an unknown badge with the valid list', rejectsAnUnknownBadgeWithTheValidList);

  async function rejectsAnUnknownPriority() {
    const api = makeApi();
    const event = new AppEvents(api).create('com.acme.app', {
      referenceName: 'X',
      priority: 'URGENT',
    });
    const invalidPriority = await captureThrown(event);
    expect(invalidPriority.message).toContain('Invalid priority');
  }

  it('rejects an unknown priority', rejectsAnUnknownPriority);

  async function rejectsAnUnknownPurpose() {
    const api = makeApi();
    const event = new AppEvents(api).create('com.acme.app', {
      referenceName: 'X',
      purpose: 'FOR_FUN',
    });
    const invalidPurpose = await captureThrown(event);
    expect(invalidPurpose.message).toContain('Invalid purpose');
  }

  it('rejects an unknown purpose', rejectsAnUnknownPurpose);

  async function throwsWhenTheAppHasNoPieceAfterValidationPasses() {
    function mockCall7() {
      return Promise.resolve(null);
    }

    const api = makeApi({ getAppId: vi.fn(mockCall7) });
    const event = new AppEvents(api).create('com.acme.app', { referenceName: 'X' });
    const missingApp = await captureThrown(event);

    expect(missingApp.message).toContain('No App Store Connect app record');
    expect(api.createAppEvent).not.toHaveBeenCalled();
  }

  it(
    'throws when the app has no record (after validation passes)',
    throwsWhenTheAppHasNoPieceAfterValidationPasses,
  );
}

describe('createEvent', describeCreateEvent);

function describeLocalizeEvent() {
  async function createsALocalizationWhenNoneExistsForTheLocale() {
    const api = makeApi();
    const localizationOutcome = await new AppEvents(api).localize('e1', {
      locale: 'en-US',
      name: 'Hello',
    });

    expect(localizationOutcome.replaced).toBe(false);
    expect(api.createAppEventLocalization).toHaveBeenCalledWith('e1', 'en-US', { name: 'Hello' });
    expect(api.updateAppEventLocalization).not.toHaveBeenCalled();
  }

  it(
    'creates a localization when none exists for the locale',
    createsALocalizationWhenNoneExistsForTheLocale,
  );

  async function updatesTheExistingLocalizationCaseInsensitiveAndCarriesTheLocaleThrough() {
    function mockImplementationPiece2() {
      return Promise.resolve([{ id: 'l9', locale: 'en-US', name: 'Old' }]);
    }

    const api = makeApi({
      listAppEventLocalizations: vi.fn().mockImplementation(mockImplementationPiece2),
    });
    const localizationOutcome = await new AppEvents(api).localize('e1', {
      locale: 'EN-us',
      name: 'New',
    });

    expect(localizationOutcome.replaced).toBe(true);
    expect(localizationOutcome.localization.locale).toBe('en-US');
    expect(api.updateAppEventLocalization).toHaveBeenCalledWith('l9', { name: 'New' });
    expect(api.createAppEventLocalization).not.toHaveBeenCalled();
  }

  it(
    'updates the existing localization (case-insensitive) and carries the locale through',
    updatesTheExistingLocalizationCaseInsensitiveAndCarriesTheLocaleThrough,
  );

  async function rejectsAnEmptyLocale() {
    const api = makeApi();
    const invalidLocale = await captureThrown(
      new AppEvents(api).localize('e1', { locale: '  ', name: 'x' }),
    );

    expect(invalidLocale.message).toContain('locale is required');
  }

  it('rejects an empty locale', rejectsAnEmptyLocale);

  async function rejectsWhenNoCopyFieldsAreProvided() {
    const api = makeApi();
    const missingCopy = await captureThrown(new AppEvents(api).localize('e1', { locale: 'en-US' }));
    expect(missingCopy.message).toContain('at least one of');
  }

  it('rejects when no copy fields are provided', rejectsWhenNoCopyFieldsAreProvided);
}

describe('localizeEvent', describeLocalizeEvent);

function describeDeleteEvent() {
  async function deletesTheEventById() {
    const api = makeApi();
    await new AppEvents(api).delete('e1');
    expect(api.deleteAppEvent).toHaveBeenCalledWith('e1');
  }

  it('deletes the event by id', deletesTheEventById);
}

describe('deleteEvent', describeDeleteEvent);
