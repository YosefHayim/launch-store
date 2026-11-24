// App Clips and the default App Clip experience.

import type { components } from './apple-api-types.ts';

/** The App Clip card's call-to-action button - Apple's `AppClipAction` enum. */
export const APP_CLIP_ACTIONS = [
  'OPEN',
  'VIEW',
  'PLAY',
] as const satisfies readonly components['schemas']['AppClipAction'][];

/** The App Clip card's call-to-action button. */
export type AppClipActionValue = components['schemas']['AppClipAction'];

/** An app's App Clip - the install-free slice launched from a link / NFC / App Clip Code. */
export type AppClipResource = Readonly<{
  id: string;
  bundleId?: string;
}>;

/** One default App Clip experience */
export type AppClipDefaultExperienceResource = Readonly<{
  id: string;
  action?: string;
  versionId?: string;
}>;

/** One locale of an App Clip's default experience - the card subtitle shown to users in that locale. */
export type AppClipLocalizationResource = Readonly<{
  id: string;
  locale: string;
  subtitle?: string;
}>;
