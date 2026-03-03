import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import fg from "fast-glob";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ROOT = process.cwd();
const SCHEMA_PATH = path.join(ROOT, "schemas", "app-manifest.schema.json");

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function warn(msg) {
  console.warn(`⚠️  ${msg}`);
}

function loadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    fail(`Invalid JSON: ${p}\n${e.message}`);
  }
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(s || "");
}

function isRepoRelativePath(s) {
  if (!s || typeof s !== "string") return false;
  if (isHttpUrl(s)) return false;
  if (s.startsWith("/")) return false;
  if (s.includes("\\")) return false;
  if (/\s/.test(s)) return false;
  return true;
}

function fileExistsUnderApp(appDir, relPath) {
  const p = path.join(appDir, relPath);
  return fs.existsSync(p);
}

function printAjvErrors(errors) {
  return (errors || [])
    .map((e) => {
      const where = e.instancePath || "/";
      return `- ${where} ${e.message || ""}`.trim();
    })
    .join("\n");
}

function normalizePosix(p) {
  return p.split(path.sep).join("/");
}

function getAppIdFromManifestPath(manifestPath) {
  const parts = normalizePosix(manifestPath).split("/");
  return parts.length >= 3 ? parts[1] : null;
}

const schema = loadJson(SCHEMA_PATH);
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const manifestFiles = await fg(["apps/*/manifest.json"], { dot: false });

if (manifestFiles.length === 0) {
  fail(`No manifests found at apps/*/manifest.json`);
}

let hasError = false;

for (const mf of manifestFiles) {
  const fullPath = path.join(ROOT, mf);
  const manifest = loadJson(fullPath);

  // 1) Schema validation
  const ok = validate(manifest);
  if (!ok) {
    console.error(`\n❌ Schema validation failed: ${mf}`);
    console.error(printAjvErrors(validate.errors));
    hasError = true;
    continue;
  }

  const folderId = getAppIdFromManifestPath(mf);
  if (!folderId) {
    console.error(`\n❌ Cannot infer app id from path: ${mf}`);
    hasError = true;
    continue;
  }

  // 2) Path/id consistency
  if (manifest.id !== folderId) {
    console.error(
      `\n❌ id mismatch: manifest.id="${manifest.id}" but folder is "apps/${folderId}/"`
    );
    hasError = true;
  }

  const appDir = path.join(ROOT, "apps", folderId);

  // 3) entry existence (optional)
  if (manifest.entry) {
    if (!fileExistsUnderApp(appDir, manifest.entry)) {
      console.error(
        `\n❌ Missing entry file for ${manifest.id}: apps/${manifest.id}/${manifest.entry}`
      );
      hasError = true;
    }
  }

  // 4) screenshot existence if repo-relative path (optional)
  const links = manifest.links || {};
  if (links.screenshot && isRepoRelativePath(links.screenshot)) {
    const shotRel = links.screenshot;
    if (fs.existsSync(path.join(ROOT, shotRel))) {
      // ok
    } else {
      warn(
        `${manifest.id}: links.screenshot is a relative path but not found in this repo: "${shotRel}". ` +
          `If screenshot lives on a different Pages site, use a full URL instead.`
      );
    }
  }

  // 5) tags unique (schema already enforces uniqueItems, but double-check)
  if (Array.isArray(manifest.tags)) {
    const set = new Set(manifest.tags);
    if (set.size !== manifest.tags.length) {
      console.error(`\n❌ Duplicate tags detected in ${manifest.id}`);
      hasError = true;
    }
  }

  console.log(`✅ ${manifest.id}: manifest validated`);
}

if (hasError) {
  fail("Manifest validation failed.");
}

console.log("\n✅ All manifests validated successfully.");