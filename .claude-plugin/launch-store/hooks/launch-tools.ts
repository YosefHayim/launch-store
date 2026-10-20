import type { McpToolInputs } from 'claude-code';

export type BuildInput = McpToolInputs['mcp__launch-store__build'];
export type ReleaseInput = McpToolInputs['mcp__launch-store__release'];
export type StatusInput = McpToolInputs['mcp__launch-store__status'];
export type PlanInput = McpToolInputs['mcp__launch-store__plan'];
export type DoctorInput = McpToolInputs['mcp__launch-store__doctor'];

const PLATFORM = {
  type: 'string',
  enum: ['ios', 'android', 'tvos', 'macos', 'visionos'],
  description: 'The store platform.',
};
const PROFILE = {
  type: 'string',
  description: 'The build profile from launch.config, production when left out.',
};
const APP = {
  type: 'string',
  description: 'The app handle, needed only when the project holds more than one app.',
};
const DRY_RUN = {
  type: 'boolean',
  description: 'Rehearse every step and print the plan, changing nothing.',
};

export const LAUNCH_TOOL_SPECS = [
  {
    name: 'build',
    description:
      "Builds the app with launch-store, then uploads it to TestFlight or Google Play internal testing unless submit is false. A build that uploads asks the person first. Progress shows in the session's status line.",
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        platform: PLATFORM,
        profile: PROFILE,
        app: APP,
        dryRun: DRY_RUN,
        submit: {
          type: 'boolean',
          description: 'false builds without uploading. Uploads when left out.',
        },
      },
      required: ['platform'],
    },
  },
  {
    name: 'release',
    description:
      'Releases the app to the App Store or Google Play with launch-store. It first prints the release plan and asks the person to confirm it; nothing is submitted without their yes. dryRun returns the plan alone.',
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        platform: PLATFORM,
        profile: PROFILE,
        app: APP,
        dryRun: DRY_RUN,
        rollout: {
          type: 'number',
          description: 'Android only: the staged-rollout fraction, from above 0 to 1.',
        },
        build: {
          type: 'string',
          description:
            'iOS only: an uploaded build number, or latest, to promote instead of uploading.',
        },
        upload: {
          type: 'boolean',
          description: 'iOS only: upload the latest local build.',
        },
      },
      required: ['platform'],
    },
  },
  {
    name: 'status',
    description:
      "Reads each iOS app's App Store version, review and phased-rollout state. Read-only.",
    isDeferred: false,
    inputSchema: { type: 'object', properties: { app: APP } },
  },
  {
    name: 'plan',
    description:
      'Compares launch.config with the live store state (capabilities, in-app purchases, subscriptions, pricing) and lists the changes a sync would make. Read-only.',
    isDeferred: true,
    inputSchema: {
      type: 'object',
      properties: {
        surface: { type: 'string', description: 'One store surface to compare, like iap.' },
        app: APP,
      },
    },
  },
  {
    name: 'doctor',
    description:
      'Checks the machine and project for what a build needs (Xcode, Java, Android SDK, signing, store keys). Read-only.',
    isDeferred: true,
    inputSchema: { type: 'object', properties: { platform: PLATFORM, app: APP } },
  },
];

const optionWords = (flag: string, value: string | number | undefined) => {
  if (value === undefined) return [];
  return [flag, `${value}`];
};

const switchWords = (flag: string, isOn: boolean) => {
  if (!isOn) return [];
  return [flag];
};

const targetWords = (input: Readonly<{ profile?: string; app?: string }>) => [
  ...optionWords('--profile', input.profile),
  ...optionWords('--app', input.app),
];

export const buildWords = (input: BuildInput) => [
  'build',
  input.platform,
  ...targetWords(input),
  ...switchWords('--dry-run', input.dryRun === true),
  ...switchWords('--no-submit', input.submit === false),
];

export const releaseWords = (input: ReleaseInput) => [
  'release',
  input.platform,
  ...targetWords(input),
  ...optionWords('--rollout', input.rollout),
  ...optionWords('--build', input.build),
  ...switchWords('--upload', input.upload === true),
  ...switchWords('--dry-run', input.dryRun === true),
];

export const statusWords = (input: StatusInput) => ['status', ...optionWords('--app', input.app)];

const valueWords = (value: string | undefined) => {
  if (value === undefined) return [];
  return [value];
};

export const planWords = (input: PlanInput) => [
  'plan',
  ...valueWords(input.surface),
  ...optionWords('--app', input.app),
];

export const doctorWords = (input: DoctorInput) => [
  'doctor',
  ...optionWords('--platform', input.platform),
  ...optionWords('--app', input.app),
];
