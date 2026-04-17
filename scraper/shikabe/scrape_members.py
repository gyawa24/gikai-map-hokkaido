"""
鹿部町議会 議員名簿スクレイパー
出力: data/shikabe/members.json
"""

import json
import re
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.shikabe.lg.jp"
MEMBERS_URL = f"{BASE_URL}/choseijoho/chogikai/926.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "shikabe"
SITE_OUTPUT_DIR = REPO_ROOT / "site" / "data" / "shikabe"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

KNOWN_COMMITTEES = ["総務経済", "民生文教"]


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}", file=sys.stderr)
        return None


def normalize_name(raw: str) -> str:
    # 「三谷 百十樹」→「三谷百十樹」（姓名の空白を全て除去）
    return re.sub(r"\s+", "", raw)


def normalize_party(raw: str) -> str:
    v = raw.strip()
    if v in ("無", "無所属"):
        return "無所属"
    return v


def parse_committees(raw: str) -> list[str]:
    # 「総務経済 （副委員長） 民生文教」のような文字列から委員会名を抽出
    committees = []
    for c in KNOWN_COMMITTEES:
        if c in raw:
            committees.append(f"{c}常任委員会")
    return committees


def parse_faction_from_remarks(remarks: str) -> str:
    # 鹿部町は「役職」的な情報しか無いため、faction（会派）は空。
    # 議長/副議長は役職情報として faction には入れない（他市との整合性）。
    return ""


def scrape_members() -> list[dict]:
    print("鹿部町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗", file=sys.stderr)
        return []

    tables = soup.find_all("table")
    if not tables:
        print("  テーブルが見つかりません", file=sys.stderr)
        return []

    # 最初のテーブルが議員名簿
    table = tables[0]
    rows = table.find_all("tr")
    members: list[dict] = []

    for row in rows[1:]:  # ヘッダー行スキップ
        cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
        if len(cells) < 8:
            continue
        seat_raw, name_raw, _age, _job, committees_raw, party_raw, _count, remarks_raw = cells[:8]

        if not seat_raw.strip().isdigit():
            continue

        seat_number = int(seat_raw.strip())
        name = normalize_name(name_raw)
        if not name:
            continue

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": "",
            "party": normalize_party(party_raw),
            "faction": parse_faction_from_remarks(remarks_raw),
            "committees": parse_committees(committees_raw),
        }
        members.append(member)
        print(f"  [{seat_number}] {name} / 委員会={member['committees']} / 党派={member['party']}")

    return members


def main() -> int:
    members = scrape_members()
    if not members:
        print("取得不可: 議員データが1件も取れませんでした", file=sys.stderr)
        return 1

    payload = {"members": members}
    for path in (OUTPUT_DIR / "members.json", SITE_OUTPUT_DIR / "members.json"):
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  書き出し: {path}")

    print(f"取得議員数: {len(members)}名")
    return 0


if __name__ == "__main__":
    sys.exit(main())
