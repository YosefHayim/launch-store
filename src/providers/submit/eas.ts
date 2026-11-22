import type { ResolvedBuildContext } from '../../types/config.ts';
import type { BuildCredentials } from '../../types/credentials.ts';
import type { SubmitArtifact, Submitter } from '../../types/providers.ts';
import { easSubmit } from '../build/eas.ts';
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
