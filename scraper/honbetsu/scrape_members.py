"""
本別町議会 議員名簿スクレイパー
出力: data/honbetsu/members.json （と site/data/honbetsu/members.json へのコピー）

議員情報は parliament03.html のテーブル内に HTML テキストで存在する。
ハードコードは一切せず、毎回このページから動的に取得する。
"""

import json
import re
import shutil
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.honbetsu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/web/parliament/parliament03.html"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "honbetsu"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "honbetsu"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize_name(raw: str) -> str:
    # 全角スペース・半角スペースを除去して姓名を連結
    return re.sub(r"[\s\u3000]+", "", raw).strip()


def normalize_party(raw: str) -> str:
    t = re.sub(r"[\s\u3000]+", "", raw).strip()
    # 「無」は「無所属」に寄せる。「共産」はそのまま「日本共産党」に寄せる。
    if t in ("無", "無所属"):
        return "無所属"
    if t in ("共産", "共産党"):
        return "日本共産党"
    return t


def parse_committees(cell_text: str) -> list[str]:
    """
    例: "〇総務、広報広聴" -> ["総務", "広報広聴"]
        "◎産業厚生、広報広聴、議運" -> ["産業厚生", "広報広聴", "議運"]
        "－" -> []
    """
    t = cell_text.replace("〇", "").replace("○", "").replace("◎", "")
    t = re.sub(r"[\s\u3000]+", "", t)
    if not t or t in ("-", "ー", "－"):
        return []
    # 区切り文字: 全角読点「、」「，」半角カンマ
    parts = re.split(r"[、,，]", t)
    return [p for p in (p.strip() for p in parts) if p]


def scrape_members() -> list[dict]:
    print("本別町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    # 議員一覧テーブル: class="hyou_gray"
    table = soup.find("table", class_="hyou_gray")
    if table is None:
        print("  議員テーブルが見つかりません")
        return []

    rows = table.find_all("tr")
    members: list[dict] = []

    for tr in rows[1:]:  # 先頭はヘッダ行
        tds = tr.find_all("td")
        if len(tds) < 6:
            continue
        seat_text = tds[0].get_text(strip=True)
        # 議席番号が数字でない行（「－」や空行）はスキップ
        seat_m = re.search(r"\d+", seat_text)
        if not seat_m:
            continue
        seat_number = int(seat_m.group())

        name = normalize_name(tds[1].get_text())
        if not name:
            continue

        party = normalize_party(tds[4].get_text())
        committees = parse_committees(tds[3].get_text())

        members.append({
            "seat_number": seat_number,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": "",
            "committees": committees,
        })

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データを抽出できませんでした")
        return

    out = DATA_DIR / "members.json"
    out.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    # site/data/honbetsu にも同じ内容をコピー（CLAUDE.md の data 同期方針）
    shutil.copy(out, SITE_DATA_DIR / "members.json")

    print(f"取得議員数: {len(members)}名 -> {out}")
    for m in members:
        print(f"  #{m['seat_number']:>2} {m['name']} [{m['party']}] 委員会:{m['committees']}")


if __name__ == "__main__":
    main()
