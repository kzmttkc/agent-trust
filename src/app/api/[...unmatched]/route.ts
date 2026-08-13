import { NextRequest, NextResponse } from "next/server";

// ============================================================
// JSON 404 for everything under /api that no real route matches.
//
// 2026-08-13 (machine-reader persona audit). Every genuine error this API
// produces is JSON, so an integrator writes one JSON parser and points it at
// the response body. A single typo in a path then fell through to the site's
// React not-found page: 23,700 bytes of HTML, `content-type: text/html`, and
// `Accept: application/json` ignored — the parser throws on `<`, the message
// says nothing about the path being wrong, and an agent retrying in a loop
// pulls 23KB per attempt. The 404 is the response most likely to be a machine's
// FIRST contact with this API, and it was the only one that changed format.
//
// Deliberately not a redirect and not a 200: the status stays 404, the shape
// matches the error envelope used everywhere else (`{ error: ... }`), and the
// body names the path that missed plus where the real ones are listed.
//
// Next.js route precedence puts every static and dynamic segment ahead of a
// catch-all, so this file can only be reached by a path that matches nothing —
// adding a route never has to be coordinated with it.
// ============================================================

export const dynamic = "force-dynamic";

const DOCS_URL = "https://vet402.com/docs/api";
const SCHEMA_URL = "https://github.com/kzmttkc/agent-trust/blob/main/docs/openapi.yaml";

/** Cap the echo: the path is caller-controlled, and a 404 must not become a
 *  way to make this endpoint emit an arbitrarily large body. */
function safePath(request: NextRequest): string {
  return request.nextUrl.pathname.slice(0, 256);
}

function notFound(request: NextRequest): NextResponse {
  return NextResponse.json(
    {
      error: "not_found",
      path: safePath(request),
      message:
        "No API route matches this path. See the documented endpoints at /docs/api, or the machine-readable schema at docs/openapi.yaml.",
      documentation: DOCS_URL,
      schema: SCHEMA_URL,
    },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  return notFound(request);
}
export async function POST(request: NextRequest) {
  return notFound(request);
}
export async function PUT(request: NextRequest) {
  return notFound(request);
}
export async function PATCH(request: NextRequest) {
  return notFound(request);
}
export async function DELETE(request: NextRequest) {
  return notFound(request);
}
export async function HEAD() {
  // Same status and headers, no body — a HEAD probe of a wrong path should not
  // learn a different answer from a GET of it.
  return new NextResponse(null, {
    status: 404,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
export async function OPTIONS(request: NextRequest) {
  return notFound(request);
}
