#!/usr/bin/env python3
"""Write typed methods for every current App Store Connect and Google Play operation.

Reads Apple's published OpenAPI zip and the official Google client declarations.
Run `pnpm gen:asc` first when the Apple spec has moved, or use `pnpm gen:api`.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APPLE_SPEC_URL = (
    "https://developer.apple.com/sample-code/app-store-connect/"
    "app-store-connect-openapi-specification.zip"
)
PUBLISHER_DISCOVERY = "https://androidpublisher.googleapis.com/$discovery/rest?version=v3"
REPORTING_DISCOVERY = (
    "https://playdeveloperreporting.googleapis.com/$discovery/rest?version=v1beta1"
)

APPLE_ACTIONS = (
    ("replaceToManyRelationship", "replace", "Linkage"),
    ("createToManyRelationship", "add", "Linkage"),
    ("deleteToManyRelationship", "remove", "Linkage"),
    ("updateToOneRelationship", "update", "Linkage"),
    ("getToManyRelationship", "list", "Linkage"),
    ("getToOneRelationship", "get", "Linkage"),
    ("getToManyRelated", "list", ""),
    ("getToOneRelated", "get", ""),
    ("getCollection", "list", ""),
    ("createInstance", "create", ""),
    ("updateInstance", "update", ""),
    ("deleteInstance", "delete", ""),
    ("getInstance", "get", ""),
    ("getMetrics", "read", "Metrics"),
)

HTTP_METHODS = ("get", "post", "patch", "put", "delete")


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "launch-store"})
    with urllib.request.urlopen(request, timeout=90) as reply:
        return reply.read()


def fetch_json(url: str) -> dict:
    return json.loads(fetch_bytes(url).decode())


def one_line(text: str) -> str:
    collapsed = re.sub(r"\s+", " ", text).strip()
    collapsed = collapsed.replace("*/", "* /")
    if collapsed.startswith("@"):
        collapsed = " " + collapsed
    if len(collapsed) > 180:
        return collapsed[:177].rstrip() + "..."
    return collapsed


def pascal(parts: list[str]) -> str:
    words: list[str] = []
    for part in parts:
        if part == "":
            continue
        words.append(part[:1].upper() + part[1:])
    return "".join(words)


def apple_method_name(operation_id: str) -> str:
    for action, verb, suffix in APPLE_ACTIONS:
        marker = "_" + action
        if operation_id.endswith(marker):
            resource = operation_id[: -len(marker)]
            return verb + pascal(resource.split("_")) + suffix
    return operation_id[:1].lower() + pascal(operation_id.split("_"))[1:]


def apple_spec() -> tuple[dict, str]:
    archive = zipfile.ZipFile(BytesIO(fetch_bytes(APPLE_SPEC_URL)))
    names = [
        name
        for name in archive.namelist()
        if name.endswith(".json") and "__MACOSX" not in name
    ]
    if len(names) != 1:
        raise SystemExit(f"expected one OpenAPI json, found {names}")
    spec = json.loads(archive.read(names[0]))
    version = spec.get("info", {}).get("version", "")
    return spec, str(version)


def schema_operation_ids() -> set[str]:
    schema_path = ROOT / "src/apple/generated/schema.ts"
    schema = schema_path.read_text()
    operations_at = schema.find("export interface operations")
    if operations_at < 0:
        raise SystemExit(f"{schema_path} has no operations interface. Run pnpm gen:asc.")
    return set(re.findall(r"^    ([A-Za-z0-9_]+): \{$", schema[operations_at:], re.M))


def success_response(operation: dict) -> tuple[str, str, str]:
    responses = operation.get("responses") or {}
    codes = sorted(code for code in responses if str(code).startswith("2"))
    if len(codes) == 0:
        return "void", "empty", "200"
    code = str(codes[0])
    content = (responses[code] or {}).get("content") or {}
    if len(content) == 0:
        return "void", "empty", code
    if "application/json" in content:
        return "json", "application/json", code
    for content_type in content:
        if content_type.endswith("+json"):
            return "json", content_type, code
    if "text/csv" in content:
        return "csv", "text/csv", code
    if "application/a-gzip" in content:
        return "gzip", "application/a-gzip", code
    content_type = next(iter(content))
    return "json", content_type, code


def has_query(path_item: dict, operation: dict) -> bool:
    parameters = list(path_item.get("parameters") or []) + list(operation.get("parameters") or [])
    for parameter in parameters:
        if parameter.get("in") == "query":
            return True
    return False


def apple_methods(spec: dict, known_ids: set[str]) -> str:
    blocks: list[str] = []
    used: dict[str, str] = {}
    missing: list[str] = []
    for path, path_item in spec["paths"].items():
        for http_method in HTTP_METHODS:
            operation = path_item.get(http_method)
            if not isinstance(operation, dict):
                continue
            operation_id = operation.get("operationId")
            if not isinstance(operation_id, str):
                raise SystemExit(f"{http_method.upper()} {path} has no operationId")
            if operation_id not in known_ids:
                missing.append(operation_id)
                continue
            method_name = apple_method_name(operation_id)
            previous = used.get(method_name)
            if previous is not None:
                raise SystemExit(f"method name {method_name} is used by {previous} and {operation_id}")
            used[method_name] = operation_id
            blocks.append(render_apple_method(http_method, path, operation_id, operation, path_item, method_name))
    if len(missing) > 0:
        preview = "\n".join(missing[:20])
        raise SystemExit(
            f"{len(missing)} operations are missing from schema.ts. Run pnpm gen:asc.\n{preview}"
        )
    print(f"apple methods {len(blocks)}")
    return "\n\n".join(blocks) + "\n"


def render_apple_method(
    http_method: str,
    path: str,
    operation_id: str,
    operation: dict,
    path_item: dict,
    method_name: str,
) -> str:
    kind, content_type, code = success_response(operation)
    summary = one_line(
        str(operation.get("summary") or operation.get("description") or f"{http_method.upper()} {path}")
    )
    documentation = (
        "https://developer.apple.com/documentation/appstoreconnectapi/"
        + http_method
        + "-"
        + path.replace("{id}", "_id_").replace("/", "-").lstrip("-").lower()
    )
    arguments: list[str] = []
    resource_argument = "undefined"
    query_argument = "undefined"
    if "{id}" in path:
        arguments.append("resourceId: string")
        resource_argument = "resourceId"
    request_body = operation.get("requestBody") or {}
    body_content = (request_body.get("content") or {}) if isinstance(request_body, dict) else {}
    has_body = "application/json" in body_content
    if has_body:
        arguments.append(
            f"document: operations['{operation_id}']['requestBody']['content']['application/json']"
        )
    if has_query(path_item, operation):
        arguments.append(f"query?: operations['{operation_id}']['parameters']['query']")
        query_argument = "query"
    if kind == "void":
        return_type = "void"
    elif kind == "csv":
        return_type = "string"
    elif kind == "gzip":
        return_type = "Buffer"
    else:
        return_type = (
            f"operations['{operation_id}']['responses'][{code}]['content']['{content_type}']"
        )
    argument_text = ""
    if len(arguments) == 1:
        argument_text = arguments[0]
    elif len(arguments) > 1:
        argument_text = "\n    " + ",\n    ".join(arguments) + ",\n  "
    url_line = f"    const url = appleRequestUrl('{path}', {resource_argument}, {query_argument});"
    http = http_method.upper()
    if kind == "void":
        call = f"    await this.apple.sendJson('{http}', url);"
        if has_body:
            call = f"    await this.apple.sendJson('{http}', url, document);"
    elif kind == "csv":
        call = f"    return this.apple.sendText('{http}', url, 'text/csv');"
    elif kind == "gzip":
        call = f"    return this.apple.sendBytes('{http}', url, 'application/a-gzip');"
    elif has_body:
        call = f"    return this.apple.sendJson('{http}', url, document);"
    else:
        call = f"    return this.apple.sendJson('{http}', url);"
    return (
        f"  /**\n"
        f"   * {summary}\n"
        f"   * @see {{@link {documentation}}}\n"
        f"   */\n"
        f"  async {method_name}({argument_text}): Promise<{return_type}> {{\n"
        f"{url_line}\n"
        f"{call}\n"
        f"  }}"
    )


def walk_discovery(node: dict, prefix: str) -> list[dict]:
    methods: list[dict] = []
    for name, method in (node.get("methods") or {}).items():
        discovery_id = name if prefix == "" else prefix + "." + name
        methods.append(
            {
                "id": discovery_id,
                "description": str(method.get("description") or name),
            }
        )
    for resource_name, resource in (node.get("resources") or {}).items():
        child = resource_name if prefix == "" else prefix + "." + resource_name
        methods.extend(walk_discovery(resource, child))
    return methods


def params_type_name(discovery_id: str) -> str:
    tokens: list[str] = []
    for part in discovery_id.split("."):
        lowered = part.lower()
        tokens.append(lowered[:1].upper() + lowered[1:])
    return "Params$Resource$" + "$".join(tokens)


def google_method_name(discovery_id: str) -> str:
    parts = discovery_id.split(".")
    verb = parts[-1]
    return verb + pascal(parts[:-1])


def declaration_returns(declaration_text: str) -> dict[str, str]:
    pattern = re.compile(
        r"^\s+\w+\((.*)\)\: Promise<GaxiosResponseWithHTTP2<([^>]+)>>;",
        re.M,
    )
    found: dict[str, str] = {}
    for match in pattern.finditer(declaration_text):
        arguments, returned = match.group(1), match.group(2)
        if "StreamMethodOptions" in arguments or "Readable" == returned:
            continue
        params_match = re.search(r"Params\$Resource\$[A-Za-z0-9$]+", arguments)
        if params_match is None:
            continue
        found[params_match.group(0)] = returned
    return found


def render_google_method(
    discovery_id: str,
    description: str,
    method_name: str,
    params_type: str,
    return_name: str,
    namespace: str,
    documentation: str,
    receiver: str,
) -> str:
    summary = one_line(description.split(".")[0] + ".")
    if summary == ".":
        summary = one_line(description)
    qualified_params = f"{namespace}.{params_type}"
    if return_name == "void":
        return_type = "void"
        call_tail = ".pipe(Effect.asVoid)"
    elif return_name == "unknown":
        return_type = "unknown"
        call_tail = ""
    else:
        return_type = f"{namespace}.{return_name}"
        call_tail = ""
    return (
        f"  /**\n"
        f"   * {summary}\n"
        f"   * @see {{@link {documentation}}}\n"
        f"   */\n"
        f"  {method_name}(\n"
        f"    parameters: {qualified_params},\n"
        f"  ): Effect.Effect<{return_type}, {receiver['error']}> {{\n"
        f"    return {receiver['runner']}(\n"
        f"      '{discovery_id}',\n"
        f"      () => this.{receiver['field']}.{discovery_id}(parameters),\n"
        f"    ){call_tail};\n"
        f"  }}"
    )


def google_methods(
    discovery: dict,
    declaration_text: str,
    namespace: str,
    documentation_prefix: str,
    receiver: dict[str, str],
) -> tuple[str, list[str]]:
    returns = declaration_returns(declaration_text)
    blocks: list[str] = []
    skipped: list[str] = []
    used: dict[str, str] = {}
    for method in walk_discovery(discovery, ""):
        discovery_id = method["id"]
        params_name = params_type_name(discovery_id)
        return_name = returns.get(params_name)
        if return_name is None:
            skipped.append(discovery_id)
            continue
        method_name = google_method_name(discovery_id)
        previous = used.get(method_name)
        if previous is not None:
            raise SystemExit(f"method name {method_name} is used by {previous} and {discovery_id}")
        used[method_name] = discovery_id
        parts = discovery_id.split(".")
        documentation = documentation_prefix + ".".join(parts[:-1]) + "/" + parts[-1]
        blocks.append(
            render_google_method(
                discovery_id,
                method["description"],
                method_name,
                params_name,
                return_name,
                namespace,
                documentation,
                receiver,
            )
        )
    print(f"{receiver['label']} methods {len(blocks)} skipped {len(skipped)}")
    for discovery_id in skipped:
        print(f"  skipped {discovery_id}")
    return "\n\n".join(blocks) + "\n", skipped


def write_apple(spec: dict, known_ids: set[str], version: str) -> None:
    methods = apple_methods(spec, known_ids)
    contents = f"""// Generated from Apple's App Store Connect OpenAPI spec {version}.
// Reproduce: pnpm gen:api

import {{ AppStoreConnectClient }} from './ascClient.js';
import {{ appleRequestUrl }} from './appleQuery.js';
import type {{ operations }} from './generated/schema.js';

/** Every operation in Apple's App Store Connect OpenAPI spec, on the shared JWT client. */
export class AppStoreConnectApi {{
  constructor(private readonly apple: AppStoreConnectClient) {{}}

{methods}}}
"""
    destination = ROOT / "src/apple/appStoreConnectApi.ts"
    destination.write_text(contents)
    print(f"wrote {destination}")


def skipped_note(skipped: list[str]) -> str:
    if len(skipped) == 0:
        return ""
    lines = "\n".join(f"// - {discovery_id}" for discovery_id in skipped)
    return (
        "// The installed official client does not declare these Discovery methods yet:\n"
        + lines
        + "\n"
    )


def write_play(discovery: dict, declaration_text: str) -> None:
    methods, skipped = google_methods(
        discovery,
        declaration_text,
        "androidpublisher_v3",
        "https://developers.google.com/android-publisher/api-ref/rest/v3/",
        {
            "error": "GooglePlayApiError",
            "runner": "runPlayCall",
            "field": "publisher",
            "label": "play",
        },
    )
    contents = f"""// Generated from the Android Publisher v3 Discovery document.
// Reproduce: pnpm gen:api
{skipped_note(skipped)}

import {{
  androidpublisher,
  auth as androidPublisherAuth,
  type androidpublisher_v3,
}} from '@googleapis/androidpublisher';
import {{ Effect }} from 'effect';
import type {{ ServiceAccount }} from '../core/types/credentials.js';
import {{
  googleFailureMessage,
  googleFailureStatus,
  makeGooglePlayApiError,
  serviceAccountJwtOptions,
  type GooglePlayApiError,
}} from './playClient.js';

const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

type PlayPublisher = ReturnType<typeof androidpublisher>;

const isPlayPublisher = (
  generatedPublisher: PlayPublisher | undefined,
): generatedPublisher is PlayPublisher => {{
  return generatedPublisher != null;
}};

const isHttpStatus = (statusCode: number | undefined): statusCode is number => {{
  return typeof statusCode === 'number';
}};

const playFailure = (operation: string, cause: unknown): GooglePlayApiError => {{
  const statusCode = googleFailureStatus(cause);
  const message = `Google Play ${{operation}} failed: ${{googleFailureMessage(cause)}}`;

  if (isHttpStatus(statusCode)) {{
    return makeGooglePlayApiError({{ operation, statusCode, message, cause }});
  }}

  return makeGooglePlayApiError({{ operation, message, cause }});
}};

const runPlayCall = <PlayShape>(
  operation: string,
  invoke: () => PromiseLike<{{ data: PlayShape }}>,
): Effect.Effect<PlayShape, GooglePlayApiError> => {{
  return Effect.tryPromise({{
    try: invoke,
    catch: (cause) => playFailure(operation, cause),
  }}).pipe(Effect.map((completed) => completed.data));
}};

/** Every Android Publisher v3 method, on Google's official client. */
export class GooglePlayApi {{
  private readonly publisher: PlayPublisher;

  constructor(account: ServiceAccount, generatedPublisher?: PlayPublisher) {{
    if (isPlayPublisher(generatedPublisher)) {{
      this.publisher = generatedPublisher;
      return;
    }}

    const googleAuthentication = new androidPublisherAuth.JWT(
      serviceAccountJwtOptions(account, [PLAY_SCOPE]),
    );
    this.publisher = androidpublisher({{ version: 'v3', auth: googleAuthentication }});
  }}

{methods}}}
"""
    destination = ROOT / "src/google/playApi.ts"
    destination.write_text(contents)
    print(f"wrote {destination}")


def write_reporting(discovery: dict, declaration_text: str) -> None:
    methods, skipped = google_methods(
        discovery,
        declaration_text,
        "playdeveloperreporting_v1beta1",
        "https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/",
        {
            "error": "PlayReportingApiError",
            "runner": "runReportingCall",
            "field": "reporting",
            "label": "reporting",
        },
    )
    contents = f"""// Generated from the Play Developer Reporting v1beta1 Discovery document.
// Reproduce: pnpm gen:api
{skipped_note(skipped)}

import {{
  auth as playReportingAuth,
  playdeveloperreporting,
  type playdeveloperreporting_v1beta1,
}} from '@googleapis/playdeveloperreporting';
import {{ Effect }} from 'effect';
import type {{ ServiceAccount }} from '../core/types/credentials.js';
import {{ serviceAccountJwtOptions }} from './playClient.js';
import {{ makePlayReportingApiError, type PlayReportingApiError }} from './playReporting.js';

const REPORTING_SCOPE = 'https://www.googleapis.com/auth/playdeveloperreporting';

type ReportingPublisher = ReturnType<typeof playdeveloperreporting>;

const isReportingPublisher = (
  generatedReporting: ReportingPublisher | undefined,
): generatedReporting is ReportingPublisher => {{
  return generatedReporting != null;
}};

const reportingFailure = (operation: string, cause: unknown): PlayReportingApiError => {{
  const isError = cause instanceof Error;

  if (isError) {{
    return makePlayReportingApiError({{
      operation,
      message: `Play reporting ${{operation}} failed: ${{cause.message}}`,
      cause,
    }});
  }}

  return makePlayReportingApiError({{
    operation,
    message: `Play reporting ${{operation}} failed: ${{String(cause)}}`,
    cause,
  }});
}};

const runReportingCall = <ReportShape>(
  operation: string,
  invoke: () => PromiseLike<{{ data: ReportShape }}>,
): Effect.Effect<ReportShape, PlayReportingApiError> => {{
  return Effect.tryPromise({{
    try: invoke,
    catch: (cause) => reportingFailure(operation, cause),
  }}).pipe(Effect.map((completed) => completed.data));
}};

/** Every Play Developer Reporting v1beta1 method, on Google's official client. */
export class PlayReportingApi {{
  private readonly reporting: ReportingPublisher;

  constructor(account: ServiceAccount, generatedReporting?: ReportingPublisher) {{
    if (isReportingPublisher(generatedReporting)) {{
      this.reporting = generatedReporting;
      return;
    }}

    const googleAuthentication = new playReportingAuth.JWT(
      serviceAccountJwtOptions(account, [REPORTING_SCOPE]),
    );
    this.reporting = playdeveloperreporting({{
      version: 'v1beta1',
      auth: googleAuthentication,
    }});
  }}

{methods}}}
"""
    destination = ROOT / "src/google/playReportingApi.ts"
    destination.write_text(contents)
    print(f"wrote {destination}")


def main() -> None:
    spec, version = apple_spec()
    print(f"apple spec {version}")
    known_ids = schema_operation_ids()
    write_apple(spec, known_ids, version)
    publisher = fetch_json(PUBLISHER_DISCOVERY)
    reporting = fetch_json(REPORTING_DISCOVERY)
    publisher_declarations = (
        ROOT / "node_modules/@googleapis/androidpublisher/build/v3.d.ts"
    ).read_text()
    reporting_declarations = (
        ROOT / "node_modules/@googleapis/playdeveloperreporting/build/v1beta1.d.ts"
    ).read_text()
    write_play(publisher, publisher_declarations)
    write_reporting(reporting, reporting_declarations)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        raise
