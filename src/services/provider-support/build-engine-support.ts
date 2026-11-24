// Shares archive flags, build estimates, and signing writes that the local build engines use.

import {
  assembleArchiveArguments as assembleCoreArchiveArguments,
  assembleExportArguments as assembleCoreExportArguments,
  computeParallelJobLimit as computeCoreParallelJobLimit,
  readCcacheEnvironment as readCoreCcacheEnvironment,
} from '../../build/build-flags.ts';
import {
  estimateFor as estimateForCoreBuild,
  gatherIosFingerprint as gatherCoreIosFingerprint,
  readBuildState as readCoreBuildState,
  pickClean as readCoreClean,
  updateEstimate as updateCoreEstimate,
  writeBuildState as writeCoreBuildState,
} from '../../build/build-fingerprint.ts';
import { writeManualSigningToProject as writeCoreManualSigning } from '../../build/apple-targets.ts';

/** Provider-facing xcodebuild archive argument builder owned by the core build policy. */
export const assembleArchiveArguments = assembleCoreArchiveArguments;
/** Provider-facing xcodebuild -exportArchive argument builder owned by the core build policy. */
export const assembleExportArguments = assembleCoreExportArguments;
/** Provider-facing RAM cap owned by the core build policy. */
export const computeParallelJobLimit = computeCoreParallelJobLimit;
/** Provider-facing ccache environment reader owned by the core build policy. */
export const readCcacheEnvironment = readCoreCcacheEnvironment;
/** Provider-facing build estimate lookup. */
export const estimateFor = estimateForCoreBuild;
/** Provider-facing iOS fingerprint program. */
export const gatherIosFingerprint = gatherCoreIosFingerprint;
/** Provider-facing persisted build-state reader. */
export const readBuildState = readCoreBuildState;
/** Provider-facing clean-build decision. */
export const pickClean = readCoreClean;
/** Provider-facing moving build estimate update. */
export const updateEstimate = updateCoreEstimate;
/** Provider-facing persisted build-state writer. */
export const writeBuildState = writeCoreBuildState;
/** Provider-facing Xcode signing mutation. */
export const writeManualSigningToProject = writeCoreManualSigning;
