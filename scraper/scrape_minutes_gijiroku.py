"""
gijiroku.com（会議録センター「Discuss」系）対応 汎用会議録スクレイパー

対象: {slug}.gijiroku.com/voices/ のシステムを使っている自治体
    例: sapporo / fukagawa

使い方:
  python scraper/scrape_minutes_gijiroku.py --slug sapporo
  python scraper/scrape_minutes_gijiroku.py --slug sapporo fukagawa
  python scraper/scrape_minutes_gijiroku.py --slug sapporo --years 2023,2024,2025
  python scraper/scrape_minutes_gijiroku.py --slug sapporo --force

出力: data/{slug}/minutes/index.json, {council_id}.json
（DNPスクレイパーと同一スキーマ）

実装ノート:
  - URLパターン: https://{slug}.gijiroku.com/voices/
  - 会議一覧: cgi/voiweb.exe?ACT=100&KTYP=0,1,2,3&SORT=0&FYY={y}&TYY={y}&KGTP=1  (本会議)
  - 個別会議本文: cgi/voiweb.exe?ACT=203&...&FINO={fino}&HUID={huid}
  - エンコーディング: Shift_JIS
  - 会議グルーピング: KGNO = council_id, FINO = schedule_id
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlencode

import requests

ROOT = Path(__file__).parent.parent
MUNICIPALITIES_FILE = ROOT / "data" / "municipalities.json"
DATA_DIR = ROOT / "data"
REQUEST_INTERVAL = 1.5

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; gikai-map-hokkaido/1.0)"}
DEFAULT_YEARS = ["2024", "2025"]
_MUNIS: dict = {}


def load_municipalities() -> dict[str, dict]:
    with open(MUNICIPALITIES_FILE, encoding="utf-8") as f:
        data = json.load(f)
    return {m["slug"]: m for m in data}


def base_url(slug: str, municipalities: dict | None = None) -> str:
    """通常は {slug}.gijiroku.com だが、municipalities.json に
    gijiroku_subdomain が設定されていればそれを優先する。
    （例: 北海道議会 → pref-hokkaido.gijiroku.com）"""
    if municipalities and slug in municipalities:
        sub = municipalities[slug].get("gijiroku_subdomain")
        if sub:
            return f"https://{sub}.gijiroku.com/voices/"
    return f"https://{slug}.gijiroku.com/voices/"


def get_shiftjis(url: str, retries: int = 3) -> str:
    last = None
    for i in range(retries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            r.raise_for_status()
            r.encoding = "shift_jis"
            return r.text
        except Exception as e:
            last = e
            time.sleep(2.0 * (i + 1))
    raise RuntimeError(f"fetch failed: {url} ({last})")


# ---------------------------------------------------------------------------
# 会議一覧の取得
# ---------------------------------------------------------------------------
def list_meetings_for_year(slug: str, year: int, kgtp: int) -> list[dict]:
    """指定年・会議種別(KGTP)の会議一覧を返す。

    KGTP=1: 本会議（定例会・臨時会含む）
    KGTP=2, 3...: 委員会系（必要に応じて拡張）
    """
    query = urlencode({
        "ACT": "100",
        "KTYP": "0,1,2,3",
        "SORT": "0",
        "FYY": str(year),
        "FMM": "",
        "FDD": "",
        "TYY": str(year),
        "TMM": "",
        "TDD": "",
        "KGTP": str(kgtp),
    })
    url = f"{base_url(slug, _MUNIS)}cgi/voiweb.exe?{query}"
    html = get_shiftjis(url)

    meetings = []
    # ACT=200のリンクから TITL_SUBT / KGNO / FINO / UNID を抽出
    # onClick="winopen('voiweb.exe?ACT=200&...&TITL_SUBT=...&KGNO=...&FINO=...&UNID=...')"
    pattern = re.compile(
        r"winopen\('voiweb\.exe\?([^']+)'\)[^>]*>([^<]+)</A>",
        re.I,
    )
    seen_fino = set()
    for m in pattern.finditer(html):
        params = dict(
            kv.split("=", 1) for kv in m.group(1).split("&") if "=" in kv
        )
        schedule_name = m.group(2).strip()
        fino = params.get("FINO")
        kgno = params.get("KGNO")
        unid = params.get("UNID")
        titl_subt_enc = params.get("TITL_SUBT", "")
        # TITL_SUBTはShift_JISでURLエンコードされている
        try:
            titl_subt = unquote(titl_subt_enc, encoding="shift_jis")
        except Exception:
            titl_subt = ""

        if not fino or not kgno or fino in seen_fino:
            continue
        seen_fino.add(fino)

        # 会議（council）タイトル: "令和 ７年第 ２回定例会" と schedule 部 "05月21日-01号" の分離
        # TITL_SUBT 例: "令和　７年第　２回定例会−05月21日-01号" (MS-IBMダッシュ)
        # 区切り: 全角長音 or ハイフン / 半角ハイフン
        council_title = titl_subt
        for sep in ["−", "―", "--"]:
            if sep in titl_subt:
                council_title = titl_subt.split(sep, 1)[0]
                break

        meetings.append({
            "kgno": int(kgno),
            "fino": int(fino),
            "unid": unid or "",
            "council_title": council_title.strip(),
            "schedule_name": schedule_name.strip(),
        })
    return meetings


# ---------------------------------------------------------------------------
# 本文取得
# ---------------------------------------------------------------------------
def fetch_body_text(slug: str, meeting: dict, year: int) -> str:
    """ACT=203 を取得してHTMLタグ除去したプレーンテキストを返す。"""
    # HUID が必要 — ACT=200 のフレーム定義から抽出する
    act200_url = (
        f"{base_url(slug, _MUNIS)}cgi/voiweb.exe?"
        f"ACT=200&KTYP=0,1,2,3&KGTP=1&FYY={year}&TYY={year}"
        f"&KGNO={meeting['kgno']}&FINO={meeting['fino']}&UNID={meeting['unid']}"
    )
    frameset_html = get_shiftjis(act200_url)
    time.sleep(0.3)

    m = re.search(r"HUID=(\d+)", frameset_html)
    if not m:
        return ""
    huid = m.group(1)

    act203_url = (
        f"{base_url(slug, _MUNIS)}cgi/voiweb.exe?"
        f"ACT=203&KTYP=0,1,2,3&KGTP=1&FYY={year}&TYY={year}"
        f"&FINO={meeting['fino']}&HATSUGENMODE=1&HYOUJIMODE=0&HUID={huid}&STYLE=0"
    )
    html = get_shiftjis(act203_url)

    # タグ除去してプレーンテキスト化
    text = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", "", text, flags=re.I)
    text = re.sub(r"<br[^>]*>", "\n", text, flags=re.I)
    text = re.sub(r"</(p|div|tr|li|h[1-6])>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    # HTMLエンティティ
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
    # 連続空白を整理
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = text.strip()
    return text


# ---------------------------------------------------------------------------
# 和暦変換
# ---------------------------------------------------------------------------
def japanese_era(year: int) -> str:
    if year >= 2019:
        return f"令和{year - 2018}年"
    if year >= 1989:
        return f"平成{year - 1988}年"
    if year >= 1926:
        return f"昭和{year - 1925}年"
    return str(year)


def type_label_from_title(title: str) -> str:
    if "臨時会" in title:
        return "全会議 > 本会議 > 臨時会"
    if "定例会" in title:
        return "全会議 > 本会議 > 定例会"
    if "委員会" in title:
        return "全会議 > 委員会"
    return "全会議 > 本会議"


# ---------------------------------------------------------------------------
# メイン処理
# ---------------------------------------------------------------------------
def scrape_one(slug: str, years: list[int], force: bool) -> int:
    out_dir = DATA_DIR / slug / "minutes"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 既存index.jsonを読み込んで差分追加できるように
    index_path = out_dir / "index.json"
    existing_index = []
    if index_path.exists() and not force:
        try:
            existing_index = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            existing_index = []

    # council_id -> item
    index_map: dict[int, dict] = {x["council_id"]: x for x in existing_index}

    # 年ごとに会議一覧を収集
    all_meetings: list[dict] = []
    for year in years:
        print(f"  [{slug}] {year} 年の会議一覧取得...", flush=True)
        # KGTP=1 (本会議) をまず取得。必要なら拡張可能。
        ms = list_meetings_for_year(slug, year, kgtp=1)
        print(f"    → {len(ms)}件", flush=True)
        for m in ms:
            m["year"] = year
        all_meetings.extend(ms)
        time.sleep(REQUEST_INTERVAL)

    # council (KGNO) でグループ化
    councils: dict[int, dict] = {}
    for m in all_meetings:
        cid = m["kgno"]
        if cid not in councils:
            councils[cid] = {
                "council_id": cid,
                "name": m["council_title"],
                "year": str(m["year"]),
                "japanese_year": japanese_era(m["year"]),
                "type_label": type_label_from_title(m["council_title"]),
                "schedules": [],
            }
        councils[cid]["schedules"].append(m)

    print(f"  [{slug}] 会議グループ {len(councils)}件", flush=True)

    # 各会議の本文を取得 & 保存
    saved = 0
    for cid, c in councils.items():
        council_file = out_dir / f"{cid}.json"
        if council_file.exists() and not force:
            # 既に取得済なら index のみ更新
            index_map[cid] = {
                "council_id": cid,
                "name": c["name"],
                "year": c["year"],
                "japanese_year": c["japanese_year"],
                "type_label": c["type_label"],
                "file": f"{cid}.json",
                "schedule_count": len(c["schedules"]),
            }
            print(f"    [skip] {cid} {c['name']} (既存)", flush=True)
            continue

        print(f"    [{cid}] {c['name']} 日程{len(c['schedules'])}件 取得...", flush=True)
        # schedule の日付順で昇順に並べる（FINO で近似）
        c["schedules"].sort(key=lambda s: s["fino"])
        output_schedules = []
        for idx, m in enumerate(c["schedules"], 1):
            text = ""
            try:
                text = fetch_body_text(slug, m, m["year"])
            except Exception as e:
                print(f"      取得失敗 FINO={m['fino']}: {e}", flush=True)
            output_schedules.append({
                "schedule_id": idx,
                "name": m["schedule_name"],
                "page_no": idx,
                "minutes": [{
                    "minute_id": 1,
                    "title": m["schedule_name"],
                    "minute_type": "本会議",
                    "text": text,
                }],
            })
            print(f"      ✓ {m['schedule_name']} ({len(text)}文字)", flush=True)
            time.sleep(REQUEST_INTERVAL)

        council_data = {
            "council_id": cid,
            "name": c["name"],
            "year": c["year"],
            "japanese_year": c["japanese_year"],
            "type_label": c["type_label"],
            "schedules": output_schedules,
        }
        council_file.write_text(
            json.dumps(council_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        index_map[cid] = {
            "council_id": cid,
            "name": c["name"],
            "year": c["year"],
            "japanese_year": c["japanese_year"],
            "type_label": c["type_label"],
            "file": f"{cid}.json",
            "schedule_count": len(c["schedules"]),
        }
        saved += 1

    # index.json を最新データで並べ替えて保存
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
    ap.add_argument("--slug", nargs="+", required=True, help="対象自治体slug")
    ap.add_argument("--years", default=",".join(DEFAULT_YEARS), help="対象年 カンマ区切り (例: 2023,2024,2025)")
    ap.add_argument("--force", action="store_true", help="既存ファイルを上書き")
    args = ap.parse_args()

    years = [int(y) for y in args.years.split(",") if y.strip()]
    global _MUNIS
    _MUNIS = load_municipalities()
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
