import {
  assembleGymArguments as assembleCoreGymArguments,
  computeParallelJobLimit as computeCoreParallelJobLimit,
  resolveCcacheEnvironment as resolveCoreCcacheEnvironment,
} from '../build/buildFlags.js';
import {
  estimateFor as estimateForCoreBuild,
  gatherIosFingerprint as gatherCoreIosFingerprint,
  readBuildState as readCoreBuildState,
  resolveClean as resolveCoreClean,
  updateEstimate as updateCoreEstimate,
  writeBuildState as writeCoreBuildState,
} from '../build/buildFingerprint.js';
import { writeManualSigningToProject as writeCoreManualSigning } from '../build/appleTargets.js';

/** Provider-facing gym argument builder owned by the core build policy. */
export const assembleGymArguments = assembleCoreGymArguments;
/** Provider-facing RAM cap owned by the core build policy. */
export const computeParallelJobLimit = computeCoreParallelJobLimit;
/** Provider-facing ccache environment resolver owned by the core build policy. */
export const resolveCcacheEnvironment = resolveCoreCcacheEnvironment;
/** Provider-facing build estimate lookup. */
export const estimateFor = estimateForCoreBuild;
/** Provider-facing iOS fingerprint program. */
export const gatherIosFingerprint = gatherCoreIosFingerprint;
/** Provider-facing persisted build-state reader. */
export const readBuildState = readCoreBuildState;
/** Provider-facing clean-build decision. */
export const resolveClean = resolveCoreClean;
/** Provider-facing moving build estimate update. */
export const updateEstimate = updateCoreEstimate;
/** Provider-facing persisted build-state writer. */
export const writeBuildState = writeCoreBuildState;
/** Provider-facing Xcode signing mutation. */
export const writeManualSigningToProject = writeCoreManualSigning;
