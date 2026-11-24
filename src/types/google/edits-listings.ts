// A localized store listing from Google Play edits.listings.

export type PlayListing = Readonly<{
  language: string;
  title?: string;
  shortDescription?: string;
  fullDescription?: string;
  video?: string;
}>;
