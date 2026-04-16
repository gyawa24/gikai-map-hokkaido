#!/usr/bin/env node
/**
 * scraper-gen-batch.mjs — 議員一覧スクレイパー一括自動生成
 *
 * 使い方:
 *   node agents/scraper-gen-batch.mjs [options]
 *
 * オプション:
 *   --include-stubs   active:false の stub も対象に含める（成功時に active化）
 *   --region <名>     振興局で絞り込み（例: --region 空知）
 *   --limit <N>       処理件数上限（試験実行向け）
 *   --dry-run         対象リストを表示するだけで実行しない
 *
 * 既定: active:true かつ "members" 未取得 かつ level=municipality の市町村を順次処理。
 * 道議会 (level=prefecture) は独自ASPのためこのbatch対象外。
 */
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function readMunicipalities() {
  return JSON.parse(
    readFileSync(path.join(ROOT, "data", "municipalities.json"), "utf-8")
  );
}

function writeMunicipalities(data) {
  const fp = path.join(ROOT, "data", "municipalities.json");
  writeFileSync(fp, JSON.stringify(data, null, 2) + "\n");
  const siteFp = path.join(ROOT, "site", "data", "municipalities.json");
  if (existsSync(siteFp)) {
    writeFileSync(siteFp, JSON.stringify(data, null, 2) + "\n");
  }
}

async function generateForCity(muni) {
  const exampleScraper = readFileSync(
    path.join(ROOT, "scraper", "eniwa", "scrape_members.py"),
    "utf-8"
  );

  const prompt = `あなたは Python スクレイピングの専門家です。
${muni.name}（${muni.council_name}）の議員一覧データを取得してください。

## 厳守事項（ハードコード禁止）
公共情報の正確性が命のプロジェクトです。以下を守ってください：

- 議員の氏名・ふりがな・会派・委員会・政党などを Python コード内に **ハードコードしてはいけません**。
  例: \`MEMBERS_DATA = [{"name": "○○", ...}, ...]\` のような構造化データを直書きする実装は禁止。
- Claude の学習データから議員名を推測して書くのも禁止です。**必ず公式サイトから都度動的に取得**してください。
- スクレイパーを再実行すれば常に最新データが取れる形にしてください。
- 動的取得の優先順位：
  1. HTML ページを requests + BeautifulSoup でパース（最優先）
  2. HTML に議員一覧が無く PDF のみの場合は、pdfplumber で抽出を試みる
  3. 上記2つとも安定しない場合は **取得不可として members.json を作成せず終了** してください
     （「取得不可: 理由」を報告）

## 手順
1. WebFetch で "${muni.name} 議会 議員一覧" に相当する公式URLを探す
   まず以下のURLを試してください（存在しない場合は別のURLを探すこと）:
   - https://www.city.${muni.slug}.hokkaido.jp/gikai/
   - https://www.town.${muni.slug}.hokkaido.jp/gikai/
   - https://www.${muni.slug}.hokkaido.jp/gikai/
   見つからない場合は WebFetch で検索して正しいURLを特定すること。

2. 議員一覧ページのHTML構造を確認する。議員氏名・会派等がHTML内にテキストとして存在するかを必ず目視確認。
   画像内のテキストやPDF埋め込みで動的取得できない場合は、厳守事項 3. に従う。

3. 以下の参考スクレイパーを参考に Python スクレイパーを作成する:
\`\`\`python
${exampleScraper.slice(0, 3000)}
\`\`\`

4. スクレイパーを以下に保存:
   ${ROOT}/scraper/${muni.slug}/scrape_members.py

5. Bash で実行:
   cd ${ROOT} && python scraper/${muni.slug}/scrape_members.py

6. エラーが出た場合は修正して再実行（最大3回）。取得不可と判断したら members.json を作らず中断。

## 出力要件
- 出力: data/${muni.slug}/members.json
- フィールド: seat_number, name, furigana, party, faction, committees
- 写真は site/public/members/${muni.slug}/ に保存（取得できない場合はスキップ）
- 写真URLは "/members/${muni.slug}/seat_N.jpg" 形式

完了したら「取得議員数: N名」または「取得不可: 理由」と報告してください。`;

  console.log(`\n${"─".repeat(50)}`);
  console.log(`🔨 ${muni.name}（${muni.slug}）のスクレイパーを生成中...`);
  console.log(`${"─".repeat(50)}`);

  const result = spawnSync(
    "claude",
    [
      "--print",
      "--dangerously-skip-permissions",
      "--allowedTools", "Read,Write,Bash,WebFetch,Glob",
      "-p", prompt,
    ],
    {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 30 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env },
    }
  );

  if (result.stdout) {
    console.log(result.stdout.slice(-600));
  }

  if (result.status !== 0 || result.error) {
    console.error(`❌ ${muni.name}: 失敗`);
    if (result.error) console.error(result.error.message);
    return false;
  }

  // members.json の存在確認
  const paths = [
    path.join(ROOT, "data", muni.slug, "members.json"),
    path.join(ROOT, "site", "data", muni.slug, "members.json"),
  ];
  const membersPath = paths.find(existsSync);

  if (!membersPath) {
    console.error(`❌ ${muni.name}: members.json が見つかりません`);
    return false;
  }

  // municipalities.json を更新
  const munis = readMunicipalities();
  const target = munis.find((m) => m.slug === muni.slug);
  if (target) {
    let changed = false;
    if (!target.features.includes("members")) {
      target.features.unshift("members");
      changed = true;
    }
    // stub だった場合は active に昇格
    if (!target.active) {
      target.active = true;
      changed = true;
    }
    if (changed) writeMunicipalities(munis);
  }

  try {
    const members = JSON.parse(readFileSync(membersPath, "utf-8"));
    console.log(`✅ ${muni.name}: ${members.length}名 取得完了`);
  } catch {
    console.log(`✅ ${muni.name}: 完了`);
  }

  return true;
}

function parseArgs(argv) {
  const args = { includeStubs: false, region: null, limit: null, dryRun: false, slug: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--include-stubs") args.includeStubs = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--region") args.region = argv[++i];
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (a === "--slug") args.slug = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const munis = readMunicipalities();
  let targets = munis.filter(
    (m) =>
      m.level !== "prefecture" &&
      !m.features.includes("members") &&
      (m.active || args.includeStubs)
  );
  if (args.slug) targets = targets.filter((m) => m.slug === args.slug);
  if (args.region) targets = targets.filter((m) => m.region === args.region);
  if (args.limit) targets = targets.slice(0, args.limit);

  if (targets.length === 0) {
    console.log("✅ 対象なし。");
    return;
  }

  console.log(`\n📋 処理対象: ${targets.length}市町村`);
  targets.forEach((m) =>
    console.log(`  - ${m.name}（${m.slug}）${m.active ? "" : " [stub]"}`)
  );
  console.log();

  if (args.dryRun) {
    console.log("（--dry-run のため実行しません）");
    return;
  }

  const results = { success: [], failed: [] };

  for (const muni of targets) {
    const ok = await generateForCity(muni);
    if (ok) {
      results.success.push(muni.name);
    } else {
      results.failed.push(muni.name);
    }
    // 次の市まで少し待機
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`✅ 成功: ${results.success.length}市`);
  if (results.success.length) console.log(`   ${results.success.join("、")}`);
  if (results.failed.length) {
    console.log(`❌ 失敗: ${results.failed.length}市`);
    console.log(`   ${results.failed.join("、")}`);
    console.log(`\n失敗した市は個別に再実行してください:`);
    results.failed.forEach((name) => {
      const m = munis.find((x) => x.name === name);
      if (m) console.log(`  node agents/scraper-gen.mjs ${m.slug} <URL>`);
    });
  }
}

main().catch(console.error);
