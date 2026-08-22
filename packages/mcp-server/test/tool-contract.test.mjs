// @vouchscore/mcp-server — tool contract (node:test).
//
// Two things this package promises the model, neither of which had a test:
//
//   1. every tool reports a failure as `isError: true` with a SANITIZED
//      message. A tool that swallowed an error into a normal text result
//      would read to the model as an answer — the worst possible failure mode
//      for a tool whose answers gate payments;
//   2. `check_payee_trust` tells the model that `degraded` / `signalsUnavailable`
//      outrank the recommendation (2026-08-22 audit: it did not).
//
// (1) is checked STRUCTURALLY against src/index.ts with the TypeScript
// compiler API rather than by importing it: importing index.ts calls `main()`
// at load, which connects a stdio transport and would never let the test
// process exit. AST over source is also immune to reformatting, unlike a
// regex over the file body.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";
import {
  KNOWN_ERROR_CODES,
  LOOKUP_TIMEOUT_MESSAGE,
  sanitizeToolError,
} from "../dist/tool-errors.js";
import { VouchApiError } from "../dist/vouch-client.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------- sanitizeToolError ----------------

test("a known API code passes through unchanged", () => {
  for (const code of KNOWN_ERROR_CODES) {
    assert.equal(sanitizeToolError(new Error(code)), code);
  }
});

test("an unknown error collapses to request_failed — nothing leaks", () => {
  const leaky = new Error(
    "connect ECONNREFUSED 10.0.0.5:5432 while calling https://x/?key=vouch_live_secret",
  );
  assert.equal(sanitizeToolError(leaky), "request_failed");
  assert.equal(sanitizeToolError("a bare string"), "request_failed");
  assert.equal(sanitizeToolError(undefined), "request_failed");
  assert.equal(sanitizeToolError({ message: "invalid_api_key" }), "request_failed");
});

test("a VouchApiError reason is appended to the code", () => {
  const error = new VouchApiError("attestation_unverifiable", "tx not found on chain");
  assert.equal(
    sanitizeToolError(error),
    "attestation_unverifiable: tx not found on chain",
  );
});

test("a timeout is named, not flattened into request_failed", () => {
  // The model's correct move differs: request_failed reads as "stop repeating
  // this", a timeout as "the upstream may answer on retry". Either way the
  // payee was NOT vetted, which the message says out loud.
  const timeout = new DOMException("The operation timed out.", "TimeoutError");
  assert.equal(sanitizeToolError(timeout), LOOKUP_TIMEOUT_MESSAGE);
  const aborted = new DOMException("Aborted.", "AbortError");
  assert.equal(sanitizeToolError(aborted), LOOKUP_TIMEOUT_MESSAGE);
  assert.match(LOOKUP_TIMEOUT_MESSAGE, /NOT checked/);
});

// ---------------- structural tool contract ----------------

/** Every `server.tool(name, description, schema, handler)` call in index.ts. */
function registeredTools() {
  const file = join(PKG, "src/index.ts");
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const tools = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.getText(sf) === "tool"
    ) {
      const [nameArg, descriptionArg, , handlerArg] = node.arguments;
      tools.push({
        name: nameArg && ts.isStringLiteralLike(nameArg) ? nameArg.text : null,
        // The description may be a string literal or a joined array of them;
        // the raw text is enough to assert on its content either way.
        description: descriptionArg ? descriptionArg.getText(sf) : "",
        handler: handlerArg,
        sf,
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return tools;
}

test("the AST actually found the tools (no vacuous pass)", () => {
  const names = registeredTools().map((t) => t.name);
  assert.deepEqual(names.sort(), [
    "attest_x402_payment",
    "check_agent_trust",
    "check_payee_trust",
    "check_wallet_trust",
    "explain_trust_score",
  ]);
});

test("every tool reports failures as isError with a sanitized message", () => {
  for (const tool of registeredTools()) {
    const { handler, sf, name } = tool;
    assert.ok(handler, `${name}: no handler argument`);

    let catchClause = null;
    const findCatch = (node) => {
      if (ts.isCatchClause(node) && catchClause === null) catchClause = node;
      ts.forEachChild(node, findCatch);
    };
    ts.forEachChild(handler, findCatch);
    assert.ok(
      catchClause,
      `${name}: the handler has no catch — a thrown lookup would surface as a ` +
        "protocol error instead of a tool result the model can act on",
    );

    const body = catchClause.block.getText(sf);
    assert.match(
      body,
      /isError:\s*true/,
      `${name}: the catch block does not set isError: true — the model would ` +
        "read the failure as an answer",
    );
    assert.match(
      body,
      /sanitizeToolError\(/,
      `${name}: the catch block does not sanitize the error before returning it`,
    );
  }
});

test("check_payee_trust tells the model that degraded outranks the recommendation", () => {
  const payee = registeredTools().find((t) => t.name === "check_payee_trust");
  assert.ok(payee, "check_payee_trust is not registered");
  const description = payee.description;
  // The raw JSON always carried these fields; nothing told the model they
  // outrank `recommendation`. That instruction is the whole point here.
  assert.match(description, /degraded/);
  assert.match(description, /signalsUnavailable/);
  assert.match(
    description,
    /DO NOT treat the payee as ALLOW/,
    "the description must say, in words, not to treat a degraded or partially " +
      "measured payee as ALLOW",
  );
});
