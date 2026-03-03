import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";

const ROOT = process.cwd();
const appsDir = path.join(ROOT, "apps");

// If you host the shell on GitHub Pages (recommended):
// e.g. https://iammeter.github.io/appstore/
const DEFAULT_PAGES_BASE_URL = "https://iammeter.github.io/appstore/";

// screenshot search order (local file)
console.log("Using PAGES_BASE_URL =", process.env.PAGES_BASE_URL || DEFAULT_PAGES_BASE_URL);const SCREENSHOT_EXTS = ["png", "jpg", "jpeg"];

function ensureTrailingSlash(u) {
  return u.endsWith("/") ? u : u + "/";
}
function removeTrailingSlash(u) {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}
function isHttp(u) {
  return /^https?:\/\//i.test(u || "");
}
function buildUrl(base, relPath) {
  const b = ensureTrailingSlash(base);
  const p = relPath.startsWith("/") ? relPath.slice(1) : relPath;
  return new URL(p, b).toString();
}
function isGitHubRepoRoot(u) {
  // expecting: https://github.com/<owner>/<repo>
  const m = (u || "").match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/i);
  return !!m;
}
function toGitHubTreeUrl(repoRoot, repoPath, branch = "main") {
  // repoPath: "apps/example-static"
  return `${removeTrailingSlash(repoRoot)}/tree/${branch}/${repoPath.replace(/^\/+/, "")}`;
}
function toGitHubBlobUrl(repoRoot, filePath, branch = "main") {
  // filePath: "apps/example-static/README.md"
  return `${removeTrailingSlash(repoRoot)}/blob/${branch}/${filePath.replace(/^\/+/, "")}`;
}
function toGitHubRawUrl(repoRoot, filePath, branch = "main") {
  // repoRoot: https://github.com/owner/repo
  const parts = removeTrailingSlash(repoRoot).replace("https://github.com/", "").split("/");
  const owner = parts[0];
  const repo = parts[1];
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath.replace(/^\/+/, "")}`;
}

function findLocalScreenshotRel(appId) {
  const appRoot = path.join(ROOT, "apps", appId);
  if (!fs.existsSync(appRoot)) return null;

  // allow screenshot.(png|jpg|jpeg) (case-insensitive)
  const files = fs.readdirSync(appRoot);
  for (const ext of SCREENSHOT_EXTS) {
    const re = new RegExp(`^screenshot\\.${ext}$`, "i");
    const hit = files.find((f) => re.test(f));
    if (hit) return `apps/${appId}/${hit}`;
  }
  return null;
}

async function main() {
  const manifestFiles = await fg(["apps/*/manifest.json"]);
  const pagesBase = ensureTrailingSlash(process.env.PAGES_BASE_URL || DEFAULT_PAGES_BASE_URL);

  const apps = [];

  for (const mf of manifestFiles) {
    const manifestPath = path.join(ROOT, mf);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    const links = manifest.links || {};

    // repoRoot should be a repo root URL (prefer links.source)
    const repoRoot = removeTrailingSlash(links.source || manifest.source || "");

    // Where the app lives inside repoRoot (optional). Default to apps/<id>
    const sourcePath = (links.sourcePath || `apps/${manifest.id}`).replace(/^\/+/, "");

    // Docs can be a URL or a repo-relative path
    const docs = links.docs || manifest.docs || "";

    // Preview/Homepage can be direct URLs
    const homepage = links.homepage || "";
    const preview = links.preview || "";

    // Entry path inside this repository (if it exists here)
    const entryRel = `apps/${manifest.id}/${manifest.entry}`;
    const entryAbs = path.join(ROOT, entryRel);

    // Build pagesUrl only if this repo actually contains the entry file
    const pagesUrl = fs.existsSync(entryAbs) ? buildUrl(pagesBase, entryRel) : null;

    // screenshot: prefer links.screenshot (URL or relative), else local file
    let screenshotUrl = null;
    if (links.screenshot) {
      if (isHttp(links.screenshot)) screenshotUrl = links.screenshot;
      else screenshotUrl = buildUrl(pagesBase, links.screenshot.replace(/^\/+/, ""));
    } else {
      const localShot = findLocalScreenshotRel(manifest.id);
      if (localShot) screenshotUrl = buildUrl(pagesBase, localShot);
    }

    // Source URL (directory)
    let sourceUrl = null;
    if (repoRoot) {
      if (isGitHubRepoRoot(repoRoot)) sourceUrl = toGitHubTreeUrl(repoRoot, sourcePath, links.branch || "main");
      else sourceUrl = repoRoot; // non-github: just show the link
    }

    // Docs URL
    let docsUrl = null;
    if (docs) {
      if (isHttp(docs)) docsUrl = docs;
      else if (repoRoot && isGitHubRepoRoot(repoRoot)) docsUrl = toGitHubBlobUrl(repoRoot, docs, links.branch || "main");
      // else leave null (no safe way to build)
    }

    // Raw entry URL (only meaningful for GitHub repos)
    let rawFileUrl = null;
    if (repoRoot && isGitHubRepoRoot(repoRoot)) {
      rawFileUrl = toGitHubRawUrl(repoRoot, entryRel, links.branch || "main");
    }

    // Decide main Open URL:
    // prefer preview (explicit), else pagesUrl (if entry exists in this repo), else homepage
    const openUrl = preview || pagesUrl || homepage || null;

    apps.push({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      author: manifest.author,
      version: manifest.version,
      tags: manifest.tags || [],
      runtime: manifest.runtime,

      // Keep entry for reference
      entry: entryRel,

      // Links for the shell
      openUrl,
      previewUrl: preview || null,
      homepageUrl: homepage || null,

      sourceUrl,
      docsUrl,
      screenshotUrl,

      // optional extras (debug / advanced)
      repoUrl: repoRoot || null,
      sourcePath: repoRoot ? sourcePath : null,
      pagesUrl,
      rawFileUrl,
    });
  }

  apps.sort((a, b) => a.id.localeCompare(b.id));

  const outputPath = path.join(appsDir, "index.json");
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: apps.length,
        apps,
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