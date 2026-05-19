#!/usr/bin/env node
/**
 * scraper-gen.mjs — 議員一覧スクレイパー自動生成ツール
 *
 * 使い方:
 *   node agents/scraper-gen.mjs <slug> <url>
 *
 * 例:
 *   node agents/scraper-gen.mjs asahikawa https://www.city.asahikawa.hokkaido.jp/gikai/members/
 *
 * やること:
 *   1. URLのページ構造をClaudeが解析
 *   2. Pythonスクレイパーを自動生成 → scraper/{slug}/scrape_members.py
 *   3. スクレイパーを実行 → data/{slug}/members.json を生成
 *   4. data/{slug}/members.json の存在により capability 台帳へ反映
 */
import { spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function readMunicipalities() {
  const fp = path.join(ROOT, "data", "municipalities.json");
  return JSON.parse(readFileSync(fp, "utf-8"));
}

async function generateScraper(slug, url) {
  const municipalities = readMunicipalities();
  const muni = municipalities.find((m) => m.slug === slug);

  if (!muni) {
    console.error(`❌ "${slug}" は municipalities.json に登録されていません`);
    process.exit(1);
  }

  console.log(`\n🔍 Generating scraper for ${muni.name} (${slug})`);
  console.log(`   URL: ${url}\n`);

  // 既存スクレイパーの例を読む
  const exampleScraper = readFileSync(
    path.join(ROOT, "scraper", "eniwa", "scrape_members.py"),
    "utf-8"
  );
  const exampleOutput = (() => {
    try {
      return readFileSync(
        path.join(ROOT, "data", "eniwa", "members.json"),
        "utf-8"
      ).slice(0, 500);
    } catch {
      return "[]";
    }
  })();

  const prompt = `あなたは Python スクレイピングの専門家です。
指定された議会サイトの議員一覧ページを解析し、Pythonスクレイパーを作成してください。

## 対象
- 自治体: ${muni.name}（${muni.council_name}）
- slug: ${slug}
- URL: ${url}

## 作業手順
1. まず WebFetch ツールで ${url} のHTMLを取得し、ページ構造を確認する
2. 必要であれば関連ページも確認する
3. 以下の参考スクレイパーを参考に、この自治体用のスクレイパーを作成する

## 参考スクレイパー（恵庭市版）
\`\`\`python
${exampleScraper}
\`\`\`

## 参考出力形式（members.json）
\`\`\`json
${exampleOutput}
\`\`\`

## 出力要件
- 出力ファイル: \`data/${slug}/members.json\`（ROOT = ${ROOT} からの相対パス）
- 写真は \`site/public/members/${slug}/\` に保存（取得できない場合はスキップ）
- photo_url は "/members/${slug}/seat_N.jpg" 形式（取得できた場合のみ）
- 以下のフィールドを可能な限り収集:
  - seat_number（議席番号、なければ連番）
  - name（氏名）
  - furigana（ふりがな、なければ空文字）
  - party（政党、なければ空文字）
  - faction（会派、なければ空文字）
  - committees（委員会リスト、なければ空配列）
  - votes（得票数、なければ省略）

## スクレイパー作成後の実行
作成したスクレイパーを以下のパスに保存してください:
  ${ROOT}/scraper/${slug}/scrape_members.py

保存したら Bash ツールで実行してください:
  cd ${ROOT} && python scraper/${slug}/scrape_members.py

実行後、data/${slug}/members.json が生成されていることを確認してください。
もしエラーが出た場合は修正して再実行してください（最大3回まで試みること）。

最後に実行結果（取得できた議員数など）を報告してください。`;

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
      timeout: 30 * 60 * 1000, // 30分
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env },
    }
  );

  if (result.stdout) {
    console.log("\n--- Agent output ---");
    console.log(result.stdout.slice(-1000));
    console.log("---\n");
  }

  if (result.status !== 0 || result.error) {
    console.error("❌ Scraper generation failed");
    if (result.stderr) console.error(result.stderr.slice(0, 300));
    if (result.error) console.error(result.error.message);
    return false;
  }

  // members.json が生成されたか確認
  const membersPath = path.join(ROOT, "data", slug, "members.json");
  if (!existsSync(membersPath)) {
    // site/data にある場合もある
    const siteMembersPath = path.join(ROOT, "site", "data", slug, "members.json");
    if (!existsSync(siteMembersPath)) {
      console.error(`❌ members.json が生成されませんでした: ${membersPath}`);
      return false;
    }
  }

  console.log(`✅ members.json を確認しました。公開判定は capability 台帳の再生成で反映されます`);

  // members.json から件数を表示
  try {
    const members = JSON.parse(readFileSync(membersPath, "utf-8"));
    console.log(`✅ ${muni.name}: 議員 ${members.length} 名のデータを取得しました`);
  } catch {
    console.log(`✅ ${muni.name}: スクレイパー実行完了`);
  }

  return true;
}

// エントリーポイント
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log(`
使い方:
  node agents/scraper-gen.mjs <slug> <url>

例:
  node agents/scraper-gen.mjs asahikawa https://www.city.asahikawa.hokkaido.jp/gikai/
  node agents/scraper-gen.mjs hakodate  https://www.city.hakodate.hokkaido.jp/docs/gikai/

slugは municipalities.json に登録されている値を使うこと。
`);
  process.exit(1);
}

const [slug, url] = args;
generateScraper(slug, url).then((ok) => {
  process.exit(ok ? 0 : 1);
}).catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
