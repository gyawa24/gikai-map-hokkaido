"""
自前ホスト型PDF議事録スクレイパー（汎用）

対象: 議会サイト内にPDFを直接貼っているタイプの自治体
    （DNP/gijiroku.comのような検索システムを持たないケース）

使い方:
  python scraper/scrape_minutes_pdf.py --slug naie
  python scraper/scrape_minutes_pdf.py --slug naie --years 2024,2025
  python scraper/scrape_minutes_pdf.py --slug naie --force

出力: data/{slug}/minutes/index.json, {council_id}.json
    （DNP/gijirokuスクレイパーと同一スキーマ）

実装ノート:
  - 自治体ごとに HTML 構造が異なるので、PDF_CONFIGS に抽出ルールを登録する
  - PDFテキスト抽出は pdfplumber を利用（OCRは非対応）
  - council_id は {year}{type_flag}{回数2桁} 形式で合成
      10 = 定例会, 20 = 臨時会
      例: 令和7年第1回定例会 → 2025_10_01 → 20251001
"""

import argparse
import io
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import pdfplumber
import requests

ROOT = Path(__file__).parent.parent
MUNICIPALITIES_FILE = ROOT / "data" / "municipalities.json"
DATA_DIR = ROOT / "data"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; gikai-map-hokkaido/1.0)"}
REQUEST_INTERVAL = 1.0
DEFAULT_YEARS = ["2024", "2025"]


# ---------------------------------------------------------------------------
# 自治体別設定
# ---------------------------------------------------------------------------
# 同じ「PDF自前ホスト」でも構造は自治体ごとに違うので、ここに足していく。
# 共通化は3自治体以上で繰り返したら検討。
PDF_CONFIGS: dict[str, dict] = {
    "naie": {
        "name": "奈井江町",
        "index_url": "https://www.town.naie.hokkaido.jp/gikai/g_kaigiroku/",
        # <h3>定例会</h3> / <h3>臨時会</h3> で種別セクション切替
        # <h4>令和7年</h4> で年度セクション切替
        # 同じセクション内の連続した <a href=".pdf">会議録 第N回</a> を拾う
        "type_tag": "h3",
        "year_tag": "h4",
    },
}

TYPE_FLAGS = {
    "定例会": 10,
    "臨時会": 20,
}
JP_ERA = [
    ("令和", 2018),  # 令和元年 = 2019
    ("平成", 1988),
    ("昭和", 1925),
]


def japanese_year_to_int(s: str) -> int | None:
    m = re.search(r"(令和|平成|昭和)\s*(\d+|元)", s)
    if not m:
        return None
    era, n = m.group(1), m.group(2)
    n_int = 1 if n == "元" else int(n)
    for era_name, base in JP_ERA:
        if era == era_name:
            return base + n_int
    return None


def era_str(year: int) -> str:
    for era_name, base in JP_ERA:
        if year > base:
            return f"{era_name}{year - base}年"
    return str(year)


# ---------------------------------------------------------------------------
# HTML走査（正規表現ベース、dep減らすためBeautifulSoup未使用）
# ---------------------------------------------------------------------------
TAG_RE = re.compile(
    r"<(?P<tag>h[1-6]|a)(?P<attrs>[^>]*)>(?P<text>[\s\S]*?)</(?P=tag)>",
    re.I,
)
HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)


def extract_pdf_links(
    index_url: str, type_tag: str, year_tag: str
) -> list[dict]:
    r = requests.get(index_url, timeout=30, headers=HEADERS)
    r.raise_for_status()
    html = r.text

    current_type = None  # 定例会 / 臨時会
    current_year = None  # int (西暦)
    records: list[dict] = []

    for m in TAG_RE.finditer(html):
        tag = m.group("tag").lower()
        text = re.sub(r"<[^>]+>", "", m.group("text")).strip()
        attrs = m.group("attrs")

        if tag == type_tag.lower():
            for ttype in ("定例会", "臨時会"):
                if ttype in text:
                    current_type = ttype
                    break
            continue

        if tag == year_tag.lower():
            y = japanese_year_to_int(text)
            if y:
                current_year = y
            continue

        if tag == "a" and current_type and current_year:
            href_m = HREF_RE.search(attrs)
            if not href_m:
                continue
            href = href_m.group(1)
            if ".pdf" not in href.lower():
                continue
            full_url = urljoin(index_url, href)

            # リンクテキストから回数推定（「第N回」）
            seq_m = re.search(r"第\s*([０-９0-9]+)\s*回", text)
            seq = None
            if seq_m:
                s = seq_m.group(1)
                # 全角→半角
                s = s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
                try:
                    seq = int(s)
                except ValueError:
                    seq = None
            records.append({
                "type": current_type,
                "year": current_year,
                "seq": seq,
                "link_text": text,
                "url": full_url,
            })

    return records


# ---------------------------------------------------------------------------
# PDFテキスト抽出
# ---------------------------------------------------------------------------
def extract_pdf_text(url: str, max_pages: int = 500) -> str:
    r = requests.get(url, timeout=60, headers=HEADERS)
    r.raise_for_status()
    with pdfplumber.open(io.BytesIO(r.content)) as pdf:
        pages = pdf.pages[:max_pages]
        texts = []
        for p in pages:
            t = p.extract_text() or ""
            if t.strip():
                texts.append(t)
        return "\n\n".join(texts).strip()


# ---------------------------------------------------------------------------
# メイン処理
# ---------------------------------------------------------------------------
def scrape_one(slug: str, years: list[int], force: bool) -> int:
    cfg = PDF_CONFIGS.get(slug)
    if not cfg:
        print(f"  [{slug}] 設定未登録", flush=True)
        return 0

    print(f"  [{slug}] PDFリスト取得: {cfg['index_url']}", flush=True)
    records = extract_pdf_links(cfg["index_url"], cfg["type_tag"], cfg["year_tag"])
    print(f"    → {len(records)}件のPDFを検出", flush=True)

    # 対象年のみフィルタ
    target = [r for r in records if r["year"] in years]
    print(f"    → 対象年({years})のPDF: {len(target)}件", flush=True)

    out_dir = DATA_DIR / slug / "minutes"
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path = out_dir / "index.json"
    index_map: dict[int, dict] = {}
    if index_path.exists() and not force:
        try:
            existing = json.loads(index_path.read_text(encoding="utf-8"))
            index_map = {x["council_id"]: x for x in existing}
        except Exception:
            pass

    saved = 0
    for r in target:
        year = r["year"]
        type_flag = TYPE_FLAGS.get(r["type"], 90)
        seq = r["seq"] or 99
        council_id = year * 10000 + type_flag * 100 + seq

        council_file = out_dir / f"{council_id}.json"
        if council_file.exists() and not force:
            print(f"    [skip] {council_id} {r['link_text']} (既存)", flush=True)
            if council_id not in index_map:
                name = f"{era_str(year)}第{seq}回{r['type']}"
                index_map[council_id] = {
                    "council_id": council_id,
                    "name": name,
                    "year": str(year),
                    "japanese_year": era_str(year),
                    "type_label": f"全会議 > 本会議 > {r['type']}",
                    "file": f"{council_id}.json",
                    "schedule_count": 1,
                }
            continue

        name = f"{era_str(year)}第{seq}回{r['type']}"
        print(f"    [{council_id}] {name} 取得中...", flush=True)

        try:
            text = extract_pdf_text(r["url"])
            print(f"      ✓ {len(text)}文字 ({r['url'].rsplit('/', 1)[-1]})", flush=True)
        except Exception as e:
            print(f"      ✗ 失敗: {e}", flush=True)
            continue

        council_data = {
            "council_id": council_id,
            "name": name,
            "year": str(year),
            "japanese_year": era_str(year),
            "type_label": f"全会議 > 本会議 > {r['type']}",
            "schedules": [{
                "schedule_id": 1,
                "name": r["link_text"] or name,
                "page_no": 1,
                "minutes": [{
                    "minute_id": 1,
                    "title": r["link_text"] or name,
                    "minute_type": "本会議",
                    "text": text,
                    "source_url": r["url"],
                }],
            }],
        }
        council_file.write_text(
            json.dumps(council_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        index_map[council_id] = {
            "council_id": council_id,
            "name": name,
            "year": str(year),
            "japanese_year": era_str(year),
            "type_label": f"全会議 > 本会議 > {r['type']}",
            "file": f"{council_id}.json",
            "schedule_count": 1,
        }
        saved += 1
        time.sleep(REQUEST_INTERVAL)

    # index.json 保存
    index_list = sorted(
        index_map.values(),
        key=lambda x: (x["year"], x["council_id"]),
        reverse=True,
    )
    index_path.write_text(
        json.dumps(index_list, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  ✓ 完了: {saved}件取得 / 全{len(index_list)}件 → {out_dir}", flush=True)
    return saved


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", nargs="+", required=True)
    ap.add_argument("--years", default=",".join(DEFAULT_YEARS))
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    years = [int(y) for y in args.years.split(",") if y.strip()]
    for slug in args.slug:
        print(f"=== {slug} (years={years}) ===", flush=True)
        try:
            scrape_one(slug, years, args.force)
        except Exception as e:
            print(f"  ✗ エラー: {e}", flush=True)
            import traceback; traceback.print_exc()
    return 0


if __name__ == "__main__":
    sys.exit(main())
