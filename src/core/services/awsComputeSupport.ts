import { consentMessage, costForDurationUsd, releasableAt } from '../build/cost.js';
import { REQUIRED_TOOLS } from '../config/toolchain.js';
import { getAmiId, setAmiId } from '../distribution/cloudState.js';

/** Provider-facing AWS allocation consent copy. */
export const awsAllocationConsentMessage = consentMessage;
/** Provider-facing accrued EC2 Mac cost calculation. */
export const awsCostForDurationUsd = costForDurationUsd;
/** Provider-facing Dedicated Host release time calculation. */
export const awsHostReleasableAt = releasableAt;
/** Provider-facing cached golden AMI reader. */
export const getAwsGoldenAmiId = getAmiId;
/** Provider-facing cached golden AMI writer. */
export const setAwsGoldenAmiId = setAmiId;
/** Canonical local tools the AWS golden image bootstraps. */
export const AWS_BOOTSTRAP_TOOLS = REQUIRED_TOOLS;
