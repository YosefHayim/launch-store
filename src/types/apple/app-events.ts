// App Store in-app events and their localizations.

/** One **in-app event** (`appEvents`) */
export type AppEventResource = Readonly<{
  id: string;
  referenceName: string;
  badge?: string;
  eventState?: string;
  primaryLocale?: string;
  deepLink?: string;
  priority?: string;
  purpose?: string;
}>;

/** One locale's copy for an in-app event (`appEventLocalizations`) - name + short/long descriptions. */
export type AppEventLocalizationResource = Readonly<{
  id: string;
  locale: string;
  name?: string;
  shortDescription?: string;
  longDescription?: string;
}>;

/** Attributes to create an in-app event, passed to `POST /v1/appEvents` (alongside the app relationship). */
export type NewAppEvent = Readonly<{
  referenceName: string;
  badge?: string;
  primaryLocale?: string;
  deepLink?: string;
  priority?: string;
  purpose?: string;
}>;

/** The editable copy fields of an in-app event localization (create or update). */
export type AppEventLocalizationInput = Readonly<{
  name?: string;
  shortDescription?: string;
  longDescription?: string;
}>;
