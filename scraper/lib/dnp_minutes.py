import json
import re
import time
from pathlib import Path

import requests

API_BASE = "https://ssp.kaigiroku.net/dnp/search"
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; gikai-map-hokkaido/1.0)",
}


def post(endpoint: str, payload: dict, request_interval: float, retries: int = 5) -> dict:
    url = f"{API_BASE}/{endpoint}"
    for attempt in range(retries):
        try:
            resp = requests.post(url, json=payload, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            if attempt < retries - 1:
                wait = request_interval * (2 ** attempt)
                print(f"    ⚠ エラー ({exc.__class__.__name__}), {wait}秒後にリトライ...")
                time.sleep(wait)
            else:
                raise


def is_target_council(council_type: dict, target_keywords: list[str]) -> bool:
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
    return any(keyword in combined for keyword in target_keywords)


def clean_text(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    lines = [line.rstrip() for line in text.splitlines()]
    cleaned: list[str] = []
    prev_empty = False
    for line in lines:
        if line == "":
            if not prev_empty:
                cleaned.append("")
            prev_empty = True
        else:
            cleaned.append(line)
            prev_empty = False
    return "\n".join(cleaned).strip()


def fetch_councils(
    tenant_id: int,
    target_years: set[str],
    target_keywords: list[str],
    request_interval: float,
) -> list[dict]:
    print("会議一覧を取得中...")
    data = post("councils/index", {"tenant_id": tenant_id}, request_interval=request_interval)
    time.sleep(request_interval)

    targets: list[dict] = []
    for item in data.get("councils", []):
        for view_year in item.get("view_years", []):
            year = view_year.get("view_year", "")
            if year not in target_years:
                continue
            japanese_year = view_year.get("japanese_year", "")
            for council_type in view_year.get("council_type", []):
                if not is_target_council(council_type, target_keywords):
                    continue
                type_names = [
                    council_type.get("council_type_name1") or "",
                    council_type.get("council_type_name2") or "",
                    council_type.get("council_type_name3") or "",
                    council_type.get("council_type_name4") or "",
                ]
                type_label = " > ".join(name for name in type_names if name)
                for council in council_type.get("councils", []):
                    targets.append(
                        {
                            "council_id": council["council_id"],
                            "name": council["name"].replace("\u3000", " ").strip(),
                            "year": year,
                            "japanese_year": japanese_year,
                            "type_label": type_label,
                        }
                    )
    return targets


def fetch_schedules(tenant_id: int, council_id: int, request_interval: float) -> list[dict]:
    data = post(
        "minutes/get_schedule",
        {"tenant_id": tenant_id, "council_id": council_id},
        request_interval=request_interval,
    )
    time.sleep(request_interval)
    return [
        {
            "schedule_id": schedule["schedule_id"],
            "name": schedule.get("name", ""),
            "page_no": schedule.get("page_no"),
        }
        for schedule in data.get("council_schedules", [])
    ]


def fetch_minutes(
    tenant_id: int,
    council_id: int,
    schedule_id: int,
    request_interval: float,
) -> list[dict]:
    data = post(
        "minutes/get_minute",
        {"tenant_id": tenant_id, "council_id": council_id, "schedule_id": schedule_id},
        request_interval=request_interval,
    )
    time.sleep(request_interval)
    return [
        {
            "minute_id": minute.get("minute_id"),
            "title": minute.get("title", ""),
            "minute_type": minute.get("minute_type", ""),
            "text": clean_text(minute.get("body", "")),
        }
        for minute in data.get("tenant_minutes", [])
    ]


def scrape_council(council_info: dict, tenant_id: int, request_interval: float) -> dict:
    council_id = council_info["council_id"]
    print(f"  スケジュール取得: {council_info['name']} (id={council_id})")
    schedules = fetch_schedules(tenant_id, council_id, request_interval=request_interval)
    print(f"    → {len(schedules)} 日程")

    result_schedules = []
    for index, schedule in enumerate(schedules):
        print(f"    議事録取得: {schedule['name']} ({index + 1}/{len(schedules)})")
        minutes = fetch_minutes(
            tenant_id,
            council_id,
            schedule["schedule_id"],
            request_interval=request_interval,
        )
        result_schedules.append(
            {
                "schedule_id": schedule["schedule_id"],
                "name": schedule["name"],
                "page_no": schedule["page_no"],
                "minutes": minutes,
            }
        )

    return {**council_info, "schedules": result_schedules}


def run_scrape(
    *,
    slug: str,
    tenant_id: int,
    output_dir: Path,
    target_keywords: list[str],
    target_years: set[str],
    request_interval: float,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    councils = fetch_councils(
        tenant_id=tenant_id,
        target_years=target_years,
        target_keywords=target_keywords,
        request_interval=request_interval,
    )
    print(f"\n対象会議: {len(councils)} 件\n")
    for council in councils:
        print(f"  [{council['year']}] {council['name']} (id={council['council_id']})")

    index: list[dict] = []

    for position, council_info in enumerate(councils):
        council_id = council_info["council_id"]
        output_path = output_dir / f"{council_id}.json"

        if output_path.exists():
            print(f"\n[{position + 1}/{len(councils)}] スキップ (既存): {council_info['name']}")
            index.append(
                {
                    "council_id": council_id,
                    "name": council_info["name"],
                    "year": council_info["year"],
                    "japanese_year": council_info["japanese_year"],
                    "type_label": council_info["type_label"],
                    "file": f"{council_id}.json",
                }
            )
            continue

        print(f"\n[{position + 1}/{len(councils)}] 取得中: {council_info['name']}")
        council_data = scrape_council(
            council_info,
            tenant_id=tenant_id,
            request_interval=request_interval,
        )

        with open(output_path, "w", encoding="utf-8") as handle:
            json.dump(council_data, handle, ensure_ascii=False, indent=2)
        print(f"    保存: {output_path}")

        index.append(
            {
                "council_id": council_id,
                "name": council_info["name"],
                "year": council_info["year"],
                "japanese_year": council_info["japanese_year"],
                "type_label": council_info["type_label"],
                "file": f"{council_id}.json",
                "schedule_count": len(council_data["schedules"]),
            }
        )

    index_path = output_dir / "index.json"
    with open(index_path, "w", encoding="utf-8") as handle:
        json.dump(index, handle, ensure_ascii=False, indent=2)
    print(f"\nインデックス保存: {index_path}")
    print(f"[{slug}] 完了: {len(councils)} 件の会議を処理しました。")
