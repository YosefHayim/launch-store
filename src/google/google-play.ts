// Google Play calls the launch commands use, on the official Android Publisher client.

import { createReadStream } from 'node:fs';

import { androidpublisher, auth as androidPublisherAuth } from '@googleapis/androidpublisher';

import type { StoreSnapshot } from '@/plan/plan-store.js';

const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

interface PlayAccount {
  clientEmail: string;
  privateKey: string;
}

interface PlayListing {
  language?: string | null;
  title?: string | null;
}

interface PlayRelease {
  name?: string | null;
  versionCodes?: string[] | null;
}

export class GooglePlay {
  private readonly publisher: ReturnType<typeof androidpublisher>;

  constructor(serviceAccountJson: string) {
    const account = readServiceAccount(serviceAccountJson);
    const googleAuthentication = new androidPublisherAuth.JWT({
      email: account.clientEmail,
      key: account.privateKey,
      scopes: [PLAY_SCOPE],
    });
    this.publisher = androidpublisher({ version: 'v3', auth: googleAuthentication });
  }

  /**
   * Reads the English listing title and the release name on a track.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/list}
   */
  async readLive(packageName: string, track: string): Promise<StoreSnapshot> {
    const publisher = this.publisher;

    return this.readInEdit(packageName, readSnapshot);

    async function readSnapshot(editId: string): Promise<StoreSnapshot> {
      const listingReply = await publisher.edits.listings.list({ packageName, editId });
      const trackReply = await publisher.edits.tracks.get({ packageName, editId, track });

      return {
        name: pickListingTitle(listingReply.data.listings) ?? packageName,
        version: pickReleaseName(trackReply.data.releases),
      };
    }
  }

  /**
   * Writes the listing title and the release name from launch.config.ts.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/update}
   */
  async writeLive(packageName: string, track: string, desired: StoreSnapshot): Promise<void> {
    const publisher = this.publisher;

    await this.commitInEdit(packageName, writeSnapshot);

    async function writeSnapshot(editId: string): Promise<void> {
      const listingReply = await publisher.edits.listings.list({ packageName, editId });
      const listings = listingReply.data.listings ?? [];
      const language = pickListingLanguage(listings);
      await publisher.edits.listings.update({
        packageName,
        editId,
        language,
        requestBody: { language, title: desired.name },
      });
      const isVersionMissing = desired.version == null;

      if (isVersionMissing) {
        return;
      }

      const trackReply = await publisher.edits.tracks.get({ packageName, editId, track });
      const versionCodes = readVersionCodes(trackReply.data.releases);
      await publisher.edits.tracks.update({
        packageName,
        editId,
        track,
        requestBody: {
          track,
          releases: [{ name: desired.version, status: 'completed', versionCodes }],
        },
      });
    }
  }

  /**
   * Uploads an Android App Bundle and puts it on a track.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles/upload}
   */
  async uploadBundle(packageName: string, aabPath: string, track: string): Promise<void> {
    const publisher = this.publisher;

    await this.commitInEdit(packageName, upload);

    async function upload(editId: string): Promise<void> {
      const uploaded = await publisher.edits.bundles.upload({
        packageName,
        editId,
        media: { mimeType: 'application/octet-stream', body: createReadStream(aabPath) },
      });
      const versionCode = uploaded.data.versionCode;
      const isMissingCode = typeof versionCode !== 'number';

      if (isMissingCode) {
        throw new Error('Google Play upload bundle failed: no version code.');
      }

      await publisher.edits.tracks.update({
        packageName,
        editId,
        track,
        requestBody: {
          track,
          releases: [{ status: 'completed', versionCodes: [String(versionCode)] }],
        },
      });
    }
  }

  /**
   * Promotes the bundles on a track to production.
   * @see {@link https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/update}
   */
  async releaseTrack(packageName: string, track: string): Promise<void> {
    const publisher = this.publisher;

    await this.commitInEdit(packageName, promote);

    async function promote(editId: string): Promise<void> {
      const trackReply = await publisher.edits.tracks.get({ packageName, editId, track });
      const versionCodes = readVersionCodes(trackReply.data.releases);
      const isEmpty = versionCodes.length === 0;

      if (isEmpty) {
        throw new Error(`Google Play track ${track} has no bundle to release.`);
      }

      await publisher.edits.tracks.update({
        packageName,
        editId,
        track: 'production',
        requestBody: {
          track: 'production',
          releases: [{ status: 'completed', versionCodes }],
        },
      });
    }
  }

  private async readInEdit<Edited>(
    packageName: string,
    useEdit: (editId: string) => Promise<Edited>,
  ): Promise<Edited> {
    const editId = await this.openEdit(packageName);

    var edited: Edited;

    try {
      edited = await useEdit(editId);
    } catch (error) {
      await this.dropEdit(packageName, editId);
      throw error;
    }

    await this.dropEdit(packageName, editId);

    return edited;
  }

  private async commitInEdit(
    packageName: string,
    change: (editId: string) => Promise<void>,
  ): Promise<void> {
    const editId = await this.openEdit(packageName);

    try {
      await change(editId);
      await this.publisher.edits.commit({ packageName, editId });
    } catch (error) {
      await this.dropEdit(packageName, editId);
      const isError = error instanceof Error;

      if (isError) {
        throw new Error(`Google Play failed for ${packageName}. ${error.message}`, {
          cause: error,
        });
      }

      throw new Error(`Google Play failed for ${packageName}.`, { cause: error });
    }
  }

  private async openEdit(packageName: string): Promise<string> {
    var created: { data: { id?: string | null } };

    try {
      created = await this.publisher.edits.insert({ packageName });
    } catch (error) {
      throw new Error(`Google Play could not open an edit for ${packageName}.`, { cause: error });
    }

    const editId = created.data.id;
    const isMissing = typeof editId !== 'string';

    if (isMissing) {
      throw new Error(`Google Play could not open an edit for ${packageName}.`);
    }

    const isEmpty = editId.length === 0;

    if (isEmpty) {
      throw new Error(`Google Play could not open an edit for ${packageName}.`);
    }

    return editId;
  }

  private async dropEdit(packageName: string, editId: string): Promise<void> {
    try {
      await this.publisher.edits.delete({ packageName, editId });
    } catch (error) {
      const isError = error instanceof Error;

      if (isError) {
        return;
      }
    }
  }
}

export function readServiceAccount(serviceAccountJson: string): PlayAccount {
  var parsed: unknown;

  try {
    parsed = JSON.parse(serviceAccountJson) as unknown;
  } catch (error) {
    throw new Error('The Play service account is not valid JSON.', { cause: error });
  }

  const isMissing = parsed == null;

  if (isMissing) {
    throw new Error('The Play service account is not valid JSON.');
  }

  const isNotObject = typeof parsed !== 'object';

  if (isNotObject) {
    throw new Error('The Play service account is not valid JSON.');
  }

  const record = parsed as Record<string, unknown>;

  return {
    clientEmail: readAccountField(record, 'client_email'),
    privateKey: readAccountField(record, 'private_key'),
  };
}

function readAccountField(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];
  const isText = typeof field === 'string';

  if (!isText) {
    throw new Error(`The Play service account needs ${fieldName}.`);
  }

  const isEmpty = field.length === 0;

  if (isEmpty) {
    throw new Error(`The Play service account needs ${fieldName}.`);
  }

  return field;
}

function pickListingTitle(listings: readonly PlayListing[] | null | undefined): string | null {
  const language = pickListingLanguage(listings);
  const isMissing = listings == null;

  if (isMissing) {
    return null;
  }

  function matchesLanguage(listing: PlayListing): boolean {
    return listing.language === language;
  }

  const listing = listings.find(matchesLanguage);
  const isListingMissing = listing == null;

  if (isListingMissing) {
    return null;
  }

  const title = listing.title;
  const isTitle = typeof title === 'string';

  if (!isTitle) {
    return null;
  }

  return title;
}

function pickListingLanguage(listings: readonly PlayListing[] | null | undefined): string {
  const isMissing = listings == null;

  if (isMissing) {
    return 'en-US';
  }

  function isEnglish(listing: PlayListing): boolean {
    return listing.language === 'en-US';
  }

  const english = listings.find(isEnglish);
  const isEnglishMissing = english == null;

  if (isEnglishMissing) {
    const first = listings[0];
    const isFirstMissing = first == null;

    if (isFirstMissing) {
      return 'en-US';
    }

    const language = first.language;
    const isLanguage = typeof language === 'string';

    if (!isLanguage) {
      return 'en-US';
    }

    return language;
  }

  return 'en-US';
}

function pickReleaseName(releases: readonly PlayRelease[] | null | undefined): string | null {
  const isMissing = releases == null;

  if (isMissing) {
    return null;
  }

  const first = releases[0];
  const isFirstMissing = first == null;

  if (isFirstMissing) {
    return null;
  }

  const name = first.name;
  const isName = typeof name === 'string';

  if (!isName) {
    return null;
  }

  return name;
}

function readVersionCodes(releases: readonly PlayRelease[] | null | undefined): string[] {
  const isMissing = releases == null;

  if (isMissing) {
    return [];
  }

  const codes: string[] = [];

  for (const release of releases) {
    const versionCodes = release.versionCodes;
    const isArray = Array.isArray(versionCodes);

    if (!isArray) {
      continue;
    }

    for (const versionCode of versionCodes) {
      const isText = typeof versionCode === 'string';

      if (!isText) {
        continue;
      }

      codes.push(versionCode);
    }
  }

  return codes;
}
