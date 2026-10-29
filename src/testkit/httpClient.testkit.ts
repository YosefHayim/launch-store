import { HttpClient, HttpClientResponse } from '@effect/platform';
import { Effect, Layer } from 'effect';

export interface HttpClientTestRoute {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly body: unknown;
}

const pickReplyBytesOrDocument = (routeBody: unknown): string | Uint8Array<ArrayBuffer> => {
  const isBodyBytes = routeBody instanceof Uint8Array;
  if (isBodyBytes) return new Uint8Array(routeBody);
  return JSON.stringify(routeBody);
};

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
      const replyBytesOrDocument = pickReplyBytesOrDocument(matchedRoute.body);
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(replyBytesOrDocument, {
            status: matchedRoute.status,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );
    }),
  );
