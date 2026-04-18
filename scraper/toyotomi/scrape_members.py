"""
豊富町議会 議員名簿スクレイパー
出力:
  - data/toyotomi/members.json
  - site/data/toyotomi/members.json
写真は site/public/members/toyotomi/ に保存（存在する場合）。
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.toyotomi.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/section/gikaijimukyoku/a7cug60000000evt.html"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "toyotomi"
SITE_DATA_DIR = ROOT / "site" / "data" / "toyotomi"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "toyotomi"

for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def normalize_name(text: str) -> str:
    # 全角空白・通常空白を1個に潰し、氏名間の空白は1つに統一
    t = text.replace("\u3000", " ").strip()
    t = re.sub(r"\s+", " ", t)
    return t


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\u3000", " ")).strip()


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def find_member_table(soup: BeautifulSoup):
    # 「議員名簿」見出しを含むセクション内のtableを返す
    for h in soup.find_all(["h2", "h3"]):
        if "議員名簿" in h.get_text():
            table = h.find_next("table")
            if table:
                return table
    # フォールバック: thに「氏名」「所属党派」を含むtableを探す
    for table in soup.find_all("table"):
        headers = [clean_text(th.get_text()) for th in table.find_all("th")]
        if any("氏名" in h for h in headers) and any("所属党派" in h for h in headers):
            return table
    return None


def parse_members(table) -> list[dict]:
    members: list[dict] = []
    rows = table.find("tbody").find_all("tr") if table.find("tbody") else table.find_all("tr")[1:]
    for i, tr in enumerate(rows, start=1):
        # 1列目が<th>（職名）、以降<td>
        role_cell = tr.find("th")
        tds = tr.find_all("td")
        if role_cell is None or len(tds) < 4:
            continue

        role = clean_text(role_cell.get_text())
        name = normalize_name(tds[0].get_text())
        # 委員会: <ul><li>...</li></ul> または "なし" など
        committees: list[str] = []
        committee_cell = tds[1]
        lis = committee_cell.find_all("li")
        if lis:
            for li in lis:
                c = clean_text(li.get_text())
                if c:
                    committees.append(c)
        else:
            c = clean_text(committee_cell.get_text())
            if c and c not in ("なし", "無し", "-"):
                committees.append(c)

        party = clean_text(tds[3].get_text())

        # faction: 会派は本文中に「届出なし」とあるため空文字
        # role 情報は name とは別に保持せずフィールドへ含めない（スキーマに無いため）
        # ただし議長・副議長は会派扱いでない。seat_number は i を使用。

        members.append({
            "seat_number": i,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": "",
            "committees": committees,
            # role は schema 外だが議長・副議長の判別のため photo_url と同様オプション付与
        })
    return members


def save_json(path: Path, data) -> None:
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    print("豊富町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("取得不可: ページ取得失敗")
        return 1

    table = find_member_table(soup)
    if table is None:
        print("取得不可: 議員名簿テーブルが見つからない")
        return 1

    members = parse_members(table)
    if not members:
        print("取得不可: テーブルから議員を抽出できない")
        return 1

    # 写真: ページ内に議員写真は存在しないためスキップ
    # （必要になれば photo_url を後付けするフローへ）

    save_json(DATA_DIR / "members.json", members)
    save_json(SITE_DATA_DIR / "members.json", members)
    print(f"取得議員数: {len(members)}名")
    for m in members:
        print(f"  - 議席{m['seat_number']}: {m['name']} / {m['party']} / 委員会 {len(m['committees'])}件")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
