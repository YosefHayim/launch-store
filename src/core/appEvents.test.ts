import { describe, expect, it, vi } from 'vitest';
import type { AppEventLocalizationInput, NewAppEvent } from '../apple/ascClient.js';
import {
  createEvent,
  deleteEvent,
  listEvents,
  localizeEvent,
  type AscAppEventsApi,
} from './appEvents.js';

/** A stubbed {@link AscAppEventsApi}: one app, no events; writes echo their input. Override per test. */
function makeApi(overrides: Partial<AscAppEventsApi> = {}): AscAppEventsApi {
  const base: AscAppEventsApi = {
    getAppId: vi.fn().mockResolvedValue('app1'),
    listAppEvents: vi.fn().mockResolvedValue([]),
    listAppEventLocalizations: vi.fn().mockResolvedValue([]),
    createAppEvent: vi
      .fn()
      .mockImplementation((_appId: string, attributes: NewAppEvent) =>
        Promise.resolve({ id: 'evt-new', eventState: 'DRAFT', ...attributes }),
      ),
    deleteAppEvent: vi.fn().mockResolvedValue(undefined),
    createAppEventLocalization: vi
      .fn()
      .mockImplementation(
        (_eventId: string, locale: string, attributes: AppEventLocalizationInput) =>
          Promise.resolve({ id: 'loc-new', locale, ...attributes }),
      ),
    updateAppEventLocalization: vi
      .fn()
      .mockImplementation((id: string, attributes: AppEventLocalizationInput) =>
        Promise.resolve({ id, locale: '', ...attributes }),
      ),
  };
  return { ...base, ...overrides };
}

describe('listEvents', () => {
  it('pairs each event with its localizations', async () => {
    const api = makeApi({
      listAppEvents: vi.fn().mockResolvedValue([{ id: 'e1', referenceName: 'Summer' }]),
      listAppEventLocalizations: vi
        .fn()
        .mockResolvedValue([{ id: 'l1', locale: 'en-US', name: 'Summer Sale' }]),
    });
    const found = await listEvents(api, 'com.acme.app');
    expect(found).toHaveLength(1);
    expect(found[0]?.event.referenceName).toBe('Summer');
    expect(found[0]?.localizations).toHaveLength(1);
    expect(api.listAppEventLocalizations).toHaveBeenCalledWith('e1');
  });

  it('throws an actionable error when the app has no App Store Connect record', async () => {
    const api = makeApi({ getAppId: vi.fn().mockResolvedValue(null) });
    await expect(listEvents(api, 'com.acme.app')).rejects.toThrow(
      /No App Store Connect app record/,
    );
  });
});

describe('createEvent', () => {
  it('creates with a trimmed name and upper-cased, validated enums', async () => {
    const api = makeApi();
    await createEvent(api, 'com.acme.app', {
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
  });

  it('rejects an empty reference name', async () => {
    await expect(createEvent(makeApi(), 'com.acme.app', { referenceName: '  ' })).rejects.toThrow(
      /reference name is required/,
    );
  });

  it('rejects an unknown badge with the valid list', async () => {
    await expect(
      createEvent(makeApi(), 'com.acme.app', { referenceName: 'X', badge: 'MEGA_EVENT' }),
    ).rejects.toThrow(/Invalid badge "MEGA_EVENT"/);
  });

  it('rejects an unknown priority', async () => {
    await expect(
      createEvent(makeApi(), 'com.acme.app', { referenceName: 'X', priority: 'URGENT' }),
    ).rejects.toThrow(/Invalid priority/);
  });

  it('rejects an unknown purpose', async () => {
    await expect(
      createEvent(makeApi(), 'com.acme.app', { referenceName: 'X', purpose: 'FOR_FUN' }),
    ).rejects.toThrow(/Invalid purpose/);
  });

  it('throws when the app has no record (after validation passes)', async () => {
    const api = makeApi({ getAppId: vi.fn().mockResolvedValue(null) });
    await expect(createEvent(api, 'com.acme.app', { referenceName: 'X' })).rejects.toThrow(
      /No App Store Connect app record/,
    );
    expect(api.createAppEvent).not.toHaveBeenCalled();
  });
});

describe('localizeEvent', () => {
  it('creates a localization when none exists for the locale', async () => {
    const api = makeApi();
    const result = await localizeEvent(api, 'e1', { locale: 'en-US', name: 'Hello' });
    expect(result.replaced).toBe(false);
    expect(api.createAppEventLocalization).toHaveBeenCalledWith('e1', 'en-US', { name: 'Hello' });
    expect(api.updateAppEventLocalization).not.toHaveBeenCalled();
  });

  it('updates the existing localization (case-insensitive) and carries the locale through', async () => {
    const api = makeApi({
      listAppEventLocalizations: vi
        .fn()
        .mockResolvedValue([{ id: 'l9', locale: 'en-US', name: 'Old' }]),
    });
    const result = await localizeEvent(api, 'e1', { locale: 'EN-us', name: 'New' });
    expect(result.replaced).toBe(true);
    expect(result.localization.locale).toBe('en-US');
    expect(api.updateAppEventLocalization).toHaveBeenCalledWith('l9', { name: 'New' });
    expect(api.createAppEventLocalization).not.toHaveBeenCalled();
  });

  it('rejects an empty locale', async () => {
    await expect(localizeEvent(makeApi(), 'e1', { locale: '  ', name: 'x' })).rejects.toThrow(
      /locale is required/,
    );
  });

  it('rejects when no copy fields are provided', async () => {
    await expect(localizeEvent(makeApi(), 'e1', { locale: 'en-US' })).rejects.toThrow(
      /at least one of/,
    );
  });
});

describe('deleteEvent', () => {
  it('deletes the event by id', async () => {
    const api = makeApi();
    await deleteEvent(api, 'e1');
    expect(api.deleteAppEvent).toHaveBeenCalledWith('e1');
  });
});
