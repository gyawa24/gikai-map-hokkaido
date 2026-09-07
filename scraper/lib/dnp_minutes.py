import hashlib
import json
import re
import tempfile
import time
from pathlib import Path

import requests

API_BASE = "https://ssp.kaigiroku.net/dnp/search"
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; gikai-map-hokkaido/1.0)",
}

REIWA_YEAR_PATTERN = re.compile(r"令和\s*(元|[0-9０-９]+)\s*年")
FULLWIDTH_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")


def resolve_council_year(
    council_name: str,
    fallback_year: str,
    fallback_japanese_year: str,
) -> tuple[str, str]:
    """Prefer the year explicitly written in the official council name.

    DNP can place a council under the preceding ``view_year`` even when the
    council name itself says the following Reiwa year.  Only override the API
    grouping metadata when the official name contains an unambiguous year.
    """
    match = REIWA_YEAR_PATTERN.search(council_name)
    if not match:
        return fallback_year, fallback_japanese_year

    raw_year = match.group(1).translate(FULLWIDTH_DIGITS)
    reiwa_year = 1 if raw_year == "元" else int(raw_year)
    if not 1 <= reiwa_year <= 99:
        return fallback_year, fallback_japanese_year

    return str(2018 + reiwa_year), f"令和{reiwa_year}年"


def managed_minutes_records(minutes_dir: Path) -> list[dict]:
    if minutes_dir.name != "minutes":
        return []
    registry_path = minutes_dir.parent / "council-records" / "index.json"
    if not registry_path.exists():
        return []
    with open(registry_path, encoding="utf-8") as handle:
        registry = json.load(handle)
    if (
        not isinstance(registry, dict)
        or registry.get("schema_version") != "council-record-body-registry.v1"
        or registry.get("municipality_id") != minutes_dir.parent.name
        or not isinstance(registry.get("records"), list)
    ):
        raise ValueError(f"Invalid v2 managed minutes registry: {registry_path}")
    seen = set()
    for record in registry["records"]:
        council_id = record.get("council_id") if isinstance(record, dict) else None
        if (
            not isinstance(council_id, int) or isinstance(council_id, bool)
            or council_id < 1 or council_id in seen
            or record.get("state") not in ("active", "rolled_back")
            or not re.fullmatch(r"[a-f0-9]{64}", str(record.get("minutes_sha256", "")))
            or not re.fullmatch(r"[a-f0-9]{64}", str(record.get("publication_sha256", "")))
            or not re.fullmatch(
                rf"council-records/{council_id}/releases/[A-Za-z0-9][A-Za-z0-9_-]*",
                str(record.get("release_path", "")),
            )
        ):
            raise ValueError(f"Invalid v2 managed minutes registry entry: {registry_path}")
        seen.add(council_id)
    return [record for record in registry["records"] if record["state"] == "active"]


def preserve_managed_minutes(path: Path, data) -> bool:
    records = managed_minutes_records(path.parent)
    for record in records:
        council_id = record["council_id"]
        body_path = path.parent / f"{council_id}.json"
        if path.name not in ("index.json", body_path.name):
            continue
        message = f"v2 managed council {council_id}: legacy update held; use the council-record publication workflow"
        if not body_path.is_file() or hashlib.sha256(body_path.read_bytes()).hexdigest() != record["minutes_sha256"]:
            raise ValueError(f"{message} (existing projection hash mismatch)")
        if path.name == body_path.name:
            if json.loads(body_path.read_bytes()) != data:
                raise ValueError(f"{message} (collected content or metadata changed)")
            return True
        if not path.is_file() or not isinstance(data, list):
            raise ValueError(f"{message} (publication index missing or malformed)")
        previous = json.loads(path.read_bytes())
        if not isinstance(previous, list):
            raise ValueError(f"{message} (publication index malformed)")
        old_entries = [entry for entry in previous if isinstance(entry, dict) and entry.get("council_id") == council_id]
        new_entries = [entry for entry in data if isinstance(entry, dict) and entry.get("council_id") == council_id]
        if len(old_entries) != 1 or new_entries != old_entries or old_entries[0].get("file") != body_path.name:
            raise ValueError(f"{message} (managed publication index entry changed or removed)")
    return False


def write_json_atomic(path: Path, data) -> None:
    """Write a complete JSON temp file before replacing the destination."""
    if preserve_managed_minutes(path, data):
        return
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            json.dump(data, temp_file, ensure_ascii=False, indent=2)
        temp_path.replace(path)
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()


def sync_existing_council_year(
    output_path: Path,
    year: str,
    japanese_year: str,
) -> bool:
    """Keep an existing council file's year metadata aligned with its index."""
    with open(output_path, encoding="utf-8") as handle:
        council_data = json.load(handle)

    if (
        council_data.get("year") == year
        and council_data.get("japanese_year") == japanese_year
    ):
        return False

    council_data["year"] = year
    council_data["japanese_year"] = japanese_year
    write_json_atomic(output_path, council_data)
    return True


INDEX_METADATA_KEYS = (
    "council_id",
    "name",
    "year",
    "japanese_year",
    "type_label",
)


def load_council_index(index_path: Path) -> dict[str, dict]:
    """Load the existing index without allowing malformed data to be replaced."""
    if not index_path.exists():
        return {}

    with open(index_path, encoding="utf-8") as handle:
        entries = json.load(handle)
    if not isinstance(entries, list):
        raise ValueError(f"{index_path} must contain a JSON array")

    index_by_id: dict[str, dict] = {}
    for position, entry in enumerate(entries):
        if not isinstance(entry, dict) or "council_id" not in entry:
            raise ValueError(f"{index_path}[{position}] has no council_id")
        council_id = entry["council_id"]
        if not isinstance(council_id, int) or isinstance(council_id, bool):
            raise ValueError(f"{index_path}[{position}] council_id must be an integer")
        key = str(council_id)
        if key in index_by_id:
            raise ValueError(f"{index_path} has duplicate council_id: {entry['council_id']}")
        index_by_id[key] = entry
    return index_by_id


def council_index_entry(
    council_info: dict,
    *,
    previous: dict | None = None,
    schedule_count: int | None = None,
) -> dict:
    """Update official metadata while retaining any existing index extensions."""
    entry = dict(previous or {})
    entry.update({key: council_info[key] for key in INDEX_METADATA_KEYS})
    entry["file"] = f"{council_info['council_id']}.json"
    if schedule_count is not None:
        entry["schedule_count"] = schedule_count
    return entry


def council_file_schedule_count(output_path: Path) -> int:
    with open(output_path, encoding="utf-8") as handle:
        council_data = json.load(handle)
    validate_council_content(council_data, source=str(output_path))
    schedules = council_data.get("schedules", [])
    return len(schedules)


def validate_council_content(council_data: dict, *, source: str = "council") -> None:
    """Reject structurally successful API responses that contain no publishable body."""
    schedules = council_data.get("schedules")
    if not isinstance(schedules, list) or not schedules:
        raise ValueError(f"{source}: schedules must be a non-empty JSON array")

    for position, schedule in enumerate(schedules):
        minutes = schedule.get("minutes") if isinstance(schedule, dict) else None
        if not isinstance(minutes, list) or not minutes:
            raise ValueError(f"{source}: schedule[{position}] minutes must be non-empty")
        if not any(str(minute.get("text", "")).strip() for minute in minutes if isinstance(minute, dict)):
            raise ValueError(f"{source}: schedule[{position}] has no minute text")


def ordered_council_index(index_by_id: dict[str, dict]) -> list[dict]:
    """Order newer years and DNP council IDs first for stable public display."""
    return sorted(
        index_by_id.values(),
        key=lambda entry: (
            str(entry.get("year", "")),
            entry["council_id"],
        ),
        reverse=True,
    )


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


def council_groups_from_response(data, *, allow_empty: bool = False) -> list[dict]:
    """Validate the top-level DNP council-list response before filtering it."""
    if not isinstance(data, dict):
        raise ValueError("DNP councils/index response must be a JSON object")
    councils = data.get("councils")
    if not isinstance(councils, list):
        raise ValueError("DNP councils/index response has no councils array")
    if not councils and not allow_empty:
        raise ValueError("DNP councils/index returned an empty councils array")
    return councils


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
    *,
    allow_empty: bool = False,
) -> list[dict]:
    print("会議一覧を取得中...")
    data = post("councils/index", {"tenant_id": tenant_id}, request_interval=request_interval)
    time.sleep(request_interval)

    targets: list[dict] = []
    for item in council_groups_from_response(data, allow_empty=allow_empty):
        for view_year in item.get("view_years", []):
            fallback_year = view_year.get("view_year", "")
            fallback_japanese_year = view_year.get("japanese_year", "")
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
                    name = council["name"].replace("\u3000", " ").strip()
                    year, japanese_year = resolve_council_year(
                        name,
                        fallback_year,
                        fallback_japanese_year,
                    )
                    if year not in target_years:
                        continue
                    targets.append(
                        {
                            "council_id": council["council_id"],
                            "name": name,
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

    council_data = {**council_info, "schedules": result_schedules}
    validate_council_content(council_data, source=f"council_id={council_id}")
    return council_data


def run_scrape(
    *,
    slug: str,
    tenant_id: int,
    output_dir: Path,
    target_keywords: list[str],
    target_years: set[str],
    request_interval: float,
    force: bool = False,
    allow_empty: bool = False,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    index_path = output_dir / "index.json"
    index_existed_before = index_path.exists()
    index_by_id = load_council_index(index_path)

    councils = fetch_councils(
        tenant_id=tenant_id,
        target_years=target_years,
        target_keywords=target_keywords,
        request_interval=request_interval,
        allow_empty=allow_empty,
    )
    print(f"\n対象会議: {len(councils)} 件\n")
    for council in councils:
        print(f"  [{council['year']}] {council['name']} (id={council['council_id']})")

    failures = []
    for position, council_info in enumerate(councils):
        council_id = council_info["council_id"]
        council_key = str(council_id)
        output_path = output_dir / f"{council_id}.json"

        if output_path.exists() and not force:
            try:
                schedule_count = council_file_schedule_count(output_path)
                metadata_updated = sync_existing_council_year(
                    output_path,
                    council_info["year"],
                    council_info["japanese_year"],
                )
            except Exception as exc:
                print(
                    f"\n[{position + 1}/{len(councils)}] "
                    f"既存会議の確認失敗、indexを保持: {council_info['name']} ({exc})"
                )
                failures.append((council_id, str(exc)))
                continue
            suffix = " / 年メタデータ更新" if metadata_updated else ""
            print(
                f"\n[{position + 1}/{len(councils)}] "
                f"スキップ (既存): {council_info['name']}{suffix}"
            )
            index_by_id[council_key] = council_index_entry(
                council_info,
                previous=index_by_id.get(council_key),
                schedule_count=schedule_count,
            )
            continue

        print(f"\n[{position + 1}/{len(councils)}] 取得中: {council_info['name']}")
        try:
            council_data = scrape_council(
                council_info,
                tenant_id=tenant_id,
                request_interval=request_interval,
            )
        except Exception as exc:
            print(f"    取得失敗、既存indexを保持: {exc}")
            failures.append((council_id, str(exc)))
            continue

        write_json_atomic(output_path, council_data)
        print(f"    保存: {output_path}")

        index_by_id[council_key] = council_index_entry(
            council_info,
            previous=index_by_id.get(council_key),
            schedule_count=len(council_data["schedules"]),
        )

    index = ordered_council_index(index_by_id)
    if index or index_existed_before:
        write_json_atomic(index_path, index)
        print(f"\nインデックス保存: {index_path}")
    else:
        print("\n取得成功した会議がないためindexは作成しません。")
    print(
        f"[{slug}] 完了: {len(councils)} 件の会議を処理 / "
        f"index全{len(index)}件を保持しました。"
    )
    if failures:
        failed_ids = ", ".join(str(council_id) for council_id, _ in failures)
        raise RuntimeError(f"[{slug}] {len(failures)} council(s) failed: {failed_ids}")
