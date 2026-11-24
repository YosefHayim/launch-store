// Checks that each App Store Connect app has a completed age rating.

import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/readiness.ts';
import { iosApps } from '../app-scopes.ts';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentials-skip.ts';

type AgeRatingDeclaration = Readonly<{
  attributes: Record<string, string | boolean>;
}> | null;

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isAppRecordMissing(appId: string | null): appId is null {
  return appId == null;
}

function isAppInfoMissing(appInfoId: string | null): appInfoId is null {
  return appInfoId == null;
}

function isDeclarationMissing(declaration: AgeRatingDeclaration): declaration is null {
  return declaration == null;
}

async function readAgeRating(
  api: AscReadinessApi,
  app: { name: string; identifier: string },
): Promise<AppReadiness> {
  const appId = await api.getAppId(app.identifier);

  if (isAppRecordMissing(appId)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: "can't verify - no app record yet",
      hint: 'create the app record first (see the app-record check)',
    };
  }

  const appInfoId = await api.getEditableAppInfoId(appId);

  if (isAppInfoMissing(appInfoId)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'warn',
      detail: "can't verify - no editable app version",
      hint: 'create a new version in App Store Connect, then re-run',
    };
  }

  const declaration = await api.getAgeRatingDeclaration(appInfoId);

  if (isDeclarationMissing(declaration)) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'blocker',
      detail: 'age-rating questionnaire not completed',
      hint: 'answer it in App Store Connect -> App Information -> Age Rating before submitting',
    };
  }

  const hasAnswers = Object.keys(declaration.attributes).length > 0;

  if (hasAnswers) {
    return {
      app: app.name,
      identifier: app.identifier,
      status: 'ok',
      detail: 'age-rating questionnaire completed',
    };
  }

  return {
    app: app.name,
    identifier: app.identifier,
    status: 'blocker',
    detail: 'age-rating questionnaire not completed',
    hint: 'answer it in App Store Connect -> App Information -> Age Rating before submitting',
  };
}

/** The App Store Connect age-rating-declaration readiness probe - a listing-completeness and submit blocker. */
export const ageRatingProbe = {
  id: 'apple-age-rating',
  title: 'Age rating completed',
  store: 'appstore',
  categories: ['listing', 'submit'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    const apps = iosApps(readinessContext.apps);

    const isNothingSelected = apps.length == 0;

    if (isNothingSelected) {
      return OMITTED_PROBE;
    }

    const api = await readinessContext.readAscApi();

    if (isAppleAccountMissing(api)) {
      return SKIPPED_NO_APPLE_ACCOUNT;
    }

    const appleApi = api;

    function readRating(app: { name: string; identifier: string }): Promise<AppReadiness> {
      return readAgeRating(appleApi, app);
    }

    const findings = await Promise.all(apps.map(readRating));

    return { state: 'checked', apps: findings };
  },
} satisfies ReadinessProbe;
