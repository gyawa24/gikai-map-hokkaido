"""
千歳市議会 会議録スクレイパー
対象: https://ssp.kaigiroku.net/tenant/chitose/MinuteBrowse.html (DNP Discuss システム)
対象会議: 本会議定例会 R6〜R7, 予算特別委員会, 決算特別委員会, 補正予算関連委員会
出力: data/chitose/minutes/index.json および data/chitose/minutes/{council_id}.json

注意: APIはテキストを直接返すため pdfplumber は不要。
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
TENANT_ID = 452
REQUEST_INTERVAL = 2  # 秒 (アクセス間隔)
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "chitose" / "minutes"

# 対象会議種別 (council_type_name2 または name1-4 のいずれかにマッチ)
TARGET_KEYWORDS = [
    "定例会",
    "予算特別委員会",
    "決算特別委員会",
    "補正予算",
    "常任委員会",   # 総務・経済建設・文教民生 etc.
    "臨時会",
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
def post(endpoint: str, payload: dict) -> dict:
    """POST してJSONを返す。"""
    url = f"{API_BASE}/{endpoint}"
    resp = requests.post(url, json=payload, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


def is_target_council(council_type: dict) -> bool:
    """会議種別が対象かどうかを判定する。"""
    names = [
        council_type.get("council_type_name1") or "",
        council_type.get("council_type_name2") or "",
        council_type.get("council_type_name3") or "",
        council_type.get("council_type_name4") or "",
        council_type.get("council_type_name5") or "",
    ]
    # 「資料」カテゴリは除外
    if names[0] == "資料":
        return False
    # 対象キーワードをいずれかのname階層に含むもの
    combined = " ".join(names)
    return any(kw in combined for kw in TARGET_KEYWORDS)


def clean_text(text: str) -> str:
    """<pre> タグや余分な空白を除去してプレーンテキストに変換する。"""
    import re
    text = re.sub(r"<[^>]+>", "", text)
    lines = [ln.rstrip() for ln in text.splitlines()]
    # 連続する空白行を1行にまとめる
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
    """対象となる会議一覧を取得する。"""
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
    """会議のスケジュール一覧を取得する。"""
    data = post("minutes/get_schedule", {"tenant_id": TENANT_ID, "council_id": council_id})
    time.sleep(REQUEST_INTERVAL)
    schedules = []
    for s in data.get("council_schedules", []):
        schedules.append({
            "schedule_id": s["schedule_id"],
            "name": s.get("name", ""),
            "page_no": s.get("page_no"),
        })
    return schedules


def fetch_minutes(council_id: int, schedule_id: int) -> list[dict]:
    """1日分の議事録テキストを取得する。"""
    data = post(
        "minutes/get_minute",
        {"tenant_id": TENANT_ID, "council_id": council_id, "schedule_id": schedule_id},
    )
    time.sleep(REQUEST_INTERVAL)
    minutes = []
    for m in data.get("tenant_minutes", []):
        body_raw = m.get("body", "")
        minutes.append({
            "minute_id": m.get("minute_id"),
            "title": m.get("title", ""),
            "minute_type": m.get("minute_type", ""),
            "text": clean_text(body_raw),
        })
    return minutes


def scrape_council(council_info: dict) -> dict:
    """1件の会議の全議事録を取得してまとめる。"""
    council_id = council_info["council_id"]
    print(f"  スケジュール取得: {council_info['name']} (id={council_id})")
    schedules = fetch_schedules(council_id)
    print(f"    → {len(schedules)} 日程")

    result_schedules = []
    for i, sched in enumerate(schedules):
        schedule_id = sched["schedule_id"]
        print(f"    議事録取得: {sched['name']} ({i+1}/{len(schedules)})")
        minutes = fetch_minutes(council_id, schedule_id)
        result_schedules.append({
            "schedule_id": schedule_id,
            "name": sched["name"],
            "page_no": sched["page_no"],
            "minutes": minutes,
        })

    return {
        **council_info,
        "schedules": result_schedules,
    }


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 対象会議一覧を取得
    councils = fetch_councils()
    print(f"\n対象会議: {len(councils)} 件\n")
    for c in councils:
        print(f"  [{c['year']}] {c['name']} (id={c['council_id']})")

    index: list[dict] = []

    for i, council_info in enumerate(councils):
        council_id = council_info["council_id"]
        output_path = OUTPUT_DIR / f"{council_id}.json"

        # 既存ファイルはスキップ
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

        # 個別ファイルに保存
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

    # インデックスファイルを保存
    index_path = OUTPUT_DIR / "index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f"\nインデックス保存: {index_path}")
    print(f"完了: {len(councils)} 件の会議を処理しました。")


if __name__ == "__main__":
    main()
