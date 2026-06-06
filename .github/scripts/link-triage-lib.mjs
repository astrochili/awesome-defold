import { readFile } from "node:fs/promises";

const API_VERSION = "2022-11-28";
const MODELS_ENDPOINT = "https://models.github.ai/inference/chat/completions";
const DESCRIPTION_TARGET = "35-60 characters";
const DESCRIPTION_MAX_LENGTH = 80;
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

export function removeCanonicalUrlsFromText(text, canonicalUrls) {
  const targets = new Set([...canonicalUrls].map((url) => canonicalizeUrl(url)).filter(Boolean));
  if (targets.size === 0) return { text: String(text || ""), removed: [] };

  const removed = [];
  const lines = String(text || "").split(/\r?\n/);
  const nextLines = [];

  for (const line of lines) {
    const urls = extractUrls(line).filter((candidate) => targets.has(candidate.canonical));
    if (urls.length === 0) {
      nextLines.push(line);
      continue;
    }

    let nextLine = line;
    for (const url of urls) {
      nextLine = nextLine.replace(url.original, "").replace(url.canonical, "");
      removed.push(url.canonical);
    }

    const residue = nextLine.trim();
    if (residue === "" || /^[-*+>\s.[\]()xX:;,_]+$/.test(residue)) continue;
    nextLines.push(nextLine.replace(/[ \t]{2,}/g, " ").trimEnd());
  }

  return { text: nextLines.join("\n"), removed };
}

export function parseSections(readme) {
  const lines = readme.split(/\r?\n/);
  const sections = [];
  const stack = [];

  lines.forEach((line, index) => {
    const match = /^(#{2,4})\s+(.+?)\s*$/.exec(line);
    if (!match) return;
    const name = match[2].trim();
    if (["Contribution", "Legend", "Contents"].includes(name)) return;
    const level = match[1].length;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ name, level });
    sections.push({
      name,
      level,
      line: index,
      path: stack.map((section) => section.name).join(" / "),
    });
  });

  return sections;
}

export function sectionPaths(readme) {
  return parseSections(readme).map((section) => section.path);
}

export function chooseFallbackSection(url) {
  const parsed = new URL(canonicalizeUrl(url));
  const host = parsed.hostname;
  const path = parsed.pathname;

  const platformSection = inferPlatformSection(url);
  if (platformSection) return platformSection;
  if (host === "github.com") return "Open Source";
  if (host.includes("youtube.com") || host === "youtu.be") return "Videos";
  if (host.includes("itch.io") || host.includes("gamejolt")) return "Web";
  if (host.includes("forum.defold.com") || path.includes("/blog/") || path.includes("/posts/")) return "Articles";
  return "Utilities";
}

export function inferPlatformSection(url) {
  const parsed = new URL(canonicalizeUrl(url));
  const host = parsed.hostname;

  if (host === "play.google.com" || host === "apps.apple.com") return "Mobile";
  if (host === "store.steampowered.com") return "Desktop";
  if (["poki.com", "crazygames.com", "newgrounds.com", "kongregate.com"].some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return "Web";
  }
  return null;
}

export function findSection(readme, preferred) {
  const sections = parseSections(readme);
  const normalized = String(preferred || "").toLowerCase();
  const exactPath = sections.find((section) => section.path.toLowerCase() === normalized);
  if (exactPath) return exactPath;
  const exactNames = sections.filter((section) => section.name.toLowerCase() === normalized);
  if (exactNames.length === 1) return exactNames[0];
  if (exactNames.length > 1) {
    const nonToolMatch = exactNames.find((section) => !section.path.startsWith("Tools / Code Editor /"));
    if (nonToolMatch) return nonToolMatch;
    return exactNames[0];
  }
  const fallback = sections.find((section) => section.name === "Utilities");
  if (fallback) return fallback;
  return sections.find((section) => section.name === "Articles") || null;
}

export function resolveSectionChoice(readme, choice) {
  return findSection(readme, choice)?.path || null;
}

export function insertReadmeItem(readme, item) {
  const section = findSection(readme, item.section);
  if (!section) throw new Error(`Could not find README section for ${item.section}`);

  const lines = readme.split(/\r?\n/);
  const end = sectionEndLine(lines, section);
  const linkLine = formatReadmeItem(readme, section, item);
  const bulletIndexes = [];
  for (let index = section.line + 1; index < end; index += 1) {
    if (/^-\s+\[/.test(lines[index])) bulletIndexes.push(index);
  }

  if (bulletIndexes.length === 0) {
    const insertAt = section.line + 1;
    lines.splice(insertAt, 0, "", linkLine);
    return { readme: lines.join("\n"), section: section.name, sectionPath: section.path, line: insertAt + 1 };
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
  return { readme: lines.join("\n"), section: section.name, sectionPath: section.path, line: insertAt + 1 };
}

export function formatReadmeItem(readme, section, item) {
  const title = sanitizeInline(item.title);
  const description = sanitizeDescription(item.description);
  const base = `- [${title}](${item.url})`;
  if (!sectionPrefersDescriptions(readme, section.name)) return base;
  return `${base} — ${description}`;
}

export function sectionPrefersDescriptions(readme, sectionName) {
  const section = findSection(readme, sectionName);
  if (!section) return true;

  const lines = readme.split(/\r?\n/);
  const end = sectionEndLine(lines, section);
  const bullets = lines.slice(section.line + 1, end).filter((line) => /^-\s+\[/.test(line));
  if (bullets.length === 0) return true;

  const withDescriptions = bullets.filter((line) => /\s—\s/.test(line)).length;
  return withDescriptions / bullets.length >= 0.5;
}

function sectionEndLine(lines, section) {
  for (let index = section.line + 1; index < lines.length; index += 1) {
    const match = /^(#{2,4})\s+/.exec(lines[index]);
    if (match && match[1].length <= section.level) return index;
  }
  return lines.length;
}

export function parseModelList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((model) => model.trim())
    .filter(Boolean);
}

export function parseDispatchLimit(value, defaultLimit = 1) {
  if (value === undefined || value === null || String(value).trim() === "") return defaultLimit;
  const limit = Number(String(value).trim());
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error("MAX_LINKS must be 0 for all links or a positive integer.");
  }
  return limit === 0 ? Number.POSITIVE_INFINITY : limit;
}

export function parseInputUrls(urlsValue, urlValue) {
  const values = [];
  if (urlsValue && String(urlsValue).trim()) {
    const raw = String(urlsValue).trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) values.push(...parsed);
      else throw new Error("TRIAGE_URLS JSON must be an array.");
    } catch (error) {
      if (raw.includes("\n")) values.push(...raw.split(/\r?\n/));
      else if (raw.includes(",")) values.push(...raw.split(","));
      else throw error;
    }
  }
  if (urlValue && String(urlValue).trim()) values.push(urlValue);

  const seen = new Set();
  const result = [];
  for (const value of values) {
    const canonical = canonicalizeUrl(value);
    if (!canonical) throw new Error(`Invalid triage URL: ${value}`);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(canonical);
  }
  return result;
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
  return pulls.some(
    (pull) =>
      pullRequestCountsAsProcessed(pull) &&
      extractUrls(`${pull.title || ""}\n${pull.body || ""}`).some((candidate) => candidate.canonical === canonical),
  );
}

export function pullRequestCountsAsProcessed(pull) {
  return pull?.state === "open" || Boolean(pull?.merged_at);
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

export async function dispatchWorker({ owner, repo, token, ref, workflowId, urls, models }) {
  await githubJson({
    path: `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    method: "POST",
    token,
    body: {
      ref,
      inputs: {
        ...(urls ? { urls: Array.isArray(urls) ? JSON.stringify(urls) : urls } : {}),
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
  const sections = sectionPaths(readme);
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
                "You curate README entries for Awesome Defold. Return compact JSON only with keys accepted, title, description, section_path, kind, confidence, reason. Match the repository's existing section taxonomy and terse formatting.",
            },
            {
              role: "user",
              content: [
                `URL: ${url}`,
                `Allowed README section paths: ${sections.join(", ")}`,
                "Pick exactly one existing section_path from the allowed list.",
                "Reject with accepted=false if the page is not clearly related to Defold, Defold development, Lua game development, or a game known to be made with Defold. Do not infer Defold relevance from generic game or dev terms.",
                "Classification rules:",
                "- Links / Open Source is only for official Defold ecosystem infrastructure, not random GitHub repositories.",
                "- Resources / Articles is for tutorials, guides, blog posts, forum writeups, and roadmap-style learning material.",
                "- Resources / Videos is for YouTube channels, playlists, and videos about Defold.",
                "- Tools is for editor integrations, development tools, build tools, language integrations, and workflow helpers.",
                "- Libraries is for reusable Defold libraries/extensions/modules. Choose the closest purpose category under Libraries.",
                "- Examples is for source/sample/demo projects meant to learn from or reuse.",
                "- Showcase is for published playable games, not source repositories.",
                "- For GitHub repositories: choose Libraries if reusable as a dependency, Examples if it is a sample/source game, Tools if it helps the development workflow.",
                "Platform rules for game/showcase links: Google Play and Apple App Store belong in Mobile; Steam belongs in Desktop; browser game portals such as Poki belong in Web.",
                "Showcase / Desktop, Showcase / Mobile, and Showcase / Web are for games made with Defold. Do not put mobile store links in Desktop.",
                "Title style: use a readable display name, like existing README entries. Do not return raw repository slugs such as defold-fake-real-glass, library-defold-foo, or my-tool-name. For GitHub repositories, first look for the repository display title, About title, or README heading; use the slug only as a last fallback. Strip generic Defold/library/extension prefixes and suffixes when they are only technical packaging. Prefer 'Spriteloop' over 'Spriteloop for Defold'. Preserve official capitalization. Add '(NSFW)' only when the page is explicitly adult/NSFW.",
                `Write a concise title and a short one-sentence description for validation. Existing README descriptions have a median length of about 45 characters; aim for ${DESCRIPTION_TARGET} and do not exceed ${DESCRIPTION_MAX_LENGTH} characters.`,
                "Description style: neutral, compact, factual. Avoid marketing copy and long feature lists. Prefer phrases like 'SDK wrapper.', 'Runtime atlas loader.', 'Pathfinding library.', or 'Shader tutorial with an example project.'.",
                "The workflow will omit descriptions in sections whose existing entries are mostly title-only.",
                "Examples:",
                "- GitHub reusable UI library -> Libraries / UI.",
                "- GitHub source game or sample project -> Examples.",
                "- Google Play game -> Showcase / Mobile.",
                "- Steam game -> Showcase / Desktop.",
                "- Forum tutorial -> Resources / Articles.",
                "- YouTube tutorial playlist -> Resources / Videos.",
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
      if (parsed.accepted === false) throw new Error(`Model rejected URL: ${parsed.reason || "not accepted"}`);
      const title = normalizeTitleForUrl(sanitizeInline(parsed.title || ""), url);
      const description = sanitizeDescription(parsed.description || "");
      const selected = resolveSectionChoice(readme, parsed.section_path || parsed.section);
      const platformSection = inferPlatformSection(url);
      const platformPath = platformSection ? resolveSectionChoice(readme, `Showcase / ${platformSection}`) || resolveSectionChoice(readme, platformSection) : null;
      const section = platformPath || selected || resolveSectionChoice(readme, chooseFallbackSection(url));
      if (!title || !description) throw new Error("Model JSON lacked title or description");
      if (!section) throw new Error("Model JSON lacked a valid section_path");

      attempts.push({ model, ok: true });
      return {
        item: {
          url,
          title,
          description,
          section,
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

export function normalizeTitleForUrl(title, url) {
  const raw = sanitizeInline(title);
  const sanitized = normalizeDefoldPackagingTitle(raw);
  const canonical = canonicalizeUrl(url);
  if (!sanitized || !canonical) return sanitized;
  if (sanitized !== raw || /\s/.test(sanitized)) return sanitized;

  const parsed = new URL(canonical);
  if (parsed.hostname !== "github.com") return sanitized;

  const parts = parsed.pathname.split("/").filter(Boolean);
  const repo = parts[1];
  if (!repo) return sanitized;

  const titleSlug = sanitized.toLowerCase().replace(/[\s_]+/g, "-");
  const repoSlug = repo.toLowerCase().replace(/_/g, "-");
  if (titleSlug !== repoSlug) return sanitized;

  let display = normalizeDefoldPackagingTitle(repo)
    .replace(/_/g, "-")
    .replace(/^(library-defold|defold-library|defold|extension|sample|game)-/i, "")
    .replace(/-defold$/i, "");

  display = display
    .split("-")
    .filter(Boolean)
    .map((part) => {
      if (/^(ai|api|aws|ecs|gui|html5|http|iap|ide|json|lua|lsp|md5|oop|sdk|ui|url|vscode)$/i.test(part)) return part.toUpperCase();
      if (/^nvim$/i.test(part)) return "nvim";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");

  return sanitizeInline(display || sanitized);
}

function normalizeDefoldPackagingTitle(title) {
  return title
    .replace(/\s+(?:for|in|with)\s+Defold$/i, "")
    .replace(/\s*[-:]\s*Defold\s+(?:library|extension|plugin|module|asset)$/i, "")
    .replace(/\s+Defold\s+(?:library|extension|plugin|module|asset)$/i, "")
    .trim();
}

export function sanitizeDescription(value) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[\r\n]/g, " ")
    .trim()
    .replace(/[.。]*$/u, "");
  if (!cleaned) return "";
  return `${truncateAtWord(cleaned, DESCRIPTION_MAX_LENGTH)}.`;
}

function truncateAtWord(value, maxLength) {
  if (value.length <= maxLength) return value;
  const truncated = value.slice(0, maxLength + 1);
  const lastSpace = truncated.lastIndexOf(" ");
  const shortened = lastSpace >= Math.floor(maxLength * 0.6) ? truncated.slice(0, lastSpace).trim() : value.slice(0, maxLength).trim();
  return shortened
    .replace(/\s+(and|or|with|for|to|of|in|by|from)$/i, "")
    .replace(/[,:;]+$/u, "")
    .trim();
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
