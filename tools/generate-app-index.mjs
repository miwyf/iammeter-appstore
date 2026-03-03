import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";

const ROOT = process.cwd();
const appsDir = path.join(ROOT, "apps");

// Defaults (can be overridden by env)
const DEFAULT_PAGES_BASE_URL = "https://iammeter.github.io/appstore/";
const DEFAULT_BRANCH = process.env.GITHUB_REF_NAME || "main";
const DEFAULT_REPO_URL =
  process.env.REPO_URL ||
  (process.env.GITHUB_REPOSITORY
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
    : "https://github.com/IAMMETER/appstore");

const SCREENSHOT_EXTS = ["png", "jpg", "jpeg", "JPG"];

function ensureTrailingSlash(u) {
  return u.endsWith("/") ? u : u + "/";
}

function removeTrailingSlash(u) {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

function buildUrl(base, relPath) {
  const b = ensureTrailingSlash(base);
  const p = relPath.startsWith("/") ? relPath.slice(1) : relPath;
  return new URL(p, b).toString();
}

function isValidHttpUrl(u) {
  if (!u || typeof u !== "string") return false;
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    const url = new URL(u);
    return Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isRepoRelativePath(s) {
  if (!s || typeof s !== "string") return false;
  if (isValidHttpUrl(s)) return false;
  if (s.startsWith("/")) return false;
  if (s.includes("\\")) return false;
  if (/\s/.test(s)) return false;
  return true;
}

function buildGitHubDirUrl(repoRoot, branch, appId) {
  return `${repoRoot}/tree/${branch}/apps/${appId}`;
}

function buildGitHubBlobUrl(repoRoot, branch, filePath) {
  return `${repoRoot}/blob/${branch}/${filePath}`;
}

function buildRawUrl(repoRoot, branch, filePath) {
  const parts = repoRoot.replace("https://github.com/", "").split("/");
  const owner = parts[0];
  const repo = parts[1];
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

function findScreenshotInRepo(appId) {
  const appRoot = path.join(ROOT, "apps", appId);
  for (const ext of SCREENSHOT_EXTS) {
    const file = `screenshot.${ext}`;
    const full = path.join(appRoot, file);
    if (fs.existsSync(full)) return `apps/${appId}/${file}`;
  }
  return null;
}

function resolveMaybeUrlOrPath(value, pagesBase) {
  // returns { url: string|null, kind: 'url'|'path'|'none' }
  if (!value) return { url: null, kind: "none" };

  if (isValidHttpUrl(value)) return { url: value, kind: "url" };

  if (isRepoRelativePath(value)) {
    // treat as Pages-relative path
    return { url: buildUrl(pagesBase, value), kind: "path" };
  }

  // invalid (e.g. "https://", empty, spaces)
  return { url: null, kind: "none" };
}

async function main() {
  const manifestFiles = await fg(["apps/*/manifest.json"]);
  const apps = [];

  const pagesBase = ensureTrailingSlash(
    process.env.PAGES_BASE_URL || DEFAULT_PAGES_BASE_URL
  );

  const repoRoot = removeTrailingSlash(DEFAULT_REPO_URL);
  const branch = DEFAULT_BRANCH;

  for (const file of manifestFiles) {
    const fullPath = path.join(ROOT, file);
    const manifest = JSON.parse(fs.readFileSync(fullPath, "utf8"));

    const links = manifest.links || {};

    // entry in index.json is repo-relative (apps/<id>/<entry>)
    const entryPath = manifest.entry
      ? `apps/${manifest.id}/${manifest.entry}`
      : null;

    // Resolve links
    const homepageUrl = isValidHttpUrl(links.homepage) ? links.homepage : null;
    const docsUrl = isValidHttpUrl(links.docs) ? links.docs : null;

    // open-source may have source; proprietary typically not
    const sourceUrl = isValidHttpUrl(links.source) ? links.source : null;

    // preview can be URL or repo-relative path (to Pages)
    const previewResolved = resolveMaybeUrlOrPath(links.preview, pagesBase);

    // screenshot can be URL or repo-relative path
    let screenshotResolved = resolveMaybeUrlOrPath(links.screenshot, pagesBase);

    // if screenshot not set in manifest, try auto-detect apps/<id>/screenshot.(png|jpg|jpeg|JPG)
    if (!screenshotResolved.url) {
      const found = findScreenshotInRepo(manifest.id);
      if (found) screenshotResolved = { url: buildUrl(pagesBase, found), kind: "path" };
    }

    // pagesUrl only makes sense if entry exists (static apps normally)
    const pagesUrl = entryPath ? buildUrl(pagesBase, entryPath) : null;

    // Determine openUrl:
    // 1) manifest links.preview (if provided)
    // 2) pagesUrl (if exists)
    // 3) homepageUrl
    const openUrl = previewResolved.url || pagesUrl || homepageUrl || null;

    // raw file url: only meaningful if repoRoot is github and entryPath exists
    const rawFileUrl =
      repoRoot && entryPath && repoRoot.startsWith("https://github.com/")
        ? buildRawUrl(repoRoot, branch, entryPath)
        : null;

    const app = {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      author: manifest.author || null,
      version: manifest.version,

      category: manifest.category || "other",
      type: manifest.type || null,
      runtime: manifest.runtime,

      tags: Array.isArray(manifest.tags) ? manifest.tags : [],

      entry: entryPath,

      openUrl,
      previewUrl: previewResolved.url || null,
      homepageUrl,
      sourceUrl: sourceUrl
        ? sourceUrl
        : (manifest.type === "open-source"
            ? buildGitHubDirUrl(repoRoot, branch, manifest.id)
            : null),

      docsUrl,
      screenshotUrl: screenshotResolved.url || null,

      repoUrl: repoRoot || null,
      sourcePath: `apps/${manifest.id}`,
      pagesUrl,
      rawFileUrl
    };

    apps.push(app);
  }

  apps.sort((a, b) => a.id.localeCompare(b.id));

  const outputPath = path.join(appsDir, "index.json");

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: apps.length,
        apps
      },
      null,
      2
    )
  );

  console.log(`✅ Generated apps/index.json (${apps.length} apps)`);
}

main().catch((err) => {
  console.error("❌ Failed to generate apps/index.json");
  console.error(err);
  process.exit(1);
});