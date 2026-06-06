import { readFile, writeFile } from "node:fs/promises";

const API_VERSION = "2022-11-28";
const MODELS_ENDPOINT = "https://models.github.ai/inference/chat/completions";
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "spm",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
]);

export function canonicalizeUrl(value) {
  if (!value) return null;
  let raw = String(value).trim();
  raw = raw.replace(/^[<("'`]+/, "");
  raw = raw.replace(/[>),."'`]+$/g, "");

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  parsed.hash = "";

  if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
    parsed.port = "";
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }

  const sortedParams = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  parsed.search = "";
  for (const [key, val] of sortedParams) parsed.searchParams.append(key, val);

  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/g, "");

  return parsed.toString();
}

export function extractUrls(text) {
  const result = [];
  const seen = new Set();
  const regex = /https?:\/\/[^\s<>"'`]+/gi;

  for (const match of String(text || "").matchAll(regex)) {
    const canonical = canonicalizeUrl(match[0]);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    result.push({ original: match[0], canonical });
  }

  return result;
}

export async function readReadme(path = "README.md") {
  return readFile(path, "utf8");
}

export function readmeContainsUrl(readme, url) {
  const canonical = canonicalizeUrl(url);
  if (!canonical) return false;
  return extractUrls(readme).some((candidate) => candidate.canonical === canonical);
}

export function parseSections(readme) {
  const lines = readme.split(/\r?\n/);
  const sections = [];

  lines.forEach((line, index) => {
    const match = /^(#{2,4})\s+(.+?)\s*$/.exec(line);
    if (!match) return;
    const name = match[2].trim();
    if (["Contribution", "Legend", "Contents"].includes(name)) return;
    sections.push({
      name,
      level: match[1].length,
      line: index,
    });
  });

  return sections;
}

export function sectionNames(readme) {
  return parseSections(readme).map((section) => section.name);
}

export function chooseFallbackSection(url) {
  const parsed = new URL(canonicalizeUrl(url));
  const host = parsed.hostname;
  const path = parsed.pathname;

  if (host === "github.com") return "Open Source";
  if (host.includes("youtube.com") || host === "youtu.be") return "Videos";
  if (host.includes("itch.io") || host.includes("steam") || host.includes("gamejolt")) return "Web";
  if (host.includes("forum.defold.com") || path.includes("/blog/") || path.includes("/posts/")) return "Articles";
  return "Utilities";
}

export function findSection(readme, preferred) {
  const sections = parseSections(readme);
  const exact = sections.find((section) => section.name.toLowerCase() === String(preferred || "").toLowerCase());
  if (exact) return exact;
  const fallback = sections.find((section) => section.name === "Utilities");
  if (fallback) return fallback;
  return sections.find((section) => section.name === "Articles") || null;
}

export function insertReadmeItem(readme, item) {
  const section = findSection(readme, item.section);
  if (!section) throw new Error(`Could not find README section for ${item.section}`);

  const lines = readme.split(/\r?\n/);
  let end = lines.length;
  for (let index = section.line + 1; index < lines.length; index += 1) {
    const match = /^(#{2,4})\s+/.exec(lines[index]);
    if (match && match[1].length <= section.level) {
      end = index;
      break;
    }
  }

  const linkLine = `- [${sanitizeInline(item.title)}](${item.url}) — ${sanitizeDescription(item.description)}`;
  const bulletIndexes = [];
  for (let index = section.line + 1; index < end; index += 1) {
    if (/^-\s+\[/.test(lines[index])) bulletIndexes.push(index);
  }

  if (bulletIndexes.length === 0) {
    const insertAt = section.line + 1;
    lines.splice(insertAt, 0, "", linkLine);
    return { readme: lines.join("\n"), section: section.name, line: insertAt + 1 };
  }

  const titleKey = item.title.toLocaleLowerCase("en-US");
  let insertAt = bulletIndexes[bulletIndexes.length - 1] + 1;
  for (const index of bulletIndexes) {
    const match = /^-\s+\[([^\]]+)\]/.exec(lines[index]);
    if (match && match[1].toLocaleLowerCase("en-US").localeCompare(titleKey) > 0) {
      insertAt = index;
      break;
    }
  }

  lines.splice(insertAt, 0, linkLine);
  return { readme: lines.join("\n"), section: section.name, line: insertAt + 1 };
}

export async function writeReadmeWithItem(path, item) {
  const readme = await readReadme(path);
  const inserted = insertReadmeItem(readme, item);
  await writeFile(path, inserted.readme, "utf8");
  return inserted;
}

export function parseModelList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((model) => model.trim())
    .filter(Boolean);
}

export async function fetchAllPullRequests({ owner, repo, token }) {
  const pulls = [];
  for (let page = 1; page < 100; page += 1) {
    const batch = await githubJson({
      path: `/repos/${owner}/${repo}/pulls?state=all&per_page=100&page=${page}`,
      token,
    });
    pulls.push(...batch);
    if (batch.length < 100) break;
  }
  return pulls;
}

export function pullRequestsContainUrl(pulls, url) {
  const canonical = canonicalizeUrl(url);
  if (!canonical) return false;
  return pulls.some((pull) => extractUrls(`${pull.title || ""}\n${pull.body || ""}`).some((candidate) => candidate.canonical === canonical));
}

export async function githubJson({ path, method = "GET", token, body }) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${method} ${path} failed with ${response.status}: ${text.slice(0, 500)}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function dispatchWorker({ owner, repo, token, ref, workflowId, url, models }) {
  await githubJson({
    path: `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    method: "POST",
    token,
    body: {
      ref,
      inputs: {
        url,
        ...(models ? { models } : {}),
      },
    },
  });
}

export async function fetchPageSnippet(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "awesome-defold-link-triage/1.0",
        Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5",
      },
    });
    const text = await response.text();
    return text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);
  } catch (error) {
    return `Unable to fetch page metadata: ${error.message}`;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateItemWithModels({ url, readme, models, token }) {
  const sections = sectionNames(readme);
  const snippet = await fetchPageSnippet(url);
  const attempts = [];

  for (const model of models) {
    try {
      const response = await fetch(MODELS_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You curate README entries for Awesome Defold. Return compact JSON only with keys title, description, section, reason. The item must be relevant to Defold game development.",
            },
            {
              role: "user",
              content: [
                `URL: ${url}`,
                `Allowed README sections: ${sections.join(", ")}`,
                "Write a concise title and a one-sentence description. Pick exactly one existing section name.",
                `Page text snippet: ${snippet}`,
              ].join("\n\n"),
            },
          ],
        }),
      });

      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);

      const payload = JSON.parse(text);
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("Model response did not contain choices[0].message.content");

      const parsed = JSON.parse(content);
      const title = sanitizeInline(parsed.title || "");
      const description = sanitizeDescription(parsed.description || "");
      const selected = sections.find((section) => section.toLowerCase() === String(parsed.section || "").toLowerCase());
      if (!title || !description) throw new Error("Model JSON lacked title or description");

      attempts.push({ model, ok: true });
      return {
        item: {
          url,
          title,
          description,
          section: selected || chooseFallbackSection(url),
          reason: sanitizeDescription(parsed.reason || "Selected by GitHub Models triage."),
        },
        model,
        attempts,
      };
    } catch (error) {
      attempts.push({ model, ok: false, error: error.message });
    }
  }

  throw new Error(`All model attempts failed: ${JSON.stringify(attempts)}`);
}

export function sanitizeInline(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[\[\]\r\n]/g, "")
    .trim()
    .slice(0, 90);
}

export function sanitizeDescription(value) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[\r\n]/g, " ")
    .trim()
    .replace(/[.。]*$/u, "");
  if (!cleaned) return "";
  return `${cleaned.slice(0, 180)}.`;
}

export function repoContext() {
  const repoFull = process.env.GITHUB_REPOSITORY || "";
  const [owner, repo] = repoFull.split("/");
  if (!owner || !repo) throw new Error("GITHUB_REPOSITORY must be set to owner/repo");
  return { owner, repo };
}

export function appendStepSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return Promise.resolve();
  return import("node:fs/promises").then(({ appendFile }) => appendFile(path, `${markdown}\n`, "utf8"));
}
