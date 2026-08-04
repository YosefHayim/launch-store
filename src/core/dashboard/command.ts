import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { gatherDashboardState } from './state.js';
import { renderDashboardHtml } from './render.js';
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

export const makeDashboardCommandFailure =
  Data.tagged<DashboardCommandFailure>('DashboardCommandFailure');

export const DashboardCommandFailureSchema: Schema.Schema<DashboardCommandFailure> = Schema.Struct({
  _tag: Schema.Literal('DashboardCommandFailure'),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
});

type DashboardStateRequirements = Effect.Effect.Context<ReturnType<typeof gatherDashboardState>>;

type DashboardCommandRequirements = DashboardServerService | DashboardStateRequirements | Logger;

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

/** Render one dashboard route from freshly gathered local state. */
export const dashboardHttpReply = (
  dashboardRequest: DashboardHttpRequest,
  logger: Logger,
): Effect.Effect<DashboardHttpReply, never, DashboardStateRequirements> =>
  Effect.gen(function* () {
    if (dashboardRequest.method !== 'GET') {
      return {
        status: 404,
        contentType: 'text/plain; charset=utf-8',
        content: 'Not found',
      };
    }
    let requestUrl = '/';
    if (dashboardRequest.url !== undefined) requestUrl = dashboardRequest.url;
    const requestPath = requestUrl.split('?')[0];
    if (requestPath !== '/' && requestPath !== '/index.html') {
      return {
        status: 404,
        contentType: 'text/plain; charset=utf-8',
        content: 'Not found',
      };
    }
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
    const dashboardContext = yield* Effect.context<DashboardStateRequirements>();
    const dashboardServer = yield* DashboardServer;
    yield* dashboardServer.serve({
      host: commandInput.host,
      port,
      handleRequest: (dashboardRequest) =>
        dashboardHttpReply(dashboardRequest, logger).pipe(Effect.provide(dashboardContext)),
      onListening: () =>
        logger.note(`launch dashboard -> http://${commandInput.host}:${port} - Ctrl+C to stop`),
    });
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(DashboardCommandFailureSchema)(cause)) return cause;
      return dashboardFailure('run local dashboard', cause);
    }),
  );
