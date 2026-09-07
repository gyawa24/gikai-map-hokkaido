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

if __package__:
    from scraper.lib.dnp_minutes import (
        council_index_entry, load_council_index, ordered_council_index,
        validate_council_content, write_json_atomic,
    )
else:
    from lib.dnp_minutes import (
        council_index_entry, load_council_index, ordered_council_index,
        validate_council_content, write_json_atomic,
    )

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
        raise ValueError("本文フレームの HUID が見つかりません")
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

    index_path = out_dir / "index.json"
    index_map = load_council_index(index_path)
    index_changed = False

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

    saved = 0
    failures = []
    for cid, c in councils.items():
        council_file = out_dir / f"{cid}.json"
        try:
            existing = None
            if council_file.exists():
                existing = json.loads(council_file.read_text(encoding="utf-8"))
                if existing.get("council_id") != cid or not isinstance(existing.get("schedules"), list):
                    raise ValueError("既存会議の ID または schedules が不正です")

            existing_schedules = existing["schedules"] if existing else []
            schedule_ids = [schedule.get("schedule_id") for schedule in existing_schedules]
            if any(not isinstance(sid, int) or isinstance(sid, bool) or sid < 1 for sid in schedule_ids) or len(set(schedule_ids)) != len(schedule_ids):
                raise ValueError("既存日程 ID が不正または重複しています")
            next_schedule_id = max(schedule_ids, default=0) + 1
            output_schedules = []
            matched_ids = set()
            seen_finos = set()
            for meeting in sorted(c["schedules"], key=lambda item: item["fino"]):
                if meeting["fino"] in seen_finos:
                    raise ValueError(f"日程 FINO={meeting['fino']} が重複しています")
                seen_finos.add(meeting["fino"])
                # 既存の連番 ID を維持し、FINO 未記録の旧データは一意な日程名で照合する。
                matches = [schedule for schedule in existing_schedules if (
                    schedule.get("source_fino") == meeting["fino"]
                    or (schedule.get("source_fino") is None and schedule.get("name") == meeting["schedule_name"])
                )]
                if len(matches) > 1:
                    raise ValueError(f"既存日程を一意に照合できません: {meeting['schedule_name']}")
                previous = matches[0] if matches else None
                if previous and previous["schedule_id"] in matched_ids:
                    raise ValueError(f"同じ既存日程に複数の FINO が対応しています: {meeting['fino']}")
                if previous:
                    matched_ids.add(previous["schedule_id"])
                    schedule_id = previous["schedule_id"]
                else:
                    schedule_id = next_schedule_id
                    next_schedule_id += 1
                has_body = previous and isinstance(previous.get("minutes"), list) and any(
                    isinstance(minute, dict) and str(minute.get("text", "")).strip()
                    for minute in previous["minutes"]
                )
                if has_body and not force:
                    output_schedules.append(previous)
                    continue

                text = fetch_body_text(slug, meeting, meeting["year"])
                if not isinstance(text, str) or not text.strip():
                    raise ValueError(f"日程 FINO={meeting['fino']} の本文が空です")
                output_schedules.append({
                    **(previous or {}),
                    "schedule_id": schedule_id,
                    "source_fino": meeting["fino"],
                    "name": meeting["schedule_name"],
                    "page_no": previous.get("page_no", schedule_id) if previous else schedule_id,
                    "minutes": [{
                        "minute_id": 1,
                        "title": meeting["schedule_name"],
                        "minute_type": "本会議",
                        "text": text,
                    }],
                })
                time.sleep(REQUEST_INTERVAL)

            if len(matched_ids) != len(existing_schedules):
                raise ValueError("再発見できない既存日程があります。既存本文を保持します")
            council_data = {
                **(existing or {}),
                **{key: value for key, value in c.items() if key != "schedules"},
                "schedules": output_schedules,
            }
            validate_council_content(council_data, source=f"{slug}/{cid}")
            if council_data != existing:
                write_json_atomic(council_file, council_data)
                saved += 1
            key = str(cid)
            entry = council_index_entry(
                council_data, previous=index_map.get(key), schedule_count=len(output_schedules),
            )
            if entry != index_map.get(key):
                index_map[key] = entry
                index_changed = True
        except Exception as error:
            failures.append((cid, str(error)))
            print(f"    取得失敗 {cid}、既存本文・indexを保持: {error}", flush=True)

    if index_changed:
        write_json_atomic(index_path, ordered_council_index(index_map))
    print(f"  完了: {saved}件保存 / 全{len(index_map)}件 → {out_dir}", flush=True)
    if failures:
        failed_ids = ", ".join(str(cid) for cid, _ in failures)
        raise RuntimeError(f"[{slug}] {len(failures)} council(s) failed: {failed_ids}")
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
    failures = []
    for slug in args.slug:
        print(f"=== {slug} (years={years}) ===", flush=True)
        try:
            scrape_one(slug, years, args.force)
        except Exception as e:
            failures.append(slug)
            print(f"  ✗ エラー: {e}", flush=True)
            import traceback; traceback.print_exc()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
