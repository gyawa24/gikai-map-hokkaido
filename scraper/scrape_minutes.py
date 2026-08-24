"""
北海道市町村議会 汎用会議録スクレイパー（DNP Discussシステム対応）

使い方:
  # 単一自治体
  python scraper/scrape_minutes.py --slug hakodate

  # 複数自治体
  python scraper/scrape_minutes.py --slug hakodate asahikawa muroran

  # 全自治体（municipalities.json に登録済みのもの全部）
  python scraper/scrape_minutes.py --all

  # 年度指定（デフォルト: 実行年を含む直近6年）
  python scraper/scrape_minutes.py --slug hakodate --years 2023,2024,2025

オプション:
  --force   既存ファイルを上書き

出力:
  data/{slug}/minutes/index.json
  data/{slug}/minutes/{council_id}.json
"""

import argparse
import json
import re
import sys
import time
from datetime import date
from pathlib import Path

import requests

if __package__:
    from scraper.lib.dnp_minutes import (
        council_file_schedule_count,
        council_groups_from_response,
        council_index_entry,
        load_council_index,
        ordered_council_index,
        resolve_council_year,
        sync_existing_council_year,
        validate_council_content,
        write_json_atomic,
    )
else:
    from lib.dnp_minutes import (
        council_file_schedule_count,
        council_groups_from_response,
        council_index_entry,
        load_council_index,
        ordered_council_index,
        resolve_council_year,
        sync_existing_council_year,
        validate_council_content,
        write_json_atomic,
    )

# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------
ROOT = Path(__file__).parent.parent
MUNICIPALITIES_FILE = ROOT / "data" / "municipalities.json"
API_BASE = "https://ssp.kaigiroku.net/dnp/search"
REQUEST_INTERVAL = 1.5

TARGET_KEYWORDS = [
    "定例会", "臨時会",
    "予算特別委員会", "予算審査特別委員会",
    "決算特別委員会", "決算審査特別委員会",
    "補正予算",
]

def default_target_years() -> set[str]:
    current_year = date.today().year
    return {str(year) for year in range(current_year - 5, current_year + 1)}


DEFAULT_YEARS = default_target_years()

HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; gikai-map-hokkaido/1.0)",
}


# ---------------------------------------------------------------------------
# テナント情報取得
# ---------------------------------------------------------------------------
def load_municipalities() -> dict[str, dict]:
    """municipalities.json を読み込んでslug->情報のdictを返す。"""
    with open(MUNICIPALITIES_FILE, encoding="utf-8") as f:
        data = json.load(f)
    return {m["slug"]: m for m in data}


def fetch_tenant_id(slug: str) -> int | None:
    """tenant.js からtenant_idを取得する。"""
    url = f"https://ssp.kaigiroku.net/tenant/{slug}/js/tenant.js"
    try:
        r = requests.get(url, headers={"User-Agent": HEADERS["User-Agent"]}, timeout=10)
        r.raise_for_status()
        m = re.search(r"tenant_id\s*=\s*(\d+)", r.text)
        return int(m.group(1)) if m else None
    except Exception as e:
        print(f"  tenant_id取得失敗 ({slug}): {e}")
        return None


# ---------------------------------------------------------------------------
# API呼び出し
# ---------------------------------------------------------------------------
def post(endpoint: str, payload: dict, retries: int = 5) -> dict:
    url = f"{API_BASE}/{endpoint}"
    for attempt in range(retries):
        try:
            r = requests.post(url, json=payload, headers=HEADERS, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt < retries - 1:
                wait = REQUEST_INTERVAL * (2 ** attempt)
                print(f"    リトライ {attempt+1}/{retries-1} ({wait:.0f}秒待機): {e}")
                time.sleep(wait)
            else:
                raise


# ---------------------------------------------------------------------------
# 会議種別フィルター
# ---------------------------------------------------------------------------
def is_target_council(council_type: dict) -> bool:
    names = " ".join(
        council_type.get(f"council_type_name{i}") or "" for i in range(1, 6)
    )
    if council_type.get("council_type_name1") == "資料":
        return False
    return any(kw in names for kw in TARGET_KEYWORDS)


# ---------------------------------------------------------------------------
# テキスト整形
# ---------------------------------------------------------------------------
def clean_text(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    lines = [ln.rstrip() for ln in text.splitlines()]
    cleaned: list[str] = []
    prev_empty = False
    for ln in lines:
        if ln == "":
            if not prev_empty:
                cleaned.append("")
            prev_empty = True
        else:
            cleaned.append(ln)
            prev_empty = False
    return "\n".join(cleaned).strip()


# ---------------------------------------------------------------------------
# スクレイピング本体
# ---------------------------------------------------------------------------
def fetch_councils(
    tenant_id: int,
    target_years: set[str],
    *,
    allow_empty: bool = False,
) -> list[dict]:
    data = post("councils/index", {"tenant_id": tenant_id})
    time.sleep(REQUEST_INTERVAL)

    targets = []
    for item in council_groups_from_response(data, allow_empty=allow_empty):
        for view_year in item.get("view_years", []):
            fallback_year = view_year.get("view_year", "")
            fallback_japanese_year = view_year.get("japanese_year", "")
            for ct in view_year.get("council_type", []):
                if not is_target_council(ct):
                    continue
                type_label = " > ".join(
                    ct.get(f"council_type_name{i}") or ""
                    for i in range(1, 5)
                    if ct.get(f"council_type_name{i}")
                )
                for council in ct.get("councils", []):
                    name = council["name"].replace("\u3000", " ").strip()
                    year, japanese_year = resolve_council_year(
                        name,
                        fallback_year,
                        fallback_japanese_year,
                    )
                    if year not in target_years:
                        continue
                    targets.append({
                        "council_id": council["council_id"],
                        "name": name,
                        "year": year,
                        "japanese_year": japanese_year,
                        "type_label": type_label,
                    })
    return targets


def fetch_schedules(tenant_id: int, council_id: int) -> list[dict]:
    data = post("minutes/get_schedule", {"tenant_id": tenant_id, "council_id": council_id})
    time.sleep(REQUEST_INTERVAL)
    return [
        {"schedule_id": s["schedule_id"], "name": s.get("name", ""), "page_no": s.get("page_no")}
        for s in data.get("council_schedules", [])
    ]


def fetch_minutes(tenant_id: int, council_id: int, schedule_id: int) -> list[dict]:
    data = post(
        "minutes/get_minute",
        {"tenant_id": tenant_id, "council_id": council_id, "schedule_id": schedule_id},
    )
    time.sleep(REQUEST_INTERVAL)
    return [
        {
            "minute_id": m.get("minute_id"),
            "title": m.get("title", ""),
            "minute_type": m.get("minute_type", ""),
            "text": clean_text(m.get("body", "")),
        }
        for m in data.get("tenant_minutes", [])
    ]


def scrape_city(
    slug: str,
    tenant_id: int,
    target_years: set[str],
    force: bool = False,
    *,
    allow_empty: bool = False,
) -> None:
    output_dir = ROOT / "data" / slug / "minutes"
    output_dir.mkdir(parents=True, exist_ok=True)
    index_path = output_dir / "index.json"
    index_existed_before = index_path.exists()
    index_by_id = load_council_index(index_path)

    print(f"\n[{slug}] 会議一覧取得中...")
    councils = fetch_councils(tenant_id, target_years, allow_empty=allow_empty)
    print(f"  対象: {len(councils)}件")

    failures = []
    for i, c in enumerate(councils):
        cid = c["council_id"]
        council_key = str(cid)
        out_path = output_dir / f"{cid}.json"

        if out_path.exists() and not force:
            try:
                schedule_count = council_file_schedule_count(out_path)
                metadata_updated = sync_existing_council_year(
                    out_path,
                    c["year"],
                    c["japanese_year"],
                )
            except Exception as exc:
                print(f"  [{i+1}/{len(councils)}] 既存会議の確認失敗、indexを保持: {c['name']} ({exc})")
                failures.append((cid, str(exc)))
                continue
            suffix = " / 年メタデータ更新" if metadata_updated else ""
            print(f"  [{i+1}/{len(councils)}] スキップ: {c['name']}{suffix}")
            index_by_id[council_key] = council_index_entry(
                c,
                previous=index_by_id.get(council_key),
                schedule_count=schedule_count,
            )
            continue

        print(f"  [{i+1}/{len(councils)}] 取得: {c['name']}")
        try:
            schedules = fetch_schedules(tenant_id, cid)
            print(f"    → {len(schedules)}日程")

            result_schedules = []
            for j, s in enumerate(schedules):
                print(f"    {s['name']} ({j+1}/{len(schedules)})")
                minutes = fetch_minutes(tenant_id, cid, s["schedule_id"])
                result_schedules.append({**s, "minutes": minutes})
            council_data = {**c, "schedules": result_schedules}
            validate_council_content(council_data, source=f"council_id={cid}")
        except Exception as exc:
            print(f"    取得失敗、既存本文・indexを保持: {exc}")
            failures.append((cid, str(exc)))
            continue

        write_json_atomic(out_path, council_data)

        index_by_id[council_key] = council_index_entry(
            c,
            previous=index_by_id.get(council_key),
            schedule_count=len(schedules),
        )

    index = ordered_council_index(index_by_id)
    if index or index_existed_before:
        write_json_atomic(index_path, index)
    else:
        print("  ! 取得成功した会議がないためindexは作成しません")
    print(f"  ✓ 完了: {len(index)}件保存 → {output_dir}")
    if failures:
        failed_ids = ", ".join(str(council_id) for council_id, _ in failures)
        raise RuntimeError(f"[{slug}] {len(failures)} council(s) failed: {failed_ids}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="北海道議会 汎用スクレイパー")
    parser.add_argument("--slug", nargs="+", help="対象自治体スラッグ（複数可）")
    parser.add_argument("--all", action="store_true", help="municipalities.jsonの全自治体を処理")
    parser.add_argument("--years", default=",".join(sorted(DEFAULT_YEARS)), help="対象年度（カンマ区切り）")
    parser.add_argument("--force", action="store_true", help="既存ファイルを上書き")
    parser.add_argument(
        "--allow-empty",
        action="store_true",
        help="DNPが空の会議一覧を返してもエラーにしない（通常は指定しない）",
    )
    args = parser.parse_args()

    target_years = set(args.years.split(","))
    municipalities = load_municipalities()

    failures = []
    if args.all:
        targets = list(municipalities.values())
    elif args.slug:
        targets = []
        for slug in args.slug:
            if slug not in municipalities:
                # municipalities.jsonにない場合はtenant.jsから動的取得
                print(f"  {slug}: municipalities.jsonに未登録、tenant_idを取得中...")
                tid = fetch_tenant_id(slug)
                if not tid:
                    print(f"  {slug}: 取得失敗、スキップ")
                    failures.append((slug, "tenant_idを取得できません"))
                    continue
                targets.append({"slug": slug, "name": slug, "tenant_id": tid})
            else:
                targets.append(municipalities[slug])
    else:
        parser.print_help()
        sys.exit(1)

    print(f"対象: {len(targets)}自治体 / 年度: {sorted(target_years)}")
    for m in targets:
        try:
            scrape_city(
                m["slug"],
                m["tenant_id"],
                target_years,
                force=args.force,
                allow_empty=args.allow_empty,
            )
        except Exception as exc:
            failures.append((m["slug"], str(exc)))
            print(f"  {m['slug']}: 更新失敗: {exc}")

    if failures:
        print("\n失敗した自治体:")
        for slug, error in failures:
            print(f"  - {slug}: {error}")
        return 1

    print("\n全完了")
    return 0


if __name__ == "__main__":
    sys.exit(main())
