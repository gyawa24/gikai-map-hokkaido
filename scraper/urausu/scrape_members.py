"""
浦臼町議会 議員名簿スクレイパー
出力: data/urausu/members.json および site/data/urausu/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.urausu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/kurashi/gyosei/urausutyo/meibo.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIRS = [
    REPO_ROOT / "data" / "urausu",
    REPO_ROOT / "site" / "data" / "urausu",
]
for d in OUTPUT_DIRS:
    d.mkdir(parents=True, exist_ok=True)

PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "urausu"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def normalize(text: str) -> str:
    if text is None:
        return ""
    return re.sub(r"\s+", "", text).strip()


def normalize_name(text: str) -> str:
    """Preserve a single space between family and given name."""
    if text is None:
        return ""
    # Replace full-width spaces with half-width, collapse runs, trim ends
    cleaned = re.sub(r"[\s\u3000]+", " ", text).strip()
    return cleaned


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15, allow_redirects=True)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def parse_members_table(soup: BeautifulSoup) -> list[dict]:
    target_table = None
    for table in soup.find_all("table"):
        if table.get("summary") == "議員名簿":
            target_table = table
            break
    if target_table is None:
        return []

    members: list[dict] = []
    rows = target_table.find_all("tr")
    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 7:
            continue
        seat_text = normalize(cells[0].get_text())
        if not seat_text.isdigit():
            continue
        seat = int(seat_text)
        role = normalize(cells[1].get_text())
        name = normalize_name(cells[2].get_text())
        party = normalize(cells[5].get_text())
        if not name:
            continue
        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": role,
            "committees": [],
        })
    return members


def parse_committees(soup: BeautifulSoup) -> dict[str, list[tuple[str, str]]]:
    """Returns {member_name: [(committee_name, role), ...]}."""
    assignments: dict[str, list[tuple[str, str]]] = {}
    for table in soup.find_all("table"):
        summary = table.get("summary", "")
        if "委員会" not in summary:
            continue
        caption_el = table.find("caption")
        caption = normalize(caption_el.get_text()) if caption_el else summary
        committee_name = re.sub(r"（.*?）", "", caption).strip() or summary
        for tr in table.find_all("tr"):
            cells = tr.find_all("td")
            if len(cells) < 2:
                continue
            role = normalize(cells[0].get_text())
            name = normalize_name(cells[1].get_text())
            if not name or not role:
                continue
            assignments.setdefault(name, []).append((committee_name, role))
    return assignments


def merge_committees(members: list[dict], assignments: dict[str, list[tuple[str, str]]]):
    for m in members:
        entries = assignments.get(m["name"], [])
        m["committees"] = [
            f"{c}（{r}）" if r and r != "委員" else c
            for c, r in entries
        ]


def scrape():
    print("浦臼町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    members = parse_members_table(soup)
    if not members:
        print("  議員テーブルが見つかりませんでした")
        return None

    assignments = parse_committees(soup)
    merge_committees(members, assignments)

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape()
    if not members:
        print("取得不可: 議員名簿ページから議員データを抽出できませんでした")
        return

    payload = json.dumps(members, ensure_ascii=False, indent=2)
    for d in OUTPUT_DIRS:
        (d / "members.json").write_text(payload + "\n", encoding="utf-8")

    print(f"取得議員数: {len(members)}名")
    for m in members:
        role = f" [{m['faction']}]" if m["faction"] else ""
        coms = f" 委員会:{'/'.join(m['committees'])}" if m["committees"] else ""
        print(f"  #{m['seat_number']} {m['name']} ({m['party']}){role}{coms}")


if __name__ == "__main__":
    main()
