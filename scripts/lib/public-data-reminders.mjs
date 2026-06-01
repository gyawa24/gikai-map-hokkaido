import fs from "node:fs/promises";
import path from "node:path";

const PUBLIC_DATA_ENTRIES = [
  { id: "members", label: "議員", paths: ["members.json"] },
  { id: "minutes", label: "議事録", paths: ["minutes/index.json", "index.json"] },
  { id: "sessions", label: "会期", paths: ["sessions/index.json"] },
  { id: "decisions", label: "議決結果", paths: ["decisions.json"] },
  { id: "schedule", label: "日程", paths: ["schedule.json"] },
  { id: "newsletter", label: "議会だより", paths: ["newsletter.json"] },
  { id: "election", label: "選挙", paths: ["election.json"] },
  { id: "budgets", label: "予算書", paths: ["budgets/index.json"] },
  { id: "publications", label: "掲載資料", paths: ["publications/index.json"] },
];

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function formatSlugList(slugs) {
  if (slugs.length <= 8) return slugs.join(", ");
  return `${slugs.slice(0, 8).join(", ")} ほか${slugs.length - 8}件`;
}

async function hasAnyPath(baseDir, paths) {
  for (const relPath of paths) {
    if (await pathExists(path.join(baseDir, relPath))) return true;
  }
  return false;
}

export async function collectPublicDataReminders(repoRoot, slugs) {
  const rootDataDir = path.join(repoRoot, "data");
  const siteDataDir = path.join(repoRoot, "site", "data");
  const byEntry = new Map(PUBLIC_DATA_ENTRIES.map((entry) => [entry.id, []]));
  const touchedSlugs = [];

  for (const slug of slugs) {
    const cityDirs = [path.join(siteDataDir, slug), path.join(rootDataDir, slug)];
    const presentEntries = [];

    for (const entry of PUBLIC_DATA_ENTRIES) {
      let hasEntry = false;
      for (const cityDir of cityDirs) {
        if (await hasAnyPath(cityDir, entry.paths)) {
          hasEntry = true;
          break;
        }
      }
      if (hasEntry) {
        byEntry.get(entry.id).push(slug);
        presentEntries.push(entry.label);
      }
    }

    if (presentEntries.length > 0) {
      touchedSlugs.push({ slug, labels: presentEntries });
    }
  }

  const reminders = [];
  if (touchedSlugs.length > 0) {
    reminders.push(
      `公開データ同期後: ${touchedSlugs.length}自治体 (${formatSlugList(
        touchedSlugs.map((item) => item.slug)
      )}) -> site/data/news.json の追記要否と coverage / inventory 再生成要否を確認してください`
    );
  }

  const publicationsSlugs = byEntry.get("publications") ?? [];
  if (publicationsSlugs.length > 0) {
    reminders.push(
      `publicationsがあります: ${formatSlugList(
        publicationsSlugs
      )} -> docs/municipality-information-inventory.md と docs/operations-board.md のfeature扱いを確認してください`
    );
  }

  const minutesSlugs = byEntry.get("minutes") ?? [];
  if (minutesSlugs.length > 0) {
    reminders.push(
      `議事録データがあります: ${formatSlugList(
        minutesSlugs
      )} -> segments / themes / 検索indexへの反映要否を確認してください`
    );
  }

  return reminders;
}

export async function printPublicDataReminders(repoRoot, slugs, { dryRun = false } = {}) {
  const reminders = await collectPublicDataReminders(repoRoot, slugs);
  if (dryRun && reminders.length === 0) {
    console.log(`[dry-run] public data reminders: none for ${slugs.join(", ")}`);
    return;
  }
  if (reminders.length === 0) return;

  console.log(dryRun ? "\n# public data reminders (dry-run)" : "\n# public data reminders");
  for (const reminder of reminders) {
    console.log(`warn - ${reminder}`);
  }
}
