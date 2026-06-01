import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const prunedAssetDirs = [
  {
    path: path.join(siteRoot, ".open-next", "assets", "budgets"),
    reason: "budget page images are served from GitHub Raw URLs",
  },
  {
    path: path.join(siteRoot, ".open-next", "assets", "members"),
    reason: "member photos are served from GitHub Raw URLs",
  },
];

let removedCount = 0;

for (const assetDir of prunedAssetDirs) {
  if (!fs.existsSync(assetDir.path)) continue;
  fs.rmSync(assetDir.path, { recursive: true, force: true });
  removedCount += 1;
  console.log(`Pruned ${path.relative(siteRoot, assetDir.path)}: ${assetDir.reason}`);
}

if (removedCount === 0) {
  console.log("No Cloudflare static asset directories needed pruning.");
}
