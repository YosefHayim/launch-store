import { createServer } from 'node:http';
import { Context, Data, Effect, Layer } from 'effect';

/** The request fields needed by the local dashboard router. */
export type DashboardHttpRequest = Readonly<{
  method: string | undefined;
  url: string | undefined;
}>;

/** One complete local dashboard HTTP reply. */
export type DashboardHttpReply = Readonly<{
  status: number;
  contentType: string;
  content: string;
}>;

/** Binding or serving the local dashboard failed. */
export type DashboardServerFailure = Readonly<{
  readonly _tag: 'DashboardServerFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeDashboardServerFailure =
  Data.tagged<DashboardServerFailure>('DashboardServerFailure');

/** Injectable local HTTP transport for the dashboard command. */
export type DashboardServerService = Readonly<{
  serve: (serverOptions: {
    host: string;
    port: number;
    handleRequest: (dashboardRequest: DashboardHttpRequest) => Effect.Effect<DashboardHttpReply>;
    onListening: () => Effect.Effect<void, unknown>;
  }) => Effect.Effect<never, DashboardServerFailure>;
}>;

export const DashboardServer = Context.GenericTag<DashboardServerService>(
  'launch-store/DashboardServer',
);

/** Node HTTP implementation used only at the live transport boundary. */
export const DashboardServerLive = Layer.succeed(DashboardServer, {
  serve: (serverOptions) =>
    Effect.async<never, DashboardServerFailure>((resume) => {
      let listening = false;
      const dashboardServer = createServer((incomingRequest, outgoingReply) => {
        void Effect.runPromise(
          serverOptions.handleRequest({
            method: incomingRequest.method,
            url: incomingRequest.url,
          }),
        )
          .then((dashboardReply) => {
            outgoingReply.writeHead(dashboardReply.status, {
              'content-type': dashboardReply.contentType,
            });
            outgoingReply.end(dashboardReply.content);
          })
          .catch(() => {
            outgoingReply.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
            outgoingReply.end('Failed to render the local dashboard.');
          });
      });
      const failServer = (cause: NodeJS.ErrnoException): void => {
        let message = cause.message;
        if (!listening && cause.code === 'EADDRINUSE') {
          message = `Port ${serverOptions.port} on ${serverOptions.host} is already in use - pick another with --port.`;
        }
        resume(Effect.fail(makeDashboardServerFailure({ message, cause })));
      };
      dashboardServer.once('error', failServer);
      dashboardServer.listen(serverOptions.port, serverOptions.host, () => {
        listening = true;
        dashboardServer.removeListener('error', failServer);
        dashboardServer.on('error', failServer);
        void Effect.runPromise(serverOptions.onListening()).catch((cause: unknown) => {
          resume(
            Effect.fail(
              makeDashboardServerFailure({
                message: 'The dashboard listening notice could not be written.',
                cause,
              }),
            ),
          );
        });
      });
      return Effect.sync(() => dashboardServer.close());
    }),
} satisfies DashboardServerService);
