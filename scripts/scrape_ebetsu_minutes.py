"""
江別市議会の HTML ベース議事録を取得する専用スクリプト。

構造:
  year index (例: /site/gijiroku1/130558.html) に各会議日のリンクが並ぶ
  各会議 detail (例: /site/gijiroku1/130408.html) は HTML 本文で議事録を掲載
    title: "令和6年第1回江別市議会臨時会会議録（第1号）令和6年1月26日"

使い方:
  python scripts/scrape_ebetsu_minutes.py
  python scripts/scrape_ebetsu_minutes.py --years 2024,2025
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import requests

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; gikai-map-hokkaido/1.0)"}
REQUEST_INTERVAL = 0.7

YEAR_INDEX_URLS = {
    2025: "https://www.city.ebetsu.hokkaido.jp/site/gijiroku1/144988.html",
    2024: "https://www.city.ebetsu.hokkaido.jp/site/gijiroku1/130558.html",
}

TITLE_RE = re.compile(
    r"令和(\d+)年第(\d+)回江別市議会(定例会|臨時会)会議録[^\n]*?"
)
DAY_RE = re.compile(r"令和(\d+)年(\d+)月(\d+)日")
TYPE_FLAGS = {"定例会": 10, "臨時会": 20}


def extract_body(html: str) -> str:
    h = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.I)
    h = re.sub(r"<style[\s\S]*?</style>", "", h, flags=re.I)
    h = re.sub(r"<nav[\s\S]*?</nav>", "", h, flags=re.I)
    h = re.sub(r"<header[\s\S]*?</header>", "", h, flags=re.I)
    h = re.sub(r"<footer[\s\S]*?</footer>", "", h, flags=re.I)
    h = re.sub(r"<br[^>]*>", "\n", h, flags=re.I)
    h = re.sub(r"</(p|div|tr|li|h[1-6])>", "\n", h, flags=re.I)
    h = re.sub(r"<[^>]+>", "", h)
    h = h.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
    h = re.sub(r"\n{3,}", "\n\n", h)
    h = re.sub(r"[ \t]+", " ", h)
    return h.strip()


def era_str(year: int) -> str:
    if year > 2018:
        return f"令和{year - 2018}年"
    return str(year)


def find_meeting_links(year_index_url: str) -> list[tuple[str, str]]:
    """year index ページから meeting detail URLs を抽出。"""
    r = requests.get(year_index_url, timeout=20, headers=HEADERS)
    r.encoding = r.apparent_encoding or "utf-8"
    results = []
    seen = set()
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>([^<]{1,100})</a>', r.text):
        href = m.group(1)
        text = m.group(2).strip()
        if re.search(r"令和\d+年\d+月\d+日", text):
            full = urljoin(year_index_url, href)
            if full not in seen:
                seen.add(full)
                results.append((text, full))
    return results


def scrape(years: list[int], force: bool = False):
    out_dir = DATA_DIR / "ebetsu" / "minutes"
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path = out_dir / "index.json"
    existing_index = {}
    if index_path.exists() and not force:
        try:
            for item in json.loads(index_path.read_text(encoding="utf-8")):
                existing_index[item["council_id"]] = item
        except Exception:
            pass

    # council_id -> {..., schedules: [...]}
    councils: dict[int, dict] = {}

    for year, year_url in YEAR_INDEX_URLS.items():
        if year not in years:
            continue
        print(f"[{year}] index: {year_url}", flush=True)
        meetings = find_meeting_links(year_url)
        print(f"  → {len(meetings)} 件の会議リンク", flush=True)

        for mtext, murl in meetings:
            time.sleep(REQUEST_INTERVAL)
            try:
                mr = requests.get(murl, timeout=20, headers=HEADERS)
                mr.encoding = mr.apparent_encoding or "utf-8"
            except Exception as e:
                print(f"    ✗ {mtext}: {e}", flush=True)
                continue

            title_m = re.search(r"<title>([^<]+)</title>", mr.text)
            title = title_m.group(1) if title_m else ""
            tm = TITLE_RE.search(title)
            if not tm:
                # ページが会議録ではない（目次等）はスキップ
                continue
            era_y = int(tm.group(1))
            seq = int(tm.group(2))
            ttype = tm.group(3)
            council_year = 2018 + era_y
            if council_year != year:
                # 年度index先で別年度リンクが混在してるケース skip
                continue

            council_id = council_year * 10000 + TYPE_FLAGS[ttype] * 100 + seq

            body = extract_body(mr.text)
            if len(body) < 500:
                # 目次のみ等はスキップ
                continue

            name = f"{era_str(council_year)}第{seq}回{ttype}"
            print(f"    ✓ {name} | {mtext} ({len(body)}文字)", flush=True)

            if council_id not in councils:
                councils[council_id] = {
                    "council_id": council_id,
                    "name": name,
                    "year": str(council_year),
                    "japanese_year": era_str(council_year),
                    "type_label": f"全会議 > 本会議 > {ttype}",
                    "schedules": [],
                }

            # schedule name = mtext (例: "令和6年1月22日")
            councils[council_id]["schedules"].append({
                "name": mtext,
                "url": murl,
                "text": body,
            })

    # ソート: schedules を日付順に
    date_re = re.compile(r"(\d+)月(\d+)日")
    for c in councils.values():
        c["schedules"].sort(key=lambda s: tuple(
            int(x) for x in (date_re.search(s["name"]).groups() if date_re.search(s["name"]) else (0, 0))
        ))
        # schedule_id を付与
        out_schedules = []
        for idx, s in enumerate(c["schedules"], 1):
            out_schedules.append({
                "schedule_id": idx,
                "name": s["name"],
                "page_no": idx,
                "minutes": [{
                    "minute_id": 1,
                    "title": s["name"],
                    "minute_type": "本会議",
                    "text": s["text"],
                    "source_url": s["url"],
                }],
            })
        c["schedules"] = out_schedules

    # 保存
    saved = 0
    for cid, c in councils.items():
        fp = out_dir / f"{cid}.json"
        fp.write_text(json.dumps(c, ensure_ascii=False, indent=2), encoding="utf-8")
        existing_index[cid] = {
            "council_id": cid,
            "name": c["name"],
            "year": c["year"],
            "japanese_year": c["japanese_year"],
            "type_label": c["type_label"],
            "file": f"{cid}.json",
            "schedule_count": len(c["schedules"]),
        }
        saved += 1

    index_list = sorted(
        existing_index.values(),
        key=lambda x: (x["year"], x["council_id"]),
        reverse=True,
    )
    index_path.write_text(json.dumps(index_list, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ 完了: {saved}件取得 / 全{len(index_list)}件 → {out_dir}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="2024,2025")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    years = [int(y) for y in args.years.split(",") if y.strip()]
    scrape(years, args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
