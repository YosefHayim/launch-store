// A Google Play track release from edits.tracks.

export type PlayRelease = Readonly<{
  name?: string;
  versionCodes?: readonly string[];
  status?: string;
  userFraction?: number;
  releaseNotes?: Readonly<{ language: string; text: string }>[];
}>;
