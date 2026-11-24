// App Store Connect builds and the status of an uploaded build.

/** A build (one uploaded binary) on App Store Connect, with the fields the release flow reads. */
export type BuildResource = Readonly<{
  id: string;
  version: string;
  processingState: string;
  uploadedDate?: string;
  expired: boolean;
  marketingVersion?: string;
}>;

/** One reason App Store Connect gave about a build upload (an error such as `90062`, or a warning). */
export type BuildUploadProblem = Readonly<{ code: string; description: string }>;

/** Where an IPA delivery stands */
export type BuildUploadStatus = Readonly<{
  state: string;
  fileState: string;
  errors: readonly BuildUploadProblem[];
}>;
