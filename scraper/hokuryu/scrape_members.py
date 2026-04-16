"""
北竜町議会 議員名簿スクレイパー
出力: data/hokuryu/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

MEMBERS_URL = "http://www.town.hokuryu.hokkaido.jp/tyousei/gikai/giinmeibo/"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "hokuryu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 役職ラベル（会派ではなく役職扱い）
ROLE_PATTERNS = re.compile(r"(議長|副議長|監査委員)$")
# 委員会名の検出（「〜委員会〜」を含む行）
COMMITTEE_PATTERN = re.compile(r"委員会")


def fetch_soup(url: str) -> BeautifulSoup:
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return BeautifulSoup(resp.text, "html.parser")


def parse_name_cell(text: str) -> tuple[str, str]:
    # 「中村 尚一\nナカムラ ショウイチ」のような2行構成を想定
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if not lines:
        return "", ""
    name = lines[0]
    furigana = ""
    # カタカナ行を探す
    for l in lines[1:]:
        if re.fullmatch(r"[ァ-ヶー\s]+", l):
            furigana = l
            break
    return name, furigana


def parse_role_cell(text: str) -> tuple[list[str], list[str]]:
    """役職セルから役職名と委員会名を分離する。"""
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    roles: list[str] = []
    committees: list[str] = []
    for l in lines:
        if COMMITTEE_PATTERN.search(l):
            committees.append(l)
        else:
            roles.append(l)
    return roles, committees


def scrape_members() -> list[dict]:
    print(f"北竜町議会 議員名簿を収集中: {MEMBERS_URL}")
    soup = fetch_soup(MEMBERS_URL)
    table = soup.find("table")
    if table is None:
        raise RuntimeError("議員名簿テーブルが見つかりません")

    rows = table.find_all("tr")
    members: list[dict] = []
    for row in rows[1:]:  # skip header
        cells = row.find_all(["td", "th"])
        if len(cells) < 6:
            continue
        seat_text = cells[0].get_text(strip=True)
        try:
            seat_number = int(seat_text)
        except ValueError:
            continue

        name, furigana = parse_name_cell(cells[1].get_text("\n", strip=True))
        if not name:
            continue

        party = cells[2].get_text(strip=True)
        roles, role_committees = parse_role_cell(cells[3].get_text("\n", strip=True))

        # 一部事務組合も独立した情報だが本プロジェクトのスキーマでは committees にまとめない
        # 役職（議長・副議長・監査委員）は faction フィールドに入れず name 表示で扱う方が良いが、
        # スキーマに合わせて faction は無所属扱いとし、役職は committees に残さない。
        # 役職はトップレベルのフィールドが無いため、faction の頭に加えず一旦 committees からは除外。
        committees = role_committees

        # faction は党派と同じ「無所属」等をそのまま
        faction = ""  # 北竜町は全員無所属で会派なし

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": faction,
            "committees": committees,
        }
        # 役職は name の後に残したいが、スキーマ上の席に無いため省略
        members.append(member)

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員を1件も抽出できませんでした")
        return
    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"取得議員数: {len(members)}名 -> {out_path}")


if __name__ == "__main__":
    main()
