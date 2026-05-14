import fs from "node:fs";
import path from "node:path";

const [city, year, defaultLabel = "予算書", sourceLabel] = process.argv.slice(2);

if (!city || !year) {
  console.error("Usage: node scripts/annotate-budget-labels.mjs <city> <year> [defaultLabel] [sourceLabel]");
  process.exit(1);
}

const siteRoot = process.cwd();
const manifestPath = path.join(siteRoot, "data", city, "budgets", year, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

const compact = (text) =>
  (text ?? "")
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑‒–—―ー−－]/g, "-")
    .replace(/[ \t\r\n　]/g, "");

const expenseLabels = [
  "議会費",
  "総務費",
  "市民生活費",
  "市民文化費",
  "民生費",
  "保健福祉費",
  "子ども未来費",
  "衛生費",
  "環境衛生費",
  "環境費",
  "労働費",
  "農林水産業費",
  "農林業費",
  "農水産業費",
  "農業費",
  "林業費",
  "水産業費",
  "農政費",
  "商工費",
  "経済費",
  "観光費",
  "土木費",
  "港湾費",
  "消防費",
  "教育費",
  "災害復旧費",
  "公債費",
  "諸支出金",
  "職員費",
  "予備費",
  "保険給付費",
  "国民健康保険事業費納付金",
  "後期高齢者支援金等",
  "介護納付金",
  "共同事業拠出金",
  "保健事業費",
  "地域支援事業費",
  "保健福祉事業費",
  "基金積立金",
  "介護サービス事業費",
  "後期高齢者医療広域連合納付金",
  "母子父子寡婦福祉資金貸付事業費",
  "母子福祉資金等貸付事業費",
  "動物園事業費",
  "駐車場事業費",
  "育英事業費",
  "個別排水処理事業費",
  "水道事業費",
  "下水道事業費",
  "病院事業費",
  "市場事業費",
  "卸売市場事業費",
  "港湾整備事業費",
  "空港事業費",
  "住宅新築資金等貸付事業費",
];

const revenueLabels = [
  "市税",
  "地方譲与税",
  "利子割交付金",
  "配当割交付金",
  "株式等譲渡所得割交付金",
  "法人事業税交付金",
  "地方消費税交付金",
  "ゴルフ場利用税交付金",
  "環境性能割交付金",
  "地方特例交付金",
  "地方交付税",
  "交通安全対策特別交付金",
  "分担金及び負担金",
  "使用料及び手数料",
  "国庫支出金",
  "道支出金",
  "財産収入",
  "寄附金",
  "繰入金",
  "繰越金",
  "諸収入",
  "市債",
];

const accountLabels = [
  "一般会計",
  "国民健康保険会計",
  "国民健康保険事業特別会計",
  "国民健康保険特別会計",
  "介護保険会計",
  "介護保険事業特別会計",
  "介護保険特別会計",
  "後期高齢者医療会計",
  "後期高齢者医療事業特別会計",
  "後期高齢者医療特別会計",
  "母子父子寡婦福祉資金貸付事業特別会計",
  "母子福祉資金等貸付事業特別会計",
  "動物園事業特別会計",
  "公共駐車場事業特別会計",
  "駐車場事業特別会計",
  "育英事業特別会計",
  "中島霊園事業特別会計",
  "土地区画整理事業特別会計",
  "卸売市場事業特別会計",
  "港湾整備事業特別会計",
  "空港事業特別会計",
  "住宅新築資金等貸付事業特別会計",
  "水道事業会計",
  "工業用水道事業会計",
  "下水道事業会計",
  "病院事業会計",
  "市立病院事業会計",
  "交通事業会計",
  "軌道整備事業会計",
  "高速電車事業会計",
  "中央卸売市場事業会計",
  "公設地方卸売市場事業会計",
  "公営企業会計",
  "企業会計",
];

function includesAny(text, labels) {
  return [...labels]
    .sort((a, b) => compact(b).length - compact(a).length)
    .find((label) => text.includes(compact(label))) ?? null;
}

function detectLabel(page) {
  const title = compact(page.title);
  const preview = compact(page.preview);
  const joined = compact(`${page.title ?? ""} ${page.preview ?? ""}`);

  if (title.includes("目次")) return { label: "目次", propagate: false };
  const account = includesAny(joined, accountLabels);
  if (account && (title.includes(compact(account)) || joined.includes(`令和8年度${compact(account)}予算`) || joined.includes(`令和８年度${compact(account)}予算`) || joined.includes(`${compact(account)}予算実施計画`) || joined.includes(`${compact(account)}予算事項別明細書`))) {
    return { label: account, propagate: true };
  }
  if (title.includes("給与費明細書") || preview.startsWith("給与費明細書") || joined.includes("給料及び職員手当等の増減額")) {
    return { label: "給与費明細書", propagate: true };
  }
  if (title.includes("継続費") || preview.startsWith("継続費に関する調書")) {
    return { label: "継続費", propagate: true };
  }
  if (title.includes("債務負担行為") || preview.startsWith("債務負担行為") || preview.startsWith("第2表債務負担行為") || preview.startsWith("第２表債務負担行為")) {
    return { label: "債務負担行為", propagate: true };
  }
  if (preview.startsWith("地方債に関する調書") || title.includes("地方債")) {
    return { label: "地方債", propagate: true };
  }
  if (title.includes("予算実施計画") || preview.startsWith("予算実施計画") || joined.includes("会計予算実施計画")) {
    return { label: "予算実施計画", propagate: true };
  }
  if (joined.includes("キャッシュフロー") || joined.includes("キャッシュ・フロー")) {
    return { label: "キャッシュフロー", propagate: true };
  }
  if (joined.includes("貸借対照表")) return { label: "貸借対照表", propagate: true };
  if (joined.includes("損益計算書")) return { label: "損益計算書", propagate: true };
  if (joined.includes("注記表")) return { label: "注記表", propagate: true };
  if (title.includes("総括") || title === "1総括" || preview.startsWith("1総括")) {
    return { label: "総括", propagate: true };
  }
  if (title.startsWith("2歳入") || joined.startsWith("2歳入") || title === "歳入") {
    return { label: "歳入", propagate: true };
  }
  if (title.startsWith("歳入") || preview.startsWith("歳入")) {
    return { label: "歳入", propagate: true };
  }
  if (title.startsWith("3歳出") || joined.startsWith("3歳出") || title === "歳出") {
    const expense = includesAny(joined, expenseLabels);
    return { label: expense ?? "歳出", propagate: true };
  }
  if (title.startsWith("歳出") || preview.startsWith("歳出")) {
    const expense = includesAny(joined, expenseLabels);
    return { label: expense ?? "歳出", propagate: true };
  }

  for (const label of revenueLabels) {
    const normalized = compact(label);
    if (
      new RegExp(`^\\d+款${normalized}`).test(title) ||
      new RegExp(`^\\d+[.．]?${normalized}`).test(title)
    ) {
      return { label: "歳入", propagate: true };
    }
  }

  for (const label of expenseLabels) {
    const normalized = compact(label);
    if (
      new RegExp(`款）\\d+${normalized}`).test(joined) ||
      new RegExp(`^（款）\\d+${normalized}`).test(title) ||
      new RegExp(`^\\d+款${normalized}`).test(title) ||
      new RegExp(`^\\d+[.．]?${normalized}`).test(title) ||
      title.startsWith(normalized)
    ) {
      return { label, propagate: true };
    }
  }

  if (account && joined.includes("歳入歳出予算")) {
    return { label: account, propagate: true };
  }

  if (manifest.pages.indexOf(page) === 0) return { label: "表紙", propagate: false };
  return null;
}

let currentLabel = defaultLabel;
const sections = [];

for (const page of manifest.pages) {
  const detected = detectLabel(page);
  if (detected) {
    page.toc_label = detected.label;
    if (detected.propagate) currentLabel = detected.label;
  } else {
    page.toc_label = currentLabel;
  }
  page.toc_printed_page_start = null;

  const last = sections.at(-1);
  if (last?.label === page.toc_label && last.page_end === page.page - 1) {
    last.page_end = page.page;
  } else {
    sections.push({ label: page.toc_label, page_start: page.page, page_end: page.page });
  }
}

manifest.toc_sections_source = sourceLabel ?? `${manifest.title}のページ見出しから自動作成`;
manifest.toc_sections = sections;

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

const counts = {};
for (const page of manifest.pages) counts[page.toc_label] = (counts[page.toc_label] ?? 0) + 1;
console.log(`${city}: labeled ${manifest.pages.length} pages`);
console.log(JSON.stringify(counts, null, 2));
