/**
 * The `eas` submitter — uploads an already-built `.ipa` through `eas submit`.
 *
 * A thin {@link Submitter} over the EAS adapter (`providers/build/eas.ts`), registered so a config can
 * set `submit: "eas"`. It ignores the Apple credentials argument on purpose: in the EAS path, Expo's
 * cloud holds the signing/submission credentials, not Launch — which is exactly the tradeoff the EAS
 * handoff makes for no-Mac, no-AWS developers.
 */

import type { BuildCredentials, ResolvedBuildContext, Submitter, SubmitTarget } from "../../core/types.js";
import { easSubmit } from "../build/eas.js";

export const easSubmitter: Submitter = {
  name: "eas",

  async submit(
    artifactPath: string,
    _target: SubmitTarget,
    _creds: BuildCredentials,
    ctx: ResolvedBuildContext,
  ): Promise<void> {
    await easSubmit(ctx, artifactPath, ctx.profile.name);
  },
};
