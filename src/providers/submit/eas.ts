import type { SubmitTarget } from '@core/types/app.js';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials } from '@core/types/credentials.js';
import type { Submitter } from '@core/types/providers.js';
import { easSubmit } from '../build/eas.js';
export const easSubmitter: Submitter = {
  name: 'eas',
  submit(
    artifactPath: string,
    _target: SubmitTarget,
    _buildCredentials: BuildCredentials,
    buildContext: ResolvedBuildContext,
  ) {
    return easSubmit(buildContext, artifactPath, buildContext.profile.name);
  },
};
