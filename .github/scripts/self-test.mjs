#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  canonicalizeUrl,
  extractUrls,
  formatReadmeItem,
  inferPlatformSection,
  insertReadmeItem,
  parseDispatchLimit,
  parseModelList,
  parseSections,
  pullRequestsContainUrl,
  readmeContainsUrl,
  resolveSectionChoice,
  sanitizeDescription,
  sectionPrefersDescriptions,
  sectionPaths,
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
assert.equal(parseDispatchLimit(undefined), 1);
assert.equal(parseDispatchLimit("1"), 1);
assert.equal(parseDispatchLimit("3"), 3);
assert.equal(parseDispatchLimit("0"), Number.POSITIVE_INFINITY);
assert.throws(() => parseDispatchLimit("-1"), /MAX_LINKS/);
assert.throws(() => parseDispatchLimit("many"), /MAX_LINKS/);
assert.equal(
  pullRequestsContainUrl([{ state: "closed", merged_at: null, title: "Add example", body: "Source URL: https://example.com/new" }], "https://example.com/new"),
  false,
);
assert.equal(
  pullRequestsContainUrl([{ state: "open", merged_at: null, title: "Add example", body: "Source URL: https://example.com/new" }], "https://example.com/new"),
  true,
);
assert.equal(
  pullRequestsContainUrl([{ state: "closed", merged_at: "2026-06-01T00:00:00Z", title: "Add example", body: "Source URL: https://example.com/new" }], "https://example.com/new"),
  true,
);
assert.equal(sanitizeDescription(""), "");
assert.equal(sanitizeDescription("..."), "");
assert.equal(sanitizeDescription(" Useful item. "), "Useful item.");
assert.equal(
  sanitizeDescription("A compact development helper with structured project setup, export tools, and workflow automation for teams."),
  "A compact development helper with structured project setup, export tools.",
);
assert.equal(inferPlatformSection("https://play.google.com/store/apps/details?id=com.example.mobilegame"), "Mobile");
assert.equal(inferPlatformSection("https://apps.apple.com/app/example/id123"), "Mobile");
assert.equal(inferPlatformSection("https://store.steampowered.com/app/123/example"), "Desktop");

const nestedReadme = [
  "# List",
  "",
  "## Tools",
  "",
  "### Code Editor",
  "",
  "#### AI",
  "",
  "- [Editor AI](https://example.com/editor-ai) — Editor helper.",
  "",
  "## Libraries",
  "",
  "#### AI",
  "",
  "- [Runtime AI](https://example.com/runtime-ai) — Runtime helper.",
  "",
].join("\n");
assert.deepEqual(sectionPaths(nestedReadme), ["Tools", "Tools / Code Editor", "Tools / Code Editor / AI", "Libraries", "Libraries / AI"]);
assert.equal(resolveSectionChoice(nestedReadme, "Tools / Code Editor / AI"), "Tools / Code Editor / AI");
assert.equal(resolveSectionChoice(nestedReadme, "Libraries / AI"), "Libraries / AI");
assert.equal(resolveSectionChoice(nestedReadme, "AI"), "Libraries / AI");
assert.equal(parseSections(nestedReadme).find((section) => section.path === "Tools / Code Editor / AI").name, "AI");

const readme = ["# List", "", "#### Articles", "", "- [Beta](https://example.com/b) — Existing.", "", "#### Utilities", ""].join("\n");
const inserted = insertReadmeItem(readme, {
  title: "Alpha",
  url: "https://example.com/a",
  description: "New item.",
  section: "Articles",
});
assert.match(inserted.readme, /- \[Alpha\]\(https:\/\/example.com\/a\) — New item\.\n- \[Beta\]/);
assert.equal(inserted.sectionPath, "Articles");

const showcaseReadme = [
  "# List",
  "",
  "## Showcase",
  "",
  "#### Desktop",
  "",
  "- [Steam Game](https://store.steampowered.com/app/1)",
  "",
  "#### Mobile",
  "",
  "- [Mobile Game](https://play.google.com/store/apps/details?id=old)",
  "",
].join("\n");
assert.equal(sectionPrefersDescriptions(showcaseReadme, "Mobile"), false);
assert.equal(
  formatReadmeItem(showcaseReadme, { name: "Mobile" }, {
    title: "Example Mobile Game",
    url: "https://play.google.com/store/apps/details?id=com.example.mobilegame",
    description: "A compact mobile game.",
  }),
  "- [Example Mobile Game](https://play.google.com/store/apps/details?id=com.example.mobilegame)",
);
const mobileInserted = insertReadmeItem(showcaseReadme, {
  title: "Example Mobile Game",
  url: "https://play.google.com/store/apps/details?id=com.example.mobilegame",
  description: "A compact mobile game.",
  section: "Showcase / Mobile",
});
assert.match(
  mobileInserted.readme,
  /#### Mobile\n\n- \[Example Mobile Game\]\(https:\/\/play.google.com\/store\/apps\/details\?id=com.example.mobilegame\)\n- \[Mobile Game\]/,
);

console.log("self-test ok");
