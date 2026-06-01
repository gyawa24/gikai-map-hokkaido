import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(siteRoot, "..");
const openNextRoot = path.join(siteRoot, ".open-next");
const workerPath = path.join(openNextRoot, "worker.js");
const serverHandlerPath = path.join(openNextRoot, "server-functions", "default", "handler.mjs");
const middlewareHandlerPath = path.join(openNextRoot, "middleware", "handler.mjs");
const assetsDir = path.join(openNextRoot, "assets");
const cacheDir = path.join(openNextRoot, "cache");
const populatedCacheAssetsDir = path.join(assetsDir, "cdn-cgi", "_next_cache");
const packageJsonPath = path.join(siteRoot, "package.json");
const wranglerConfigPath = path.join(siteRoot, "wrangler.jsonc");
const openNextConfigPath = path.join(siteRoot, "open-next.config.ts");

const MiB = 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 25 * MiB;
const MAX_RUNTIME_ENTRY_GZIP_BYTES = 3 * MiB;
const MAX_ESTIMATED_UPLOAD_FILES = 18_000;
const MAX_ESTIMATED_UPLOAD_BYTES = 1500 * MiB;

const forbiddenAssetDirs = [
  path.join(assetsDir, "budgets"),
  path.join(assetsDir, "members"),
];
const forbiddenSourcePaths = [
  {
    path: path.join(siteRoot, "public", "robots.txt"),
    reason: "robots.txt is generated per-host so preview URLs can stay noindex",
  },
  {
    path: path.join(siteRoot, "src", "app", "api", "export", "members"),
    reason: "member CSV is served as static open data",
  },
  {
    path: path.join(siteRoot, "src", "app", "api", "like"),
    reason: "likes require a write store and are disabled for free operation",
  },
  {
    path: path.join(siteRoot, "src", "app", "api", "mcp"),
    reason: "remote MCP is separated from the public site",
  },
  {
    path: path.join(siteRoot, "src", "app", "api", "og-member"),
    reason: "per-member OGP generation is replaced by the static site image",
  },
  {
    path: path.join(siteRoot, "src", "app", "api", "og-segment"),
    reason: "per-segment OGP generation is replaced by the static site image",
  },
  {
    path: path.join(siteRoot, "src", "app", "api", "og-site"),
    reason: "site OGP is served as a static image",
  },
];
const forbiddenPackages = [
  "@modelcontextprotocol/sdk",
  "@upstash/redis",
  "@vercel/analytics",
  "@vercel/kv",
];
const forbiddenReleaseFileChecks = [
  {
    test: (relPath) => relPath.startsWith("site/.open-next/"),
    reason: "OpenNext build artifacts must stay untracked",
  },
  {
    test: (relPath) => relPath.startsWith("site/.wrangler/"),
    reason: "Wrangler local state must stay untracked",
  },
  {
    test: (relPath) => relPath.startsWith("site/public/generated/"),
    reason: "generated Cloudflare runtime assets are rebuilt locally",
  },
  {
    test: (relPath) => relPath === "site/cloudflare-env.d.ts",
    reason: "Wrangler typegen output is local-only until intentionally adopted",
  },
  {
    test: (relPath) => relPath.startsWith("site/.env") && relPath !== "site/.env.example",
    reason: "environment files must not be committed",
  },
  {
    test: (relPath) => /\.(pem|key|p12)$/i.test(relPath),
    reason: "secret key material must not be committed",
  },
];

function formatBytes(bytes) {
  if (bytes >= MiB) return `${(bytes / MiB).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function isWithin(target, parent) {
  const rel = path.relative(parent, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function walkFiles(root, options = {}) {
  if (!fs.existsSync(root)) return [];

  const excludeDirs = options.excludeDirs ?? [];
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fp = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (excludeDirs.some((dir) => isWithin(fp, dir))) continue;
        stack.push(fp);
      } else if (entry.isFile()) {
        files.push(fp);
      }
    }
  }
  return files;
}

function collectStats(root, options = {}) {
  const files = walkFiles(root, options);
  let bytes = 0;
  const largeFiles = [];

  for (const fp of files) {
    const size = fs.statSync(fp).size;
    bytes += size;
    if (size > MAX_SINGLE_FILE_BYTES) {
      largeFiles.push({ path: fp, size });
    }
  }

  return { bytes, files, largeFiles };
}

function compressedFileStats(fp) {
  if (!fs.existsSync(fp)) return null;
  const source = fs.readFileSync(fp);
  return {
    path: fp,
    bytes: source.length,
    gzipBytes: zlib.gzipSync(source).length,
  };
}

function countTreeEntries(root) {
  if (!fs.existsSync(root)) return 0;

  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      count += 1;
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
    }
  }
  return count;
}

function relative(fp) {
  return path.relative(siteRoot, fp);
}

function listReleaseFiles() {
  const result = spawnSync(
    "git",
    ["-C", repoRoot, "ls-files", "--cached", "--others", "--exclude-standard", "site"],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || "Failed to list release files.");
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function stripJsonComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function checkScript(packageJson, name, expectedStart) {
  const script = packageJson.scripts?.[name];
  if (!script?.startsWith(expectedStart)) {
    errors.push(`${name} script must start with: ${expectedStart}`);
  }
}

const errors = [];

try {
  for (const relPath of listReleaseFiles()) {
    const match = forbiddenReleaseFileChecks.find((check) => check.test(relPath));
    if (match) {
      errors.push(`${relPath} must not be part of the release: ${match.reason}`);
    }
  }
} catch (error) {
  errors.push(`release file list を確認できません: ${error instanceof Error ? error.message : String(error)}`);
}

if (!fs.existsSync(openNextRoot)) {
  errors.push(".open-next が見つかりません。先に Cloudflare build を実行してください。");
}

const runtimeEntries = [
  { label: "worker entry", path: workerPath },
  { label: "server handler", path: serverHandlerPath },
  { label: "middleware handler", path: middlewareHandlerPath },
].map((entry) => ({ ...entry, stats: compressedFileStats(entry.path) }));

for (const entry of runtimeEntries) {
  if (!entry.stats) {
    errors.push(`${relative(entry.path)} が見つかりません。OpenNext build が完了していない可能性があります。`);
    continue;
  }
  if (entry.stats.gzipBytes > MAX_RUNTIME_ENTRY_GZIP_BYTES) {
    errors.push(
      `${relative(entry.path)} のgzip後サイズがWorkers Freeの目安を超えています: ${formatBytes(entry.stats.gzipBytes)}`
    );
  }
}

if (!fs.existsSync(assetsDir)) {
  errors.push(".open-next/assets が見つかりません。OpenNext build が完了していない可能性があります。");
}

for (const dir of forbiddenAssetDirs) {
  if (fs.existsSync(dir)) {
    errors.push(`${relative(dir)} が残っています。GitHub Raw 配信に逃がす前提なので pruning を確認してください。`);
  }
}

for (const item of forbiddenSourcePaths) {
  if (!fs.existsSync(item.path)) continue;
  const stat = fs.statSync(item.path);
  const hasForbiddenFiles = stat.isDirectory() ? walkFiles(item.path).length > 0 : stat.isFile();
  if (hasForbiddenFiles) {
    errors.push(`${relative(item.path)} が残っています: ${item.reason}`);
  }
}

try {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  checkScript(
    packageJson,
    "cf:build",
    "opennextjs-cloudflare build && node scripts/prune-cloudflare-assets.mjs && node scripts/check-cloudflare-build.mjs"
  );
  checkScript(
    packageJson,
    "cf:preflight",
    "node scripts/verify-cloudflare-local.mjs --dry-run"
  );
  checkScript(
    packageJson,
    "cf:upload",
    "node scripts/confirm-cloudflare-release.mjs upload &&"
  );
  checkScript(
    packageJson,
    "cf:upload-verify",
    "node scripts/cloudflare-upload-and-verify.mjs"
  );
  checkScript(
    packageJson,
    "cf:deploy",
    "node scripts/confirm-cloudflare-release.mjs deploy &&"
  );

  const dependencySections = [
    packageJson.dependencies ?? {},
    packageJson.devDependencies ?? {},
    packageJson.optionalDependencies ?? {},
  ];
  const installedForbiddenPackages = forbiddenPackages.filter((name) =>
    dependencySections.some((section) => Object.hasOwn(section, name))
  );
  for (const name of installedForbiddenPackages) {
    errors.push(`${name} is still listed in package.json and should stay out of the free-operation bundle`);
  }
} catch (error) {
  errors.push(`package.json を確認できません: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const wranglerConfig = JSON.parse(stripJsonComments(fs.readFileSync(wranglerConfigPath, "utf8")));
  if (wranglerConfig.name !== "chihougikai-com") {
    errors.push("wrangler.jsonc name must stay chihougikai-com");
  }
  if (wranglerConfig.main !== ".open-next/worker.js") {
    errors.push("wrangler.jsonc main must point to .open-next/worker.js");
  }
  if (wranglerConfig.assets?.directory !== ".open-next/assets") {
    errors.push("wrangler.jsonc assets.directory must stay .open-next/assets");
  }
  if (wranglerConfig.assets?.binding !== "ASSETS") {
    errors.push("wrangler.jsonc assets.binding must stay ASSETS");
  }
  if (!wranglerConfig.compatibility_flags?.includes("nodejs_compat")) {
    errors.push("wrangler.jsonc compatibility_flags must include nodejs_compat");
  }
  if (wranglerConfig.preview_urls !== true) {
    errors.push("wrangler.jsonc preview_urls must stay true so cf:upload-verify can smoke-test a preview alias before production deploy");
  }
  if (wranglerConfig.observability?.enabled !== false) {
    errors.push("wrangler.jsonc observability.enabled must stay false for low-cost operation");
  }
  if (Object.hasOwn(wranglerConfig, "placement") || Object.hasOwn(wranglerConfig, "smart_placement")) {
    errors.push("wrangler.jsonc must not enable Smart Placement for the free-operation path");
  }
} catch (error) {
  errors.push(`wrangler.jsonc を確認できません: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const openNextConfig = fs.readFileSync(openNextConfigPath, "utf8");
  if (!openNextConfig.includes("static-assets-incremental-cache")) {
    errors.push("open-next.config.ts must keep static-assets-incremental-cache");
  }
  if (!openNextConfig.includes("incrementalCache: staticAssetsIncrementalCache")) {
    errors.push("open-next.config.ts must keep staticAssetsIncrementalCache wired as incrementalCache");
  }
} catch (error) {
  errors.push(`open-next.config.ts を確認できません: ${error instanceof Error ? error.message : String(error)}`);
}

const assets = collectStats(assetsDir, { excludeDirs: [populatedCacheAssetsDir] });
const cache = collectStats(cacheDir);
const populatedCacheAssets = collectStats(populatedCacheAssetsDir);
const wranglerAssetEntries = countTreeEntries(assetsDir);
const cacheUploadSource = populatedCacheAssets.files.length > 0 ? populatedCacheAssets : cache;
const allLargeFiles = [...assets.largeFiles, ...cacheUploadSource.largeFiles];
const estimatedUploadFiles = assets.files.length + cacheUploadSource.files.length;
const estimatedUploadBytes = assets.bytes + cacheUploadSource.bytes;

if (estimatedUploadFiles > MAX_ESTIMATED_UPLOAD_FILES) {
  errors.push(
    `Cloudflare static assets 推定ファイル数が多すぎます: ${estimatedUploadFiles.toLocaleString()} files`
  );
}

if (estimatedUploadBytes > MAX_ESTIMATED_UPLOAD_BYTES) {
  errors.push(
    `Cloudflare static assets 推定サイズが大きすぎます: ${formatBytes(estimatedUploadBytes)}`
  );
}

if (allLargeFiles.length > 0) {
  for (const file of allLargeFiles.slice(0, 10)) {
    errors.push(`${relative(file.path)} が25MiBを超えています: ${formatBytes(file.size)}`);
  }
}

console.log("Cloudflare build check");
for (const entry of runtimeEntries) {
  const stats = entry.stats;
  console.log(
    `- ${entry.label}: ${stats ? `${formatBytes(stats.bytes)} / gzip ${formatBytes(stats.gzipBytes)}` : "missing"}`
  );
}
console.log(`- assets: ${formatBytes(assets.bytes)} / ${assets.files.length.toLocaleString()} files`);
console.log(`- cache: ${formatBytes(cache.bytes)} / ${cache.files.length.toLocaleString()} files`);
if (populatedCacheAssets.files.length > 0) {
  console.log(
    `- populated cache assets: ${formatBytes(populatedCacheAssets.bytes)} / ${populatedCacheAssets.files.length.toLocaleString()} files`
  );
  console.log(`- wrangler asset entries: ${wranglerAssetEntries.toLocaleString()} entries`);
}
console.log(
  `- estimated upload: ${formatBytes(estimatedUploadBytes)} / ${estimatedUploadFiles.toLocaleString()} files`
);

if (errors.length > 0) {
  console.error("\nCloudflare build check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Cloudflare build check passed.");
