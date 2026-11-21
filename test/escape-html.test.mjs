import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// src/ holds browser ES modules, but package.json says "type": "commonjs", so Node
// would load src/utils/escapeHtml.js as CommonJS. Import its source as an ES module instead.
const source = await readFile(new URL("../src/utils/escapeHtml.js", import.meta.url), "utf8");
const { escapeHtml } = await import(`data:text/javascript,${encodeURIComponent(source)}`);

test("escapes the five HTML-special characters", () => {
  assert.equal(escapeHtml(`<b>"Daisy" & 'Co'</b>`), "&lt;b&gt;&quot;Daisy&quot; &amp; &#39;Co&#39;&lt;/b&gt;");
});

test("neutralises markup and attribute break-outs", () => {
  assert.equal(escapeHtml("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(escapeHtml(`" onclick="x`), "&quot; onclick=&quot;x");
  assert.equal(escapeHtml("</td><td>"), "&lt;/td&gt;&lt;td&gt;");
});

test("escapes & first so existing entities are shown literally", () => {
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
});

test("leaves plain text unchanged", () => {
  assert.equal(escapeHtml("Angus 2024-03-01 — ok"), "Angus 2024-03-01 — ok");
});

test("turns null and undefined into an empty string", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("stringifies numbers and other values", () => {
  assert.equal(escapeHtml(0), "0");
  assert.equal(escapeHtml(1250.5), "1250.5");
  assert.equal(escapeHtml(false), "false");
});
