import { test } from "node:test";
import assert from "node:assert/strict";
import sitemap from "@/app/sitemap";

test("sitemap includes the observatory entry points", () => {
  const urls = sitemap().map((entry) => entry.url);
  assert.ok(urls.includes("https://vet402.com/observatory"), "missing /observatory");
  assert.ok(urls.includes("https://vet402.com/observatory/state"), "missing /observatory/state");
  assert.ok(
    urls.includes("https://vet402.com/observatory/methodology"),
    "missing /observatory/methodology",
  );
});

test("sitemap does not enumerate dynamic per-endpoint observatory pages", () => {
  const urls = sitemap().map((entry) => entry.url);
  assert.ok(
    !urls.some((u) => u.includes("/observatory/e/")),
    "dynamic /observatory/e/{id} pages must not be enumerated (unbounded, like /payee/{address})",
  );
});
