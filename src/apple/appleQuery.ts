// Encodes App Store Connect query strings, request URLs, and documentation links.

const APPLE_API_ORIGIN = 'https://api.appstoreconnect.apple.com';

function encodeAppleQueryKey(key: string): string {
  return encodeURIComponent(key).replaceAll('%5B', '[').replaceAll('%5D', ']');
}

function writeQueryField(key: string, field: unknown): string | null {
  const isMissing = field == null;

  if (isMissing) {
    return null;
  }

  const isList = Array.isArray(field);

  if (isList) {
    const isEmpty = field.length === 0;

    if (isEmpty) {
      return null;
    }

    return `${encodeAppleQueryKey(key)}=${encodeURIComponent(field.join(','))}`;
  }

  const isText = typeof field === 'string';

  if (isText) {
    return `${encodeAppleQueryKey(key)}=${encodeURIComponent(field)}`;
  }

  const isNumber = typeof field === 'number';

  if (isNumber) {
    return `${encodeAppleQueryKey(key)}=${encodeURIComponent(String(field))}`;
  }

  const isBoolean = typeof field === 'boolean';

  if (isBoolean) {
    return `${encodeAppleQueryKey(key)}=${encodeURIComponent(String(field))}`;
  }

  return null;
}

/** Apple's list query: brackets stay literal and array fields are comma-separated. */
export function writeAppleQuery(query: object | undefined): string {
  const isMissing = query == null;

  if (isMissing) {
    return '';
  }

  const parts: string[] = [];
  const queryFields = query as Record<string, unknown>;

  for (const [key, field] of Object.entries(queryFields)) {
    const part = writeQueryField(key, field);
    const isSkipped = part == null;

    if (isSkipped) {
      continue;
    }

    parts.push(part);
  }

  return parts.join('&');
}

function fillApplePath(pathTemplate: string, resourceId: string | undefined): string {
  const isMissing = resourceId == null;

  if (isMissing) {
    return pathTemplate;
  }

  return pathTemplate.replaceAll('{id}', encodeURIComponent(resourceId));
}

/** Absolute App Store Connect URL for one OpenAPI path template. */
export function appleRequestUrl(
  pathTemplate: string,
  resourceId: string | undefined,
  query: object | undefined,
): string {
  const path = fillApplePath(pathTemplate, resourceId);
  const queryText = writeAppleQuery(query);
  const hasQuery = queryText.length > 0;

  if (hasQuery) {
    return `${APPLE_API_ORIGIN}${path}?${queryText}`;
  }

  return `${APPLE_API_ORIGIN}${path}`;
}

/** Official documentation page for one App Store Connect operation. */
export function appleDocumentationUrl(method: string, pathTemplate: string): string {
  const slug = pathTemplate.replaceAll('{id}', '_id_').replaceAll('/', '-').slice(1).toLowerCase();

  return `https://developer.apple.com/documentation/appstoreconnectapi/${method.toLowerCase()}-${slug}`;
}
