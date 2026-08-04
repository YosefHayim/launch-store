import { NodeContext } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { createLogger, makeLaunchLoggerTest } from '../services/logger.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import type { DashboardState } from '../types/dashboard.js';

const dashboardState: DashboardState = {
  generatedAt: '2026-08-04T00:00:00.000Z',
  launchHome: '/test-home/.launch',
  project: {
    providers: {
      credentials: 'local',
      storage: 'local',
      buildEngine: 'fastlane',
      submit: 'app-store-connect',
    },
    profiles: ['production'],
    apps: [],
  },
  accounts: [],
  artifacts: [],
  secrets: [],
  cloudHost: null,
};

vi.mock('./state.js', () => ({
  gatherDashboardState: () => Effect.succeed(dashboardState),
}));

vi.mock('./render.js', () => ({
  renderDashboardHtml: () => Effect.succeed('<!doctype html><title>launch dashboard</title>'),
}));

const {
  DashboardCommandInputSchema,
  dashboardCommandProgram,
  dashboardHttpReply,
  parseDashboardPort,
} = await import('./command.js');
const { DashboardServer } = await import('./server.js');

const unavailableDashboardServer = {
  serve: () => Effect.dieMessage('Dashboard server should not start in JSON mode.'),
};

describe('DashboardCommandInputSchema', () => {
  it('decodes loopback server defaults', async () => {
    const commandInput = await Effect.runPromise(
      Schema.decodeUnknown(DashboardCommandInputSchema)({}),
    );
    expect(commandInput).toEqual({ host: '127.0.0.1', port: '4477', json: false });
  });
});

describe('parseDashboardPort', () => {
  it('accepts the valid TCP port range', async () => {
    expect(await Effect.runPromise(parseDashboardPort('1'))).toBe(1);
    expect(await Effect.runPromise(parseDashboardPort('65535'))).toBe(65535);
  });

  it('rejects malformed and out-of-range ports', async () => {
    await expect(Effect.runPromise(parseDashboardPort('abc'))).rejects.toThrow(
      /between 1 and 65535/,
    );
    await expect(Effect.runPromise(parseDashboardPort('65536'))).rejects.toThrow(
      /between 1 and 65535/,
    );
  });
});

describe('dashboardHttpReply', () => {
  const runRequest = (method: string, url: string) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* createLogger(false);
        return yield* dashboardHttpReply({ method, url }, logger);
      }).pipe(
        Effect.provide(makeLaunchLoggerTest([])),
        Effect.provide(makeLaunchPathsTest('/test-home', '/workspace')),
        Effect.provide(NodeContext.layer),
      ),
    );

  it('serves the dashboard root and index route', async () => {
    const rootReply = await runRequest('GET', '/');
    const indexReply = await runRequest('GET', '/index.html?refresh=1');
    expect(rootReply.status).toBe(200);
    expect(rootReply.content).toContain('launch dashboard');
    expect(indexReply.status).toBe(200);
  });

  it('returns plain 404 replies for other methods and paths', async () => {
    expect((await runRequest('POST', '/')).status).toBe(404);
    expect((await runRequest('GET', '/missing')).status).toBe(404);
  });
});

describe('dashboardCommandProgram', () => {
  it('prints machine-readable state without starting the server', async () => {
    const terminalWrites: string[] = [];
    await Effect.runPromise(
      dashboardCommandProgram({ json: true }).pipe(
        Effect.provideService(DashboardServer, unavailableDashboardServer),
        Effect.provide(makeLaunchLoggerTest(terminalWrites)),
        Effect.provide(makeLaunchPathsTest('/test-home', '/workspace')),
        Effect.provide(NodeContext.layer),
      ),
    );
    const printedState = Schema.decodeUnknownSync(
      Schema.Struct({ generatedAt: Schema.String, launchHome: Schema.String }),
    )(JSON.parse(terminalWrites.join('')));
    expect(printedState).toEqual({
      generatedAt: dashboardState.generatedAt,
      launchHome: dashboardState.launchHome,
    });
  });
});
