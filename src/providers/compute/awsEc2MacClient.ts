import { Data, Effect } from 'effect';
import { errorMessage } from '@core/services/errorMessage.js';
import { requireOptional } from '@core/services/optionalDep.js';
import type { AllocateRequest, AwsConfig } from '@core/types/remote.js';

export type Ec2Module = typeof import('@aws-sdk/client-ec2');
export type CredentialModule = typeof import('@aws-sdk/credential-providers');
export type Ec2Client = InstanceType<Ec2Module['EC2Client']>;

export type AwsComputeFailure = Readonly<{
  readonly _tag: 'AwsComputeFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeAwsComputeFailure = Data.tagged<AwsComputeFailure>('AwsComputeFailure');

export const INSTALL_HINT = 'pnpm add @aws-sdk/client-ec2 @aws-sdk/credential-providers';

/** Prefer an explicit detail string; otherwise surface the underlying AWS/SDK message. */
export const awsFailure = (
  operation: string,
  cause: unknown,
  detail?: string,
): AwsComputeFailure => {
  let message = errorMessage(cause);
  if (detail !== undefined) message = detail;
  return makeAwsComputeFailure({ operation, message, cause });
};

export const sendAwsRequest = <Success>(
  operation: string,
  sendRequest: () => PromiseLike<Success>,
): Effect.Effect<Success, AwsComputeFailure> =>
  Effect.tryPromise({
    try: sendRequest,
    catch: (cause) => awsFailure(operation, cause),
  });

export const loadEc2 = (): Effect.Effect<Ec2Module, unknown> =>
  requireOptional('AWS EC2 Mac builds', INSTALL_HINT, () =>
    Effect.tryPromise({
      try: () => import('@aws-sdk/client-ec2'),
      catch: (cause) => awsFailure('load the EC2 SDK', cause),
    }),
  );

export const loadCredentials = (): Effect.Effect<CredentialModule, unknown> =>
  requireOptional('AWS EC2 Mac builds', INSTALL_HINT, () =>
    Effect.tryPromise({
      try: () => import('@aws-sdk/credential-providers'),
      catch: (cause) => awsFailure('load AWS credential providers', cause),
    }),
  );

/** Regional EC2 client from the standard AWS credential chain (optional profile). */
export const makeClient = (
  awsConfiguration: Pick<AwsConfig, 'region' | 'profile'>,
): Effect.Effect<{ ec2: Ec2Module; client: Ec2Client }, unknown> =>
  Effect.gen(function* () {
    const ec2 = yield* loadEc2();
    const credentialModule = yield* loadCredentials();
    let credentialOptions = {};
    if (awsConfiguration.profile !== undefined) {
      credentialOptions = { profile: awsConfiguration.profile };
    }
    const credentials = credentialModule.fromNodeProviderChain(credentialOptions);
    return {
      ec2,
      client: new ec2.EC2Client({ region: awsConfiguration.region, credentials }),
    };
  });

export const requireAws = (
  allocationRequest: AllocateRequest,
): Effect.Effect<AwsConfig, AwsComputeFailure> => {
  if (allocationRequest.aws !== undefined) return Effect.succeed(allocationRequest.aws);
  const message = 'AWS settings missing - add an `aws: { region: ... }` block to launch.config.ts.';
  return Effect.fail(awsFailure('read AWS settings', message, message));
};
