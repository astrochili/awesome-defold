#!/usr/bin/env node
import {
  appendStepSummary,
  dispatchWorker,
  extractUrls,
  fetchAllPullRequests,
  githubJson,
  pullRequestsContainUrl,
  readReadme,
  readmeContainsUrl,
  repoContext,
} from "./link-triage-lib.mjs";

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is required");

const issueNumber = Number(process.env.ISSUE_NUMBER || "16");
const workflowId = process.env.WORKER_WORKFLOW_ID || "link-triage-worker.yml";
const ref = process.env.GITHUB_REF_NAME || process.env.GITHUB_REF?.replace(/^refs\/heads\//, "") || "main";
const models = process.env.TRIAGE_MODELS || "";
const dryRun = process.env.DRY_RUN === "1";
const { owner, repo } = repoContext();

const issue = await githubJson({
  path: `/repos/${owner}/${repo}/issues/${issueNumber}`,
  token,
});
const candidates = extractUrls(issue.body || "");
const readme = await readReadme();
const pulls = await fetchAllPullRequests({ owner, repo, token });

const queued = [];
const skipped = [];

for (const candidate of candidates) {
  if (readmeContainsUrl(readme, candidate.canonical)) {
    skipped.push({ url: candidate.canonical, reason: "README already contains URL" });
    continue;
  }
  if (pullRequestsContainUrl(pulls, candidate.canonical)) {
    skipped.push({ url: candidate.canonical, reason: "PR history already contains URL" });
    continue;
  }
  queued.push(candidate.canonical);
}

if (!dryRun) {
  for (const url of queued) {
    await dispatchWorker({ owner, repo, token, ref, workflowId, url, models });
  }
}

await appendStepSummary(
  [
    "## Daily link triage scan",
    "",
    `Issue: #${issueNumber}`,
    `Extracted URLs: ${candidates.length}`,
    `Queued worker runs: ${queued.length}`,
    `Skipped URLs: ${skipped.length}`,
    "",
    ...queued.map((url) => `- queued: ${url}`),
    ...skipped.map((item) => `- skipped: ${item.url} (${item.reason})`),
    dryRun ? "" : "",
    dryRun ? "_Dry run: no worker workflows were dispatched._" : "",
  ]
    .filter(Boolean)
    .join("\n"),
);

console.log(JSON.stringify({ issueNumber, extracted: candidates.length, queued, skipped }, null, 2));

