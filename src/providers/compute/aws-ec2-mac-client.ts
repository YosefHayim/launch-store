import { errorMessage } from '@/services/platform/error-message.js';
import { requireOptional } from '@/services/platform/optional-dep.js';
import type { AllocateRequest, AwsConfig } from '@/types/remote.js';

export type Ec2Module = typeof import('@aws-sdk/client-ec2');

type CredentialModule = typeof import('@aws-sdk/credential-providers');

export type Ec2Client = InstanceType<Ec2Module['EC2Client']>;

export type AwsComputeFailure = Readonly<{
  readonly _tag: 'AwsComputeFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

const INSTALL_HINT = 'pnpm add @aws-sdk/client-ec2 @aws-sdk/credential-providers';

export function awsFailure(operation: string, cause: unknown, detail?: string): AwsComputeFailure {
  let message = errorMessage(cause);

  if (detail != null) {
    message = detail;
  }

  return { _tag: 'AwsComputeFailure', operation, message, cause };
}

export async function sendAwsRequest<Success>(
  operation: string,
  sendRequest: () => PromiseLike<Success>,
): Promise<Success> {
  try {
    return await sendRequest();
  } catch (cause) {
    throw awsFailure(operation, cause);
  }
}

function loadEc2(): Promise<Ec2Module> {
  return requireOptional('AWS EC2 Mac builds', INSTALL_HINT, function loadEc2Module() {
    return import('@aws-sdk/client-ec2');
  });
}

function loadCredentials(): Promise<CredentialModule> {
  return requireOptional('AWS EC2 Mac builds', INSTALL_HINT, function loadCredentialModule() {
    return import('@aws-sdk/credential-providers');
  });
}

export async function makeClient(
  awsConfiguration: Pick<AwsConfig, 'region' | 'profile'>,
): Promise<{ ec2: Ec2Module; client: Ec2Client }> {
  const ec2 = await loadEc2();
  const credentialModule = await loadCredentials();
  let credentialOptions = {};

  if (awsConfiguration.profile != null) {
    credentialOptions = { profile: awsConfiguration.profile };
  }

  const credentials = credentialModule.fromNodeProviderChain(credentialOptions);

  return {
    ec2,
    client: new ec2.EC2Client({ region: awsConfiguration.region, credentials }),
  };
}

export function requireAws(allocationRequest: AllocateRequest): AwsConfig {
  if (allocationRequest.aws != null) {
    return allocationRequest.aws;
  }

  const message = 'AWS settings missing - add an `aws: { region: ... }` block to launch.config.ts.';

  throw awsFailure('read AWS settings', message, message);
}
