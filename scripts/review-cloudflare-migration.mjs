import { spawnSync } from "node:child_process";

const groups = [
  {
    id: "cloudflare-runtime",
    title: "1. Cloudflare runtime / site behavior",
    description:
      "OpenNext, Wrangler, runtime scripts, noindex/robots, static search/open-data, GitHub Raw fallback, removed public APIs.",
    matchers: [
      exact(
        "site/package.json",
        "site/package-lock.json",
        "site/open-next.config.ts",
        "site/wrangler.jsonc",
        "site/wrangler.staging.jsonc",
        "site/next.config.ts",
        "site/.gitignore",
        "site/eslint.config.mjs",
        "site/public/robots.txt",
      ),
      prefix(
        "site/scripts/build-public-open-data.mjs",
        "site/scripts/build-search-index.mjs",
        "site/scripts/check-cloudflare-build.mjs",
        "site/scripts/cloudflare-",
        "site/scripts/confirm-cloudflare-release.mjs",
        "site/scripts/prune-cloudflare-assets.mjs",
        "site/scripts/smoke-cloudflare.mjs",
        "site/scripts/verify-cloudflare-",
        "site/src/app/api/",
        "site/src/app/robots.txt/",
        "site/src/components/TopicRecordsClient.tsx",
        "site/src/lib/indexing.ts",
        "site/src/lib/memberPhotos.ts",
        "site/src/lib/publicRawUrl.ts",
        "site/src/lib/staticAssetFetch.ts",
        "site/src/lib/topicAliases.ts",
        "site/src/middleware.ts",
      ),
      (path) =>
        path.startsWith("site/src/app/") &&
        !path.startsWith("site/src/app/privacy/") &&
        !path.startsWith("site/src/app/api/"),
      prefix("site/src/components/", "site/src/lib/"),
    ],
  },
  {
    id: "docs-operations",
    title: "2. Public text / operations tooling",
    description:
      "README, privacy text, release/runbook docs, hosting-neutral docs, and small operations scripts that keep data updates reviewable.",
    matchers: [
      exact(
        "README.md",
        "docs/add-municipality-workflow.md",
        "scripts/generate-information-inventory.mjs",
        "scripts/list-stale-minutes-verifications.mjs",
        "scripts/onboard-municipality.mjs",
        "scripts/operations-check.mjs",
        "scripts/data-health.mjs",
        "scripts/lib/budget-source-reminders.mjs",
        "scripts/lib/minutes-verification-categories.mjs",
        "scripts/lib/public-data-reminders.mjs",
        "scripts/review-cloudflare-migration.mjs",
        "scripts/sync-site-data.mjs",
        "site/.env.example",
        "site/data/news.json",
        "site/src/app/privacy/page.tsx",
      ),
      prefix(
        "docs/cloudflare-",
        "docs/release-checklist.md",
        "docs/open-data-policy.md",
        "docs/operations-principles.md",
        "docs/municipality-coverage.md",
        "docs/municipality-information-inventory.md",
        "docs/editorial/notion-articles-cms.md",
        "docs/mcp-",
        "mcp-server/",
      ),
    ],
  },
  {
    id: "separate-publications",
    title: "3. Separate publications feature candidate",
    description:
      "Shinshinotsu publications trial data and candidate notes. Keep this separate from the Cloudflare migration commit.",
    matchers: [
      prefix("data/shinshinotsu/publications/", "site/data/shinshinotsu/publications/"),
      exact("docs/minutes-expansion-candidates.md"),
    ],
  },
  {
    id: "separate-uryu-segments",
    title: "4. Separate Uryu segments data",
    description:
      "Uryu public segments sync generated after the monthly operations review. Keep this separate from the Cloudflare migration commit.",
    matchers: [
      exact("site/data/search_segment_fallbacks.json"),
      prefix("data/uryu/segments/", "site/data/uryu/segments/"),
    ],
  },
  {
    id: "mixed",
    title: "Needs partial staging",
    description:
      "Contains Cloudflare operations notes, monthly review notes, and separate data-maintenance Done notes. Use git add -p if committing separately.",
    matchers: [exact("docs/operations-board.md")],
  },
];

const forbiddenReleasePaths = [
  "site/.open-next/",
  "site/.wrangler/",
  "site/public/generated/",
  "site/cloudflare-env.d.ts",
];
const mixedPathNotes = [
  {
    commit: "docs-operations",
    section: "Now / Operations",
    contains: "Cloudflare post-cutover monitoring task, latest release-status check, and heartbeat note.",
  },
  {
    commit: "docs-operations",
    section: "Next / Coverage",
    contains: "90-day recheck wording for the 38 unpublished-minutes municipalities.",
  },
  {
    commit: "docs-operations",
    section: "Done",
    contains:
      "Public-data reminders, stale-minutes classification, commit-split tooling, and monthly review notes.",
  },
  {
    commit: "cloudflare-runtime or docs-operations",
    section: "Done",
    contains:
      "Cloudflare free-operation migration note. Stage with the Cloudflare runtime commit if preserving the full cutover story in one commit; otherwise stage with docs-operations.",
  },
  {
    commit: "separate-uryu-segments",
    section: "Done",
    contains: "Uryu segments generation and fallback-search note.",
  },
  {
    commit: "separate-publications",
    section: "Done",
    contains: "Shinshinotsu votes/publications trial note.",
  },
];
const args = process.argv.slice(2);

function exact(...paths) {
  const set = new Set(paths);
  return (path) => set.has(path);
}

function prefix(...prefixes) {
  return (path) => prefixes.some((value) => path.startsWith(value));
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function getArgValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function parseStatusLine(line) {
  const status = line.slice(0, 2);
  const rawPath = line.slice(3);
  const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) : rawPath;
  return { status, path };
}

function classify(path) {
  return groups.find((group) => group.matchers.some((matcher) => matcher(path))) ?? null;
}

function printGroup(group, entries) {
  console.log(`\n## ${group.title}`);
  console.log(group.description);
  console.log(`Files: ${entries.length}`);
  for (const entry of entries) {
    console.log(`- ${entry.status} ${entry.path}`);
  }
}

function groupById(id) {
  return groups.find((group) => group.id === id);
}

const entries = runGit(["status", "--porcelain=v1", "-uall"])
  .split("\n")
  .filter(Boolean)
  .map(parseStatusLine);

const grouped = new Map(groups.map((group) => [group.id, []]));
const unknown = [];

for (const entry of entries) {
  const group = classify(entry.path);
  if (group) {
    grouped.get(group.id).push(entry);
  } else {
    unknown.push(entry);
  }
}

const forbidden = entries.filter((entry) =>
  forbiddenReleasePaths.some((forbiddenPath) => entry.path.startsWith(forbiddenPath) || entry.path === forbiddenPath)
);

function hasBlockingIssues() {
  return unknown.length > 0 || forbidden.length > 0;
}

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/review-cloudflare-migration.mjs");
  console.log("  node scripts/review-cloudflare-migration.mjs --list-groups");
  console.log("  node scripts/review-cloudflare-migration.mjs --markdown");
  console.log("  node scripts/review-cloudflare-migration.mjs --paths <group-id>");
  console.log("  node scripts/review-cloudflare-migration.mjs --git-add <group-id>");
  console.log("  node scripts/review-cloudflare-migration.mjs --commit-message <group-id>");
  console.log("  node scripts/review-cloudflare-migration.mjs --commit-plan");
  console.log("  node scripts/review-cloudflare-migration.mjs --mixed-guide");
  console.log("");
  console.log("Group ids:");
  for (const group of groups) {
    console.log(`  ${group.id}`);
  }
}

if (args.includes("--help")) {
  printUsage();
  process.exit(0);
}

if (args.includes("--list-groups")) {
  for (const group of groups) {
    console.log(`${group.id}\t${group.title}`);
  }
  process.exit(0);
}

if (args.includes("--mixed-guide")) {
  console.log("# Mixed file staging guide");
  console.log("");
  console.log("`docs/operations-board.md` contains notes for multiple review units.");
  console.log("Use this as the decision guide while running:");
  console.log("");
  console.log("  git add -p -- docs/operations-board.md");
  console.log("");
  for (const note of mixedPathNotes) {
    console.log(`## ${note.commit}`);
    console.log(`- section: ${note.section}`);
    console.log(`- contains: ${note.contains}`);
    console.log("");
  }
  process.exit(hasBlockingIssues() ? 1 : 0);
}

if (args.includes("--markdown")) {
  console.log("## Summary");
  console.log("");
  console.log("- Prepare the site for Cloudflare Workers / Static Assets free-operation hosting.");
  console.log("- Move heavy images/data to GitHub Raw fallback and keep runtime/static asset sizes guarded.");
  console.log("- Remove public write-heavy or dynamic-only APIs from the main public site bundle.");
  console.log("- Add preflight, upload, URL verification, release logging, and review split tooling.");
  console.log("");
  console.log("## Review Split");
  console.log("");
  for (const group of groups) {
    console.log(`- ${group.title}: ${grouped.get(group.id).length} files`);
  }
  console.log(`- Uncategorized: ${unknown.length} files`);
  console.log("");
  console.log("## Safety Checks");
  console.log("");
  console.log(`- Forbidden generated/local release files: ${forbidden.length}`);
  console.log("- Expected pre-release gate: `npm run cf:preflight`");
  console.log("- Expected status gate: `npm run cf:release-status`");
  console.log("- Expected post-cutover monitor: `node scripts/operations-check.mjs --cloudflare`");
  console.log("- Expected public smoke: `cd site && npm run cf:post-cutover-check`");
  console.log("- Expected external verification path after login: `CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify`, or staging Worker deploy when Preview URL is unavailable");
  console.log("");
  console.log("## Notes");
  console.log("");
  console.log("- `docs/operations-board.md` should be staged with `git add -p` if Cloudflare and Shinshinotsu notes need separate commits.");
  console.log("- `node scripts/review-cloudflare-migration.mjs --mixed-guide` explains how to split `docs/operations-board.md` safely.");
  console.log("- `site/data/news.json` should be updated only after a verification subdomain or production cutover, not for local-only validation.");
  console.log("- `cf:release-status` can be stale during active local edits; use `cf:preflight` before the next external deploy.");
  process.exit(hasBlockingIssues() ? 1 : 0);
}

function commitMessage(group) {
  const messages = {
    "cloudflare-runtime": {
      subject: "Prepare site runtime for Cloudflare hosting",
      body: [
        "Add OpenNext / Wrangler configuration and Cloudflare release gates.",
        "Move heavy public assets toward GitHub Raw fallback and static generated data.",
        "Remove public write-heavy and dynamic-only APIs from the main site bundle.",
      ],
    },
    "docs-operations": {
      subject: "Document and tighten operations workflow",
      body: [
        "Add runbooks, release logs, review tooling, and hosting-neutral operations docs.",
        "Tighten monthly checks, public-data reminders, and stale minutes recheck classification.",
        "Update public/privacy text to describe Cloudflare and GitHub Raw delivery.",
      ],
    },
    "separate-publications": {
      subject: "Add Shinshinotsu publications trial data",
      body: [
        "Add one publications candidate for Shinshinotsu voting-result material.",
        "Keep the trial data separate from the Cloudflare migration commit.",
      ],
    },
    "separate-uryu-segments": {
      subject: "Publish Uryu segments data",
      body: [
        "Generate Uryu segments from existing minutes and sync them to site data.",
        "Keep the data maintenance separate from the Cloudflare migration commit.",
      ],
    },
    mixed: {
      subject: "Update operations board",
      body: [
        "Use partial staging if Cloudflare, monthly review, and data-maintenance notes need separate commits.",
      ],
    },
  };

  return messages[group.id];
}

function printCommitPlan() {
  console.log("# Suggested commit plan");
  console.log("");
  console.log("Run the safety summary first:");
  console.log("  node scripts/review-cloudflare-migration.mjs");
  console.log("");

  for (const group of groups) {
    const entries = grouped.get(group.id);
    if (entries.length === 0) continue;

    const message = commitMessage(group);
    console.log(`## ${group.title}`);
    console.log(group.description);
    console.log(`Files: ${entries.length}`);
    console.log("");

    if (group.id === "mixed") {
      console.log("Stage carefully:");
      console.log(`  git add -p -- ${entries.map((entry) => shellQuote(entry.path)).join(" ")}`);
      console.log("  node scripts/review-cloudflare-migration.mjs --mixed-guide");
      console.log("");
      console.log("Suggested commit message if staged separately:");
    } else {
      console.log("Stage command proposal:");
      console.log(`  git add -- ${entries.map((entry) => shellQuote(entry.path)).join(" ")}`);
      console.log("");
      console.log("Suggested commit message:");
    }

    console.log(`  ${message.subject}`);
    for (const line of message.body) {
      console.log(`  ${line}`);
    }
    console.log("");
  }

  console.log("Final local checks before asking for commit approval:");
  console.log("  git diff --check");
  console.log("  node scripts/review-cloudflare-migration.mjs --markdown");
  console.log("  node scripts/operations-check.mjs --cloudflare");
  console.log("  cd site && npm run cf:post-cutover-check");
  console.log("");
  console.log("Before the next external Cloudflare deploy:");
  console.log("  cd site && npm run cf:preflight");
  console.log("  cd site && npm run cf:release-status");
  console.log("  # cf:release-status may be stale during local edits; refresh preflight before upload/deploy.");
  console.log("");
  console.log("Cloudflare upload still requires explicit login and release confirmation.");
}

if (args.includes("--commit-plan")) {
  printCommitPlan();
  process.exit(hasBlockingIssues() ? 1 : 0);
}

const commitMessageGroupId = getArgValue("--commit-message");
if (commitMessageGroupId) {
  const group = groupById(commitMessageGroupId);
  if (!group) {
    console.error(`Unknown group id: ${commitMessageGroupId}`);
    printUsage();
    process.exit(1);
  }

  const message = commitMessage(group);
  console.log(message.subject);
  console.log("");
  for (const line of message.body) {
    console.log(line);
  }
  process.exit(hasBlockingIssues() ? 1 : 0);
}

const pathsGroupId = getArgValue("--paths");
if (pathsGroupId) {
  const group = groupById(pathsGroupId);
  if (!group) {
    console.error(`Unknown group id: ${pathsGroupId}`);
    printUsage();
    process.exit(1);
  }

  for (const entry of grouped.get(group.id)) {
    console.log(entry.path);
  }
  process.exit(hasBlockingIssues() ? 1 : 0);
}

const gitAddGroupId = getArgValue("--git-add");
if (gitAddGroupId) {
  const group = groupById(gitAddGroupId);
  if (!group) {
    console.error(`Unknown group id: ${gitAddGroupId}`);
    printUsage();
    process.exit(1);
  }

  const paths = grouped.get(group.id).map((entry) => entry.path);
  if (paths.length === 0) {
    console.log(`# ${group.id}: no paths to stage`);
    process.exit(hasBlockingIssues() ? 1 : 0);
  }

  if (group.id === "mixed") {
    console.log(`# ${group.title}`);
    console.log(`# ${group.description}`);
    console.log(`git add -p -- ${paths.map(shellQuote).join(" ")}`);
  } else {
    console.log(`# ${group.title}`);
    console.log(`git add -- ${paths.map(shellQuote).join(" ")}`);
  }
  process.exit(hasBlockingIssues() ? 1 : 0);
}

console.log("# Cloudflare migration review split");
console.log(`Changed paths: ${entries.length}`);
console.log("");
console.log("Recommended order:");
console.log("1. Review Cloudflare runtime / site behavior.");
console.log("2. Review public text and operations docs.");
console.log("3. Review the separate Shinshinotsu publications candidate.");
console.log("4. Review the separate Uryu segments data.");
console.log("5. Stage docs/operations-board.md with git add -p if those lines need separate commits.");
console.log("");
console.log("Path helpers:");
console.log("  node scripts/review-cloudflare-migration.mjs --paths cloudflare-runtime");
console.log("  node scripts/review-cloudflare-migration.mjs --git-add cloudflare-runtime");

for (const group of groups) {
  printGroup(group, grouped.get(group.id));
}

console.log("\n## Uncategorized");
console.log("Review these manually before committing.");
console.log(`Files: ${unknown.length}`);
for (const entry of unknown) {
  console.log(`- ${entry.status} ${entry.path}`);
}

console.log("\n## Release safety checks");
if (forbidden.length > 0) {
  console.log("Forbidden generated/local release files are present in git status:");
  for (const entry of forbidden) {
    console.log(`- ${entry.status} ${entry.path}`);
  }
  process.exitCode = 1;
} else {
  console.log("No forbidden generated/local release files found in git status.");
}

if (unknown.length > 0) {
  console.log("Uncategorized files need manual classification before commit.");
  process.exitCode = 1;
}
