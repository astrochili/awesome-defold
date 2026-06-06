#!/usr/bin/env node
import { createHash } from "node:crypto";
import { appendFile, writeFile } from "node:fs/promises";
import {
  appendStepSummary,
  fetchAllPullRequests,
  generateItemWithModels,
  insertReadmeItem,
  parseInputUrls,
  parseModelList,
  pullRequestsContainUrl,
  readReadme,
  readmeContainsUrl,
  repoContext,
} from "./link-triage-lib.mjs";

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is required");

const enabled = process.env.ENABLE_GITHUB_MODELS_TRIAGE === "1";
if (!enabled) {
  throw new Error("Set repository variable ENABLE_GITHUB_MODELS_TRIAGE=1 to enable GitHub Models link triage.");
}

const urls = parseInputUrls(process.env.TRIAGE_URLS, process.env.TRIAGE_URL);
if (urls.length === 0) throw new Error("At least one URL is required via TRIAGE_URL or TRIAGE_URLS.");

const models = parseModelList(process.env.INPUT_MODELS || process.env.TRIAGE_MODELS);
if (models.length === 0) {
  throw new Error("No models configured. Set repository variable TRIAGE_MODELS or pass the models workflow input.");
}

const { owner, repo } = repoContext();
let readme = await readReadme();
const pulls = await fetchAllPullRequests({ owner, repo, token });

const results = [];

for (const url of urls) {
  if (readmeContainsUrl(readme, url)) {
    results.push({ url, skipped: true, reason: "README already contains URL" });
    continue;
  }
  if (pullRequestsContainUrl(pulls, url)) {
    results.push({ url, skipped: true, reason: "PR history already contains URL" });
    continue;
  }

  const generated = await generateItemWithModels({ url, readme, models, token });
  const inserted = insertReadmeItem(readme, generated.item);
  readme = inserted.readme;
  results.push({ url, generated, inserted });
}

const insertedResults = results.filter((result) => result.generated);
if (insertedResults.length === 0) {
  await appendStepSummary(
    [
      "## Link triage worker",
      "",
      "No README changes were generated.",
      "",
      ...results.map((result) => `- skipped: ${result.url} (${result.reason})`),
    ].join("\n"),
  );
  console.log(JSON.stringify({ urls, results }, null, 2));
  process.exit(0);
}

await writeFile("README.md", readme, "utf8");

const primary = insertedResults[0];
const branchSlug = (insertedResults.length === 1 ? primary.generated.item.title : `links-${insertedResults.length}`)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 48);
const urlHash = createHash("sha256").update(urls.join("\n")).digest("hex").slice(0, 8);
const prTitle = insertedResults.length === 1 ? `Add ${primary.generated.item.title}` : `Add ${insertedResults.length} links`;
const prBody = [
  "Automated daily link triage draft.",
  "",
  "Generated entries:",
  ...insertedResults.flatMap((result, index) => [
    "",
    `### ${index + 1}. ${result.generated.item.title}`,
    "",
    `Source URL: ${result.url}`,
    `Chosen section: ${result.inserted.sectionPath || result.inserted.section}`,
    `Inserted line: ${result.inserted.line}`,
    `Model used: ${result.generated.model}`,
    "Model attempts:",
    ...result.generated.attempts.map((attempt) => `- ${attempt.model}: ${attempt.ok ? "ok" : `failed (${attempt.error})`}`),
    `Reason: ${result.generated.item.reason}`,
  ]),
  ...(results.some((result) => result.skipped)
    ? ["", "Skipped URLs:", ...results.filter((result) => result.skipped).map((result) => `- ${result.url} (${result.reason})`)]
    : []),
].join("\n");

await writeGithubOutput({
  branch: `triage/${branchSlug || "link"}-${urlHash}`,
  title: prTitle,
  body: prBody,
  section: insertedResults.map((result) => result.inserted.sectionPath || result.inserted.section).join(", "),
  model: [...new Set(insertedResults.map((result) => result.generated.model))].join(", "),
});

await appendStepSummary(
  [
    "## Link triage worker",
    "",
    `Input URLs: ${urls.length}`,
    `Inserted entries: ${insertedResults.length}`,
    `Skipped URLs: ${results.length - insertedResults.length}`,
    "",
    ...insertedResults.map((result) => `- ${result.generated.item.title}: ${result.inserted.sectionPath || result.inserted.section} (line ${result.inserted.line})`),
    ...results.filter((result) => result.skipped).map((result) => `- skipped: ${result.url} (${result.reason})`),
  ].join("\n"),
);

console.log(JSON.stringify({ urls, results }, null, 2));

async function writeGithubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = [];
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}<<EOF`);
    lines.push(String(value));
    lines.push("EOF");
  }
  await appendFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}
