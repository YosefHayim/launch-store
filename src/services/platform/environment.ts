import { decodeLaunchEnvironment, type LaunchEnvironmentValues } from '../../config/environment.js';

export type LaunchEnvironmentService = Readonly<{
  values: LaunchEnvironmentValues;
  rawVariables: Readonly<Record<string, string | undefined>>;
  readSecret: (environmentVariableName: string) => string | null;
}>;

let environmentVariables: Readonly<Record<string, string | undefined>> = process.env;

export function useLaunchEnvironment(
  variables: Readonly<Record<string, string | undefined>>,
): void {
  environmentVariables = variables;
}

export function resetLaunchEnvironment(): void {
  environmentVariables = process.env;
}

function readSecret(environmentVariableName: string): string | null {
  const secretText = environmentVariables[environmentVariableName];

  if (secretText == null) {
    return null;
  }

  if (secretText == '') {
    return null;
  }

  return secretText;
}

export function readLaunchEnvironment(): LaunchEnvironmentService {
  return {
    values: decodeLaunchEnvironment(environmentVariables),
    rawVariables: environmentVariables,
    readSecret,
  };
}
