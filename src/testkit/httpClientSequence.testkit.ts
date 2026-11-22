interface HttpClientSequenceReply {
  readonly status: number;
  readonly document: unknown;
}

interface HttpClientSequenceRoute {
  readonly method: string;
  readonly url: string;
  readonly replies: readonly HttpClientSequenceReply[];
}

interface HttpClientSentRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly sentDocument: string | null;
}

interface HttpClientSequenceTest {
  readonly sentRequests: HttpClientSentRequest[];
  answer(call: HttpClientSentRequest): Response;
}

function isMissing(candidate: unknown): candidate is null | undefined {
  return candidate == null;
}

function findRoute(
  routes: readonly HttpClientSequenceRoute[],
  method: string,
  url: string,
): HttpClientSequenceRoute | undefined {
  function isRequestedRoute(route: HttpClientSequenceRoute): boolean {
    const isDifferentMethod = route.method != method;

    if (isDifferentMethod) {
      return false;
    }

    return route.url == url;
  }

  return routes.find(isRequestedRoute);
}

function readAnsweredCount(answeredCounts: Map<string, number>, routeKey: string): number {
  const answeredCount = answeredCounts.get(routeKey);

  if (isMissing(answeredCount)) {
    return 0;
  }

  return answeredCount;
}

function readReply(
  route: HttpClientSequenceRoute,
  answeredCount: number,
  routeKey: string,
): HttpClientSequenceReply {
  const lastReplyIndex = route.replies.length - 1;
  const replyIndex = Math.min(answeredCount, lastReplyIndex);
  const reply = route.replies[replyIndex];

  if (isMissing(reply)) {
    throw new Error(`Route ${routeKey} has no replies`);
  }

  return reply;
}

/** Each route answers its replies in order (the last one repeats); every request is recorded. */
export function makeHttpClientSequenceTest(
  routes: readonly HttpClientSequenceRoute[],
): HttpClientSequenceTest {
  const sentRequests: HttpClientSentRequest[] = [];
  const answeredCounts = new Map<string, number>();

  function answer(call: HttpClientSentRequest): Response {
    const routeKey = `${call.method} ${call.url}`;
    sentRequests.push(call);

    const requestedRoute = findRoute(routes, call.method, call.url);

    if (isMissing(requestedRoute)) {
      throw new Error(`No test route for ${routeKey}`);
    }

    const answeredCount = readAnsweredCount(answeredCounts, routeKey);
    answeredCounts.set(routeKey, answeredCount + 1);
    const reply = readReply(requestedRoute, answeredCount, routeKey);
    const replyDocument = JSON.stringify(reply.document);

    return new Response(replyDocument, {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  return { sentRequests, answer };
}
