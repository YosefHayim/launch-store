import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { AppEventLocalizationInput, NewAppEvent } from '../types/appleCatalog.js';
import {
  createEvent,
  deleteEvent,
  listEvents,
  localizeEvent,
  type AscAppEventsApi,
} from './appEvents.js';
/** A stubbed {@link AscAppEventsApi}: one app, no events; writes echo their input. Override per test. */
const makeApi = (overrides: Partial<AscAppEventsApi> = {}): AscAppEventsApi => {
  const base: AscAppEventsApi = {
    getAppId: vi.fn(() => Effect.succeed('app1')),
    listAppEvents: vi.fn(() => Effect.succeed([])),
    listAppEventLocalizations: vi.fn(() => Effect.succeed([])),
    createAppEvent: vi
      .fn()
      .mockImplementation((_appId: string, attributes: NewAppEvent) =>
        Effect.succeed({ id: 'evt-new', eventState: 'DRAFT', ...attributes }),
      ),
    deleteAppEvent: vi.fn(() => Effect.void),
    createAppEventLocalization: vi
      .fn()
      .mockImplementation(
        (_eventId: string, locale: string, attributes: AppEventLocalizationInput) =>
          Effect.succeed({ id: 'loc-new', locale, ...attributes }),
      ),
    updateAppEventLocalization: vi
      .fn()
      .mockImplementation((id: string, attributes: AppEventLocalizationInput) =>
        Effect.succeed({ id, locale: '', ...attributes }),
      ),
  };
  return { ...base, ...overrides };
};
describe('listEvents', () => {
  it('pairs each event with its localizations', async () => {
    const api = makeApi({
      listAppEvents: vi.fn(() => Effect.succeed([{ id: 'e1', referenceName: 'Summer' }])),
      listAppEventLocalizations: vi
        .fn()
        .mockImplementation(() =>
          Effect.succeed([{ id: 'l1', locale: 'en-US', name: 'Summer Sale' }]),
        ),
    });
    const found = await Effect.runPromise(listEvents(api, 'com.acme.app'));
    expect(found).toHaveLength(1);
    expect(found[0]?.event.referenceName).toBe('Summer');
    expect(found[0]?.localizations).toHaveLength(1);
    expect(api.listAppEventLocalizations).toHaveBeenCalledWith('e1');
  });
  it('throws an actionable error when the app has no App Store Connect record', async () => {
    const api = makeApi({ getAppId: vi.fn(() => Effect.succeed(null)) });
    const missingApp = await Effect.runPromise(Effect.flip(listEvents(api, 'com.acme.app')));
    expect(missingApp.message).toContain('No App Store Connect app record');
  });
});
describe('createEvent', () => {
  it('creates with a trimmed name and upper-cased, validated enums', async () => {
    const api = makeApi();
    await Effect.runPromise(
      createEvent(api, 'com.acme.app', {
        referenceName: ' Summer Sale ',
        badge: 'live_event',
        priority: 'high',
        purpose: 'attract_new_users',
        primaryLocale: 'en-US',
        deepLink: ' myapp://summer ',
      }),
    );
    expect(api.createAppEvent).toHaveBeenCalledWith('app1', {
      referenceName: 'Summer Sale',
      badge: 'LIVE_EVENT',
      primaryLocale: 'en-US',
      deepLink: 'myapp://summer',
      priority: 'HIGH',
      purpose: 'ATTRACT_NEW_USERS',
    });
  });
  it('rejects an empty reference name', async () => {
    const invalidEvent = await Effect.runPromise(
      Effect.flip(createEvent(makeApi(), 'com.acme.app', { referenceName: '  ' })),
    );
    expect(invalidEvent.message).toContain('reference name is required');
  });
  it('rejects an unknown badge with the valid list', async () => {
    const invalidBadge = await Effect.runPromise(
      Effect.flip(
        createEvent(makeApi(), 'com.acme.app', {
          referenceName: 'X',
          badge: 'MEGA_EVENT',
        }),
      ),
    );
    expect(invalidBadge.message).toContain('Invalid badge "MEGA_EVENT"');
  });
  it('rejects an unknown priority', async () => {
    const invalidPriority = await Effect.runPromise(
      Effect.flip(
        createEvent(makeApi(), 'com.acme.app', { referenceName: 'X', priority: 'URGENT' }),
      ),
    );
    expect(invalidPriority.message).toContain('Invalid priority');
  });
  it('rejects an unknown purpose', async () => {
    const invalidPurpose = await Effect.runPromise(
      Effect.flip(
        createEvent(makeApi(), 'com.acme.app', { referenceName: 'X', purpose: 'FOR_FUN' }),
      ),
    );
    expect(invalidPurpose.message).toContain('Invalid purpose');
  });
  it('throws when the app has no record (after validation passes)', async () => {
    const api = makeApi({ getAppId: vi.fn(() => Effect.succeed(null)) });
    const missingApp = await Effect.runPromise(
      Effect.flip(createEvent(api, 'com.acme.app', { referenceName: 'X' })),
    );
    expect(missingApp.message).toContain('No App Store Connect app record');
    expect(api.createAppEvent).not.toHaveBeenCalled();
  });
});
describe('localizeEvent', () => {
  it('creates a localization when none exists for the locale', async () => {
    const api = makeApi();
    const localizationOutcome = await Effect.runPromise(
      localizeEvent(api, 'e1', { locale: 'en-US', name: 'Hello' }),
    );
    expect(localizationOutcome.replaced).toBe(false);
    expect(api.createAppEventLocalization).toHaveBeenCalledWith('e1', 'en-US', { name: 'Hello' });
    expect(api.updateAppEventLocalization).not.toHaveBeenCalled();
  });
  it('updates the existing localization (case-insensitive) and carries the locale through', async () => {
    const api = makeApi({
      listAppEventLocalizations: vi
        .fn()
        .mockImplementation(() => Effect.succeed([{ id: 'l9', locale: 'en-US', name: 'Old' }])),
    });
    const localizationOutcome = await Effect.runPromise(
      localizeEvent(api, 'e1', { locale: 'EN-us', name: 'New' }),
    );
    expect(localizationOutcome.replaced).toBe(true);
    expect(localizationOutcome.localization.locale).toBe('en-US');
    expect(api.updateAppEventLocalization).toHaveBeenCalledWith('l9', { name: 'New' });
    expect(api.createAppEventLocalization).not.toHaveBeenCalled();
  });
  it('rejects an empty locale', async () => {
    const invalidLocale = await Effect.runPromise(
      Effect.flip(localizeEvent(makeApi(), 'e1', { locale: '  ', name: 'x' })),
    );
    expect(invalidLocale.message).toContain('locale is required');
  });
  it('rejects when no copy fields are provided', async () => {
    const missingCopy = await Effect.runPromise(
      Effect.flip(localizeEvent(makeApi(), 'e1', { locale: 'en-US' })),
    );
    expect(missingCopy.message).toContain('at least one of');
  });
});
describe('deleteEvent', () => {
  it('deletes the event by id', async () => {
    const api = makeApi();
    await Effect.runPromise(deleteEvent(api, 'e1'));
    expect(api.deleteAppEvent).toHaveBeenCalledWith('e1');
  });
});
