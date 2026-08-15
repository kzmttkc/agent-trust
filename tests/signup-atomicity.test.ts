import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("signup inserts the account and the first key in one statement", () => {
  const accounts = read("lib/db/accounts.ts");
  assert.match(
    accounts,
    /createAccountWithApiKey/,
    "the atomic helper must exist so neon-http can still do account+key in one round trip",
  );
  assert.match(accounts, /INSERT INTO api_keys/);

  const signup = read("lib/dashboard/signup-core.ts");
  assert.match(signup, /createAccountWithApiKey/);
  assert.doesNotMatch(
    signup,
    /createAccount\(/,
    "a bare createAccount before createApiKey leaves an email-locked account with no key",
  );
});
