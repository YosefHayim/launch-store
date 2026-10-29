import { HttpClient, HttpClientResponse } from '@effect/platform';
import { Effect, Layer } from 'effect';

export interface HttpClientTestRoute {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly body: unknown;
}

export const makeHttpClientTest = (
  routes: readonly HttpClientTestRoute[],
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const matchedRoute = routes.find(
        (route) => route.method === request.method && route.url === request.url,
      );
      if (matchedRoute === undefined) {
        return Effect.die(new Error(`No test route for ${request.method} ${request.url}`));
      }
      let replyBody: string | Uint8Array<ArrayBuffer> = JSON.stringify(matchedRoute.body);
      if (matchedRoute.body instanceof Uint8Array) replyBody = new Uint8Array(matchedRoute.body);
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(replyBody, {
            status: matchedRoute.status,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );
    }),
  );
