import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readIgnoredFiles(repoRoot) {
  const result = spawnSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "site/data"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) return new Set();
  return new Set(result.stdout.split("\0").filter(Boolean));
}

function isIgnoredFile(repoRoot, targetPath, ignoredFiles) {
  return ignoredFiles.has(path.relative(repoRoot, targetPath));
}

async function publicPathExists(repoRoot, targetPath, ignoredFiles) {
  if (isIgnoredFile(repoRoot, targetPath, ignoredFiles)) return false;
  return pathExists(targetPath);
}

export async function collectBudgetSourceReminders(repoRoot, slugs) {
  const siteDataDir = path.join(repoRoot, "site", "data");
  const budgetSourcesPath = path.join(siteDataDir, "budget_sources.json");
  const budgetSources = await readJson(budgetSourcesPath, []);
  const sources = Array.isArray(budgetSources) ? budgetSources : [];
  const ignoredFiles = readIgnoredFiles(repoRoot);
  const reminders = [];

  for (const slug of slugs) {
    const budgetIndexPath = path.join(siteDataDir, slug, "budgets", "index.json");
    const hasPublicBudgetIndex = await publicPathExists(repoRoot, budgetIndexPath, ignoredFiles);
    const publicDocs = hasPublicBudgetIndex ? await readJson(budgetIndexPath, []) : [];
    const publicYears = Array.isArray(publicDocs)
      ? publicDocs.map((doc) => doc?.year).filter((year) => typeof year === "string")
      : [];
    const sourceEntries = sources.filter((source) => source.slug === slug);

    for (const year of publicYears) {
      const source = sourceEntries.find((entry) => entry.year === year);
      if (!source) {
        reminders.push(`予算OCRがあります: site/data/${slug}/budgets/${year}/ -> site/data/budget_sources.json に出典を追加してください`);
        continue;
      }
      if (source.status !== "取込済み") {
        reminders.push(`予算OCRがあります: ${slug}/${year} の budget_sources status を "${source.status}" から "取込済み" に更新してください`);
      }
    }

    for (const source of sourceEntries) {
      if (source.status !== "取込済み") continue;
      const manifestPath = path.join(siteDataDir, slug, "budgets", source.year, "manifest.json");
      const hasManifest = await publicPathExists(repoRoot, manifestPath, ignoredFiles);
      if (!hasPublicBudgetIndex || !hasManifest) {
        reminders.push(`予算OCRが見つかりません: ${slug}/${source.year} は "取込済み" ですが公開用 manifest がありません`);
      }
    }
  }

  return reminders;
}

export async function printBudgetSourceReminders(repoRoot, slugs, { dryRun = false } = {}) {
  const reminders = await collectBudgetSourceReminders(repoRoot, slugs);
  if (dryRun && reminders.length === 0) {
    console.log(`[dry-run] budget source reminders: none for ${slugs.join(", ")}`);
    return;
  }
  if (reminders.length === 0) return;

  console.log(dryRun ? "\n# budget source reminders (dry-run)" : "\n# budget source reminders");
  for (const reminder of reminders) {
    console.log(`warn - ${reminder}`);
  }
}
