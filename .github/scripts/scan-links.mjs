#!/usr/bin/env node
import {
  appendStepSummary,
  dispatchWorker,
  extractUrls,
  fetchAllPullRequests,
  githubJson,
  parseDispatchLimit,
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
const maxLinks = parseDispatchLimit(process.env.MAX_LINKS, 1);
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

const selected = queued.slice(0, maxLinks);
const deferred = queued.slice(selected.length);

if (!dryRun) {
  for (const url of selected) {
    await dispatchWorker({ owner, repo, token, ref, workflowId, url, models });
  }
}

await appendStepSummary(
  [
    "## Daily link triage scan",
    "",
    `Issue: #${issueNumber}`,
    `Extracted URLs: ${candidates.length}`,
    `New URLs after duplicate checks: ${queued.length}`,
    `Queued worker runs: ${selected.length}`,
    `Deferred by max_links: ${deferred.length}`,
    `Skipped URLs: ${skipped.length}`,
    "",
    ...selected.map((url) => `- queued: ${url}`),
    ...deferred.map((url) => `- deferred: ${url}`),
    ...skipped.map((item) => `- skipped: ${item.url} (${item.reason})`),
    dryRun ? "" : "",
    dryRun ? "_Dry run: no worker workflows were dispatched._" : "",
  ]
    .filter(Boolean)
    .join("\n"),
);

console.log(JSON.stringify({ issueNumber, extracted: candidates.length, maxLinks: Number.isFinite(maxLinks) ? maxLinks : 0, queued: selected, deferred, skipped }, null, 2));
