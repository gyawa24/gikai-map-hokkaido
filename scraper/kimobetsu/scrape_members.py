"""
喜茂別町議会 議員名簿スクレイパー
出力: data/kimobetsu/members.json, site/data/kimobetsu/members.json
"""

import json
import re
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.kimobetsu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/town/detail.php?content=108"

ROOT = Path(__file__).parent.parent.parent
RAW_DIR = ROOT / "data" / "kimobetsu"
SITE_DATA_DIR = ROOT / "site" / "data" / "kimobetsu"
RAW_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> BeautifulSoup:
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return BeautifulSoup(resp.text, "html.parser")


def normalize_name(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("\u3000", " ")).strip()


def extract_role_and_committees(yakushoku_text: str) -> tuple[str, list[str]]:
    """
    「役職名」セルのテキストから、役職（議長・副議長・各委員長等）と
    所属委員会リストを抽出する。改行と全角空白で分かち書きされている。

    例:
      "副議長\n総務常任委員　経済常任委員\n後志広域連合議会議員"
      "議会運営委員長\n総務常任委員　経済常任委員"
    """
    # 改行と全角/半角スペースを区切り文字として扱う
    raw_tokens = re.split(r"[\n\r\u3000\s]+", yakushoku_text)
    tokens = [t.strip() for t in raw_tokens if t.strip()]

    role = ""
    committees: list[str] = []

    role_priorities = ["議長", "副議長"]
    for t in tokens:
        if t in role_priorities and not role:
            role = t

    for t in tokens:
        if t == "議長" or t == "副議長":
            continue
        # 委員会関連の役職・所属を全て委員会欄に入れる
        if "委員" in t or "議員" in t:
            committees.append(t)

    return role, committees


def parse_members(soup: BeautifulSoup) -> list[dict]:
    """
    HTMLから議員名簿をパースする。
    構造: <h3 class="c-secTtl03"><span>議席番号：N</span></h3>
          直後に <table class="c-table"> が続く（氏名/生年月日/当選回数/役職名/党派）
    """
    members: list[dict] = []

    headers = soup.find_all("h3", class_="c-secTtl03")
    for h in headers:
        span = h.find("span")
        if not span:
            continue
        m = re.search(r"議席番号[：:]\s*(\d+)", span.get_text(strip=True))
        if not m:
            continue
        seat = int(m.group(1))

        # 同じカセット（head_block）の親 div の次の cassette-item（table_block）を探す
        head_block = h.find_parent("div", class_="cassette-item")
        if head_block is None:
            continue
        table_block = head_block.find_next_sibling("div", class_="cassette-item")
        if table_block is None:
            continue
        table = table_block.find("table", class_="c-table")
        if table is None:
            continue

        fields: dict[str, str] = {}
        for tr in table.find_all("tr"):
            th = tr.find("th")
            td = tr.find("td")
            if not th or not td:
                continue
            key = th.get_text(strip=True)
            # <br> を改行として保持してテキスト化
            for br in td.find_all("br"):
                br.replace_with("\n")
            val = td.get_text()
            fields[key] = val

        name_raw = fields.get("氏名", "").strip()
        if not name_raw:
            continue

        name = normalize_name(name_raw)
        party = normalize_name(fields.get("党派", ""))
        role, committees = extract_role_and_committees(fields.get("役職名", ""))

        entry: dict = {
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": "",
            "committees": committees,
        }
        if role:
            entry["role"] = role
        members.append(entry)

    members.sort(key=lambda x: x["seat_number"])
    return members


def main() -> None:
    print("喜茂別町議会 議員名簿を収集中...")
    print(f"  URL: {MEMBERS_URL}")
    soup = fetch(MEMBERS_URL)

    members = parse_members(soup)
    if not members:
        print("  [ERROR] 議員名簿のパースに失敗")
        sys.exit(1)

    for out_dir in (RAW_DIR, SITE_DATA_DIR):
        out_path = out_dir / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {out_path}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
