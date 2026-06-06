#!/usr/bin/env node
import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";
import {
  appendStepSummary,
  canonicalizeUrl,
  fetchAllPullRequests,
  generateItemWithModels,
  parseModelList,
  pullRequestsContainUrl,
  readReadme,
  readmeContainsUrl,
  repoContext,
  writeReadmeWithItem,
} from "./link-triage-lib.mjs";

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is required");

const enabled = process.env.ENABLE_GITHUB_MODELS_TRIAGE === "1";
if (!enabled) {
  throw new Error("Set repository variable ENABLE_GITHUB_MODELS_TRIAGE=1 to enable GitHub Models link triage.");
}

const inputUrl = process.env.TRIAGE_URL;
const url = canonicalizeUrl(inputUrl);
if (!url) throw new Error(`Invalid TRIAGE_URL: ${inputUrl}`);

const models = parseModelList(process.env.INPUT_MODELS || process.env.TRIAGE_MODELS);
if (models.length === 0) {
  throw new Error("No models configured. Set repository variable TRIAGE_MODELS or pass the models workflow input.");
}

const { owner, repo } = repoContext();
const readme = await readReadme();

if (readmeContainsUrl(readme, url)) {
  await appendStepSummary(`## Link triage worker\n\nSkipped ${url}: README already contains this URL.`);
  console.log("README already contains URL; exiting without changes.");
  process.exit(0);
}

const pulls = await fetchAllPullRequests({ owner, repo, token });
if (pullRequestsContainUrl(pulls, url)) {
  await appendStepSummary(`## Link triage worker\n\nSkipped ${url}: PR history already contains this URL.`);
  console.log("PR history already contains URL; exiting without changes.");
  process.exit(0);
}

const generated = await generateItemWithModels({ url, readme, models, token });
const inserted = await writeReadmeWithItem("README.md", generated.item);

const branchSlug = generated.item.title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 48);
const urlHash = createHash("sha256").update(url).digest("hex").slice(0, 8);
const prTitle = `Add ${generated.item.title}`;
const prBody = [
  "Automated daily link triage draft.",
  "",
  `Source URL: ${url}`,
  `Chosen section: ${inserted.sectionPath || inserted.section}`,
  `Inserted line: ${inserted.line}`,
  `Model used: ${generated.model}`,
  "",
  "Model attempts:",
  ...generated.attempts.map((attempt) => `- ${attempt.model}: ${attempt.ok ? "ok" : `failed (${attempt.error})`}`),
  "",
  `Reason: ${generated.item.reason}`,
].join("\n");

await writeGithubOutput({
  branch: `triage/${branchSlug || "link"}-${urlHash}`,
  title: prTitle,
  body: prBody,
  section: inserted.sectionPath || inserted.section,
  model: generated.model,
});

await appendStepSummary(
  [
    "## Link triage worker",
    "",
    `Source URL: ${url}`,
    `Title: ${generated.item.title}`,
    `Section: ${inserted.sectionPath || inserted.section}`,
    `Model used: ${generated.model}`,
    `Line: ${inserted.line}`,
  ].join("\n"),
);

console.log(JSON.stringify({ url, item: generated.item, inserted, model: generated.model }, null, 2));

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
