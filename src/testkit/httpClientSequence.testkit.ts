import { HttpClient, HttpClientResponse } from '@effect/platform';
import { Effect, Layer } from 'effect';

export interface HttpClientSequenceReply {
  readonly status: number;
  readonly body: unknown;
}

export interface HttpClientSequenceRoute {
  readonly method: string;
  readonly url: string;
  readonly replies: readonly HttpClientSequenceReply[];
}

export interface HttpClientSentRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly bodyText: string | null;
}

export interface HttpClientSequenceTest {
  readonly layer: Layer.Layer<HttpClient.HttpClient>;
  readonly sentRequests: HttpClientSentRequest[];
}

const readBodyText = (body: { readonly _tag: string; readonly body?: unknown }): string | null => {
  if (body._tag !== 'Uint8Array') return null;
  return new TextDecoder().decode(body.body as Uint8Array);
};

/** Each route answers its replies in order (the last one repeats); every request is recorded. */
export const makeHttpClientSequenceTest = (
  routes: readonly HttpClientSequenceRoute[],
): HttpClientSequenceTest => {
  const sentRequests: HttpClientSentRequest[] = [];
  const answeredCounts = new Map<string, number>();
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const routeKey = `${request.method} ${request.url}`;
      sentRequests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers['authorization'] ?? null,
        bodyText: readBodyText(request.body),
      });
      const matchedRoute = routes.find(
        (route) => route.method === request.method && route.url === request.url,
      );
      if (matchedRoute === undefined) {
        return Effect.die(new Error(`No test route for ${routeKey}`));
      }
      const answeredCount = answeredCounts.get(routeKey) ?? 0;
      answeredCounts.set(routeKey, answeredCount + 1);
      const lastReplyIndex = matchedRoute.replies.length - 1;
      const reply = matchedRoute.replies[Math.min(answeredCount, lastReplyIndex)];
      if (reply === undefined) return Effect.die(new Error(`Route ${routeKey} has no replies`));
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(reply.body), {
            status: reply.status,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );
    }),
  );
  return { layer, sentRequests };
};
