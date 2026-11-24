// Submits a finished Apple package through Expo Application Services.

import type { BuildContext } from '../../types/config.ts';
import type { BuildCredentials } from '../../types/credentials.ts';
import type { SubmitArtifact, Submitter } from '../../types/providers.ts';
import { easSubmit } from '../build/expo-application-services.ts';

export const easSubmitter: Submitter = {
  name: 'eas',
  submit(
    artifact: SubmitArtifact,
    _buildCredentials: BuildCredentials,
    buildContext: BuildContext,
  ) {
    return easSubmit(buildContext, artifact.path, buildContext.profile.name);
  },
};
