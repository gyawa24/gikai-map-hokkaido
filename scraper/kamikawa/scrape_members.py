"""
上川町議会 議員名簿スクレイパー
出力: data/kamikawa/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.hokkaido-kamikawa.lg.jp"
MEMBERS_URL = f"{BASE_URL}/section/gikai/chs8120000000z5g.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "kamikawa"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "kamikawa"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def scrape_members():
    print("上川町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    members = []

    # 議員ブロック: <h4>名前　役職</h4> + <div class="txtPart"><ul>...</ul></div>
    # 「常任委員会」「議会運営委員会」「特別委員会」のh4は除外する
    EXCLUDE_KEYWORDS = ["常任委員会", "議会運営委員会", "特別委員会", "委員会"]

    h4s = soup.find_all("h4")
    for h4 in h4s:
        h4_text = h4.get_text(strip=True)

        # 委員会系の見出しはスキップ
        if any(kw in h4_text for kw in EXCLUDE_KEYWORDS):
            continue

        # 氏名と役職を分離（全角スペースまたは半角スペース区切り）
        # 例: "濱田 純子　議長", "笠間 法考　副議長", "宮本 敬嘉　議員"
        parts = re.split(r"\u3000", h4_text, maxsplit=1)
        if len(parts) == 2:
            name_raw = parts[0].strip()
            role_in_heading = parts[1].strip()
        else:
            # 全角スペースがない場合は末尾の役職(議長/副議長/議員)を除去
            m = re.match(r"(.+?)\s*(議長|副議長|議員)$", h4_text)
            if m:
                name_raw = m.group(1).strip()
                role_in_heading = m.group(2)
            else:
                name_raw = h4_text
                role_in_heading = ""

        # 名前の余分な空白を除去（スペース区切りを保持）
        name = re.sub(r"\s+", " ", name_raw).strip()

        if not name or len(name) < 2:
            continue

        # 次のdiv.txtPartを取得
        div = h4.find_next_sibling("div")
        if not div:
            continue

        lis = div.find_all("li")
        furigana = ""
        party = ""
        seat_number = 0
        committees = []

        for li in lis:
            text = li.get_text(strip=True)
            text = re.sub(r"\s+", " ", text).strip()

            # ふりがな（strong要素）
            strong = li.find("strong")
            if strong:
                furigana = re.sub(r"\s+", "", strong.get_text(strip=True))
                continue

            # 会派と当選回数 (例: "無所属　当選3回" or "日本共産党　当選4回")
            m = re.match(r"(.+?)\s+当選(\d+)回", text)
            if m:
                party = m.group(1).strip()
                continue

            # 議席番号
            m = re.match(r"議席(\d+)番", text)
            if m:
                seat_number = int(m.group(1))
                continue

            # その他は委員会・役職
            if text:
                committees.append(text)

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": committees,
            "photo_url": "",
        }

        members.append(member)
        print(f"  [{seat_number:2d}] {name} ({furigana}) / {party} / 委員会:{len(committees)}件")

    # 議席番号順にソート
    members.sort(key=lambda m: m["seat_number"])

    return members


if __name__ == "__main__":
    members = scrape_members()

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(members)}名 -> {output_path}")
