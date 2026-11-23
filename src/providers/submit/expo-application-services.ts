// Submits a finished Apple package through Expo Application Services.

import type { ResolvedBuildContext } from '@/types/config.js';
import type { BuildCredentials } from '@/types/credentials.js';
import type { SubmitArtifact, Submitter } from '@/types/providers.js';
import { easSubmit } from '../build/expo-application-services.ts';
export const easSubmitter: Submitter = {
  name: 'eas',
  submit(
    artifact: SubmitArtifact,
    _buildCredentials: BuildCredentials,
    buildContext: ResolvedBuildContext,
  ) {
    return easSubmit(buildContext, artifact.path, buildContext.profile.name);
  },
};
