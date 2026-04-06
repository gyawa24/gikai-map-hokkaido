"""
恵庭市議会 会議録スクレイパー
対象: https://ssp.kaigiroku.net/tenant/eniwa/MinuteBrowse.html (DNP Discuss システム)
tenant_id: 89
対象会議: 本会議定例会 R6〜R7, 予算審査特別委員会, 決算審査特別委員会
出力: data/eniwa/minutes/index.json および data/eniwa/minutes/{council_id}.json
"""

import json
import os
import time
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------
API_BASE = "https://ssp.kaigiroku.net/dnp/search"
TENANT_ID = 89
REQUEST_INTERVAL = 2  # 秒 (アクセス間隔)
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "eniwa" / "minutes"

# 対象会議種別 (council_type_name1〜4 のいずれかにマッチ、「資料」は除外)
TARGET_KEYWORDS = [
    "定例会",
    "特別委員会",  # 予算審査特別委員会・決算審査特別委員会をまとめてカバー
]

# 対象年度 (view_year)
TARGET_YEARS = {"2024", "2025"}  # 令和6年・令和7年

HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; gikai-map-hokkaido/1.0)",
}


# ---------------------------------------------------------------------------
# ヘルパー
# ---------------------------------------------------------------------------
def post(endpoint: str, payload: dict, retries: int = 5) -> dict:
    url = f"{API_BASE}/{endpoint}"
    for attempt in range(retries):
        try:
            resp = requests.post(url, json=payload, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            if attempt < retries - 1:
                wait = REQUEST_INTERVAL * (2 ** attempt)  # 指数バックオフ
                print(f"    ⚠ エラー ({e.__class__.__name__}), {wait}秒後にリトライ...")
                time.sleep(wait)
            else:
                raise


def is_target_council(council_type: dict) -> bool:
    names = [
        council_type.get("council_type_name1") or "",
        council_type.get("council_type_name2") or "",
        council_type.get("council_type_name3") or "",
        council_type.get("council_type_name4") or "",
        council_type.get("council_type_name5") or "",
    ]
    if names[0] == "資料":
        return False
    combined = " ".join(names)
    return any(kw in combined for kw in TARGET_KEYWORDS)


def clean_text(text: str) -> str:
    import re
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
def fetch_councils() -> list[dict]:
    print("会議一覧を取得中...")
    data = post("councils/index", {"tenant_id": TENANT_ID})
    time.sleep(REQUEST_INTERVAL)

    targets: list[dict] = []
    for item in data.get("councils", []):
        for view_year in item.get("view_years", []):
            year = view_year.get("view_year", "")
            if year not in TARGET_YEARS:
                continue
            japanese_year = view_year.get("japanese_year", "")
            for ct in view_year.get("council_type", []):
                if not is_target_council(ct):
                    continue
                type_names = [
                    ct.get("council_type_name1") or "",
                    ct.get("council_type_name2") or "",
                    ct.get("council_type_name3") or "",
                    ct.get("council_type_name4") or "",
                ]
                type_label = " > ".join(n for n in type_names if n)
                for council in ct.get("councils", []):
                    targets.append({
                        "council_id": council["council_id"],
                        "name": council["name"].replace("\u3000", " ").strip(),
                        "year": year,
                        "japanese_year": japanese_year,
                        "type_label": type_label,
                    })
    return targets


def fetch_schedules(council_id: int) -> list[dict]:
    data = post("minutes/get_schedule", {"tenant_id": TENANT_ID, "council_id": council_id})
    time.sleep(REQUEST_INTERVAL)
    return [
        {
            "schedule_id": s["schedule_id"],
            "name": s.get("name", ""),
            "page_no": s.get("page_no"),
        }
        for s in data.get("council_schedules", [])
    ]


def fetch_minutes(council_id: int, schedule_id: int) -> list[dict]:
    data = post(
        "minutes/get_minute",
        {"tenant_id": TENANT_ID, "council_id": council_id, "schedule_id": schedule_id},
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


def scrape_council(council_info: dict) -> dict:
    council_id = council_info["council_id"]
    print(f"  スケジュール取得: {council_info['name']} (id={council_id})")
    schedules = fetch_schedules(council_id)
    print(f"    → {len(schedules)} 日程")

    result_schedules = []
    for i, sched in enumerate(schedules):
        print(f"    議事録取得: {sched['name']} ({i+1}/{len(schedules)})")
        minutes = fetch_minutes(council_id, sched["schedule_id"])
        result_schedules.append({
            "schedule_id": sched["schedule_id"],
            "name": sched["name"],
            "page_no": sched["page_no"],
            "minutes": minutes,
        })

    return {**council_info, "schedules": result_schedules}


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    councils = fetch_councils()
    print(f"\n対象会議: {len(councils)} 件\n")
    for c in councils:
        print(f"  [{c['year']}] {c['name']} (id={c['council_id']})")

    index: list[dict] = []

    for i, council_info in enumerate(councils):
        council_id = council_info["council_id"]
        output_path = OUTPUT_DIR / f"{council_id}.json"

        if output_path.exists():
            print(f"\n[{i+1}/{len(councils)}] スキップ (既存): {council_info['name']}")
            index.append({
                "council_id": council_id,
                "name": council_info["name"],
                "year": council_info["year"],
                "japanese_year": council_info["japanese_year"],
                "type_label": council_info["type_label"],
                "file": f"{council_id}.json",
            })
            continue

        print(f"\n[{i+1}/{len(councils)}] 取得中: {council_info['name']}")
        council_data = scrape_council(council_info)

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(council_data, f, ensure_ascii=False, indent=2)
        print(f"    保存: {output_path}")

        index.append({
            "council_id": council_id,
            "name": council_info["name"],
            "year": council_info["year"],
            "japanese_year": council_info["japanese_year"],
            "type_label": council_info["type_label"],
            "file": f"{council_id}.json",
            "schedule_count": len(council_data["schedules"]),
        })

    index_path = OUTPUT_DIR / "index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f"\nインデックス保存: {index_path}")
    print(f"完了: {len(councils)} 件の会議を処理しました。")


if __name__ == "__main__":
    main()
