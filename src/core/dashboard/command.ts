import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { gatherDashboardState } from './state.js';
import type { StatsSyncRequirements } from '../stats/syncStats.js';
import { renderDashboardHtml } from './render.js';
import { appsTabReply, statsApiReply } from './statsRoutes.js';
import {
  DashboardServer,
  type DashboardServerService,
  type DashboardHttpReply,
  type DashboardHttpRequest,
} from './server.js';

export const DEFAULT_DASHBOARD_HOST = '127.0.0.1';
export const DEFAULT_DASHBOARD_PORT = 4477;

export const DashboardCommandInputSchema = Schema.Struct({
  host: Schema.optionalWith(Schema.String, { default: () => DEFAULT_DASHBOARD_HOST }),
  port: Schema.optionalWith(Schema.String, { default: () => String(DEFAULT_DASHBOARD_PORT) }),
  json: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});

export type DashboardCommandInput = Schema.Schema.Type<typeof DashboardCommandInputSchema>;

/** Gathering, rendering, or serving the dashboard failed. */
export type DashboardCommandFailure = Readonly<{
  readonly _tag: 'DashboardCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

const makeDashboardCommandFailure = Data.tagged<DashboardCommandFailure>('DashboardCommandFailure');

const DashboardCommandFailureSchema: Schema.Schema<DashboardCommandFailure> = Schema.Struct({
  _tag: Schema.Literal('DashboardCommandFailure'),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
});

type DashboardStateRequirements = Effect.Effect.Context<ReturnType<typeof gatherDashboardState>>;

type DashboardCommandRequirements =
  | DashboardServerService
  | DashboardStateRequirements
  | Logger
  | StatsSyncRequirements;

/** Normalize one dashboard command failure. */
const dashboardFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): DashboardCommandFailure => {
  let message = errorMessage(cause);
  if (explicitMessage !== undefined) message = explicitMessage;
  return makeDashboardCommandFailure({ operation, message, cause });
};

/** Decode and validate the port string received from Commander. */
export const parseDashboardPort = (
  portText: string,
): Effect.Effect<number, DashboardCommandFailure> => {
  const port = Number.parseInt(portText, 10);
  let invalidPort = !Number.isInteger(port);
  if (port < 1) invalidPort = true;
  if (port > 65535) invalidPort = true;
  if (!invalidPort) return Effect.succeed(port);
  return Effect.fail(
    dashboardFailure(
      'validate dashboard port',
      portText,
      `Invalid --port "${portText}" - must be an integer between 1 and 65535.`,
    ),
  );
};

const NOT_FOUND_REPLY: DashboardHttpReply = {
  status: 404,
  contentType: 'text/plain; charset=utf-8',
  content: 'Not found',
};

const showOverviewReply = (
  logger: Logger,
): Effect.Effect<DashboardHttpReply, never, DashboardStateRequirements> =>
  Effect.gen(function* () {
    const renderedDashboard = yield* gatherDashboardState().pipe(
      Effect.flatMap(renderDashboardHtml),
      Effect.either,
    );
    if (renderedDashboard._tag === 'Right') {
      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        content: renderedDashboard.right,
      };
    }
    yield* logger
      .error(`dashboard render failed: ${errorMessage(renderedDashboard.left)}`)
      .pipe(Effect.catchAll(() => Effect.void));
    return {
      status: 500,
      contentType: 'text/plain; charset=utf-8',
      content: 'Failed to read local state - see the terminal running `launch dashboard`.',
    };
  });

type DashboardRouteRequirements = DashboardStateRequirements | StatsSyncRequirements;

interface DashboardRoute {
  readonly path: string;
  readonly reply: (
    searchParams: URLSearchParams,
    logger: Logger,
  ) => Effect.Effect<DashboardHttpReply, never, DashboardRouteRequirements>;
}

const DASHBOARD_ROUTES: readonly DashboardRoute[] = [
  { path: '/', reply: (_searchParams, logger) => showOverviewReply(logger) },
  { path: '/index.html', reply: (_searchParams, logger) => showOverviewReply(logger) },
  { path: '/apps', reply: appsTabReply },
  { path: '/api/stats', reply: statsApiReply },
];

/** Answer one GET route; every other method or path is a 404. */
export const dashboardHttpReply = (
  dashboardRequest: DashboardHttpRequest,
  logger: Logger,
): Effect.Effect<DashboardHttpReply, never, DashboardRouteRequirements> =>
  Effect.gen(function* () {
    const isGetRequest = dashboardRequest.method === 'GET';
    if (!isGetRequest) return NOT_FOUND_REPLY;
    let requestUrl = '/';
    if (dashboardRequest.url !== undefined) requestUrl = dashboardRequest.url;
    const parsedUrl = new URL(requestUrl, 'http://127.0.0.1');
    const requestedRoute = DASHBOARD_ROUTES.find((route) => route.path === parsedUrl.pathname);
    if (requestedRoute === undefined) return NOT_FOUND_REPLY;
    return yield* requestedRoute.reply(parsedUrl.searchParams, logger);
  });

/** Run the schema-decoded local dashboard command. */
export const dashboardCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, DashboardCommandFailure, DashboardCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(DashboardCommandInputSchema)(rawCommandInput);
    const logger = yield* createLogger(false);
    if (commandInput.json) {
      const dashboardState = yield* gatherDashboardState();
      yield* logger.line(JSON.stringify(dashboardState, null, 2));
      return;
    }
    const port = yield* parseDashboardPort(commandInput.port);
    yield* gatherDashboardState();
    const routeServices = yield* Effect.context<DashboardRouteRequirements>();
    const dashboardServer = yield* DashboardServer;
    yield* dashboardServer.serve({
      host: commandInput.host,
      port,
      handleRequest: (dashboardRequest) =>
        dashboardHttpReply(dashboardRequest, logger).pipe(Effect.provide(routeServices)),
      onListening: () =>
        logger.note(`launch dashboard -> http://${commandInput.host}:${port} - Ctrl+C to stop`),
    });
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(DashboardCommandFailureSchema)(cause)) return cause;
      return dashboardFailure('run local dashboard', cause);
    }),
  );
