#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  canonicalizeUrl,
  extractUrls,
  insertReadmeItem,
  parseModelList,
  readmeContainsUrl,
  sanitizeDescription,
} from "./link-triage-lib.mjs";

assert.equal(
  canonicalizeUrl("https://www.Example.com/path/?utm_source=x&b=2&a=1#top)."),
  "https://example.com/path?a=1&b=2",
);
assert.deepEqual(extractUrls("A https://example.com/x. B https://example.com/x?utm_source=feed"), [
  { original: "https://example.com/x.", canonical: "https://example.com/x" },
]);
assert.equal(readmeContainsUrl("- [X](https://example.com/a?utm_medium=x)", "https://www.example.com/a"), true);
assert.deepEqual(parseModelList("openai/gpt-4.1, xai/grok-3\nmeta/llama"), [
  "openai/gpt-4.1",
  "xai/grok-3",
  "meta/llama",
]);
assert.equal(sanitizeDescription(""), "");
assert.equal(sanitizeDescription("..."), "");
assert.equal(sanitizeDescription(" Useful item. "), "Useful item.");

const readme = ["# List", "", "#### Articles", "", "- [Beta](https://example.com/b) — Existing.", "", "#### Utilities", ""].join("\n");
const inserted = insertReadmeItem(readme, {
  title: "Alpha",
  url: "https://example.com/a",
  description: "New item.",
  section: "Articles",
});
assert.match(inserted.readme, /- \[Alpha\]\(https:\/\/example.com\/a\) — New item\.\n- \[Beta\]/);

console.log("self-test ok");
