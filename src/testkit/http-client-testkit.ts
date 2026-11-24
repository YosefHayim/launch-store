interface HttpClientTestRoute {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly document: unknown;
}

interface HttpClientSentCall {
  readonly method: string;
  readonly url: string;
  readonly sentDocument: string | null;
}

interface HttpClientTest {
  readonly sentRequests: HttpClientSentCall[];

  answer(call: HttpClientSentCall): Response;
}

function findRoute(
  routes: readonly HttpClientTestRoute[],
  method: string,
  url: string,
): HttpClientTestRoute | undefined {
  function isRequestedRoute(route: HttpClientTestRoute): boolean {
    const isDifferentMethod = route.method != method;

    if (isDifferentMethod) {
      return false;
    }

    return route.url == url;
  }

  return routes.find(isRequestedRoute);
}

function createReplyDocument(routeDocument: unknown): string | Uint8Array<ArrayBuffer> {
  const isByteDocument = routeDocument instanceof Uint8Array;

  if (isByteDocument) {
    return Uint8Array.from(routeDocument);
  }

  return JSON.stringify(routeDocument);
}

export function makeHttpClientTest(routes: readonly HttpClientTestRoute[]): HttpClientTest {
  const sentRequests: HttpClientSentCall[] = [];

  function answer(call: HttpClientSentCall): Response {
    sentRequests.push(call);

    const matchedRoute = findRoute(routes, call.method, call.url);

    if (matchedRoute == null) {
      throw new Error(`No test route for ${call.method} ${call.url}`);
    }

    const replyDocument = createReplyDocument(matchedRoute.document);

    return new Response(replyDocument, {
      status: matchedRoute.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  return { sentRequests, answer };
}
