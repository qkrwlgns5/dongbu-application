import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("centers school names beneath the school-name header, including wide cells", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = (selector) => css.slice(css.indexOf(selector) + selector.length).match(/^\s*\{([^}]+)\}/)?.[1];
  assert.match(rule(".results-panel th:nth-child(2)"), /text-align:\s*center/);
  assert.match(rule(".results-panel td:nth-child(2)"), /text-align:\s*center/);
  // The name is a max-width block, so its box also needs centering in wide columns.
  assert.match(rule(".results-panel td:nth-child(2) b"), /margin-inline:\s*auto/);
  assert.match(rule(".results-panel td:nth-child(2) b"), /text-overflow:\s*ellipsis/);
});
