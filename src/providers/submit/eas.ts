import type { ResolvedBuildContext } from '@/types/config.js';
import type { BuildCredentials } from '@/types/credentials.js';
import type { SubmitArtifact, Submitter } from '@/types/providers.js';
import { easSubmit } from '../build/eas.js';
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
