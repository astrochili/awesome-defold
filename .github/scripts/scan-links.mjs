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
  removeCanonicalUrlsFromText,
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
const cleanReadmeDuplicates = process.env.CLEAN_README_DUPLICATES === "1";
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
const readmeDuplicateUrls = [];

for (const candidate of candidates) {
  if (readmeContainsUrl(readme, candidate.canonical)) {
    skipped.push({ url: candidate.canonical, reason: "README already contains URL" });
    readmeDuplicateUrls.push(candidate.canonical);
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
const cleanedIssue = cleanReadmeDuplicates ? removeCanonicalUrlsFromText(issue.body || "", readmeDuplicateUrls) : { text: issue.body || "", removed: [] };

if (!dryRun) {
  for (const url of selected) {
    await dispatchWorker({ owner, repo, token, ref, workflowId, url, models });
  }
  if (cleanReadmeDuplicates && cleanedIssue.removed.length > 0 && cleanedIssue.text !== (issue.body || "")) {
    await githubJson({
      path: `/repos/${owner}/${repo}/issues/${issueNumber}`,
      method: "PATCH",
      token,
      body: { body: cleanedIssue.text },
    });
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
    `README duplicate URLs ${dryRun ? "that would be removed from issue" : "removed from issue"}: ${cleanedIssue.removed.length}`,
    "",
    ...selected.map((url) => `- queued: ${url}`),
    ...deferred.map((url) => `- deferred: ${url}`),
    ...skipped.map((item) => `- skipped: ${item.url} (${item.reason})`),
    dryRun ? "" : "",
    dryRun ? "_Dry run: no worker workflows were dispatched and the issue body was not edited._" : "",
  ]
    .filter(Boolean)
    .join("\n"),
);

console.log(
  JSON.stringify(
    {
      issueNumber,
      extracted: candidates.length,
      maxLinks: Number.isFinite(maxLinks) ? maxLinks : 0,
      queued: selected,
      deferred,
      skipped,
      issueCleanup: {
        enabled: cleanReadmeDuplicates,
        removed: cleanedIssue.removed,
      },
    },
    null,
    2,
  ),
);
