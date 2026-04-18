"""
比布町議会 議員名簿スクレイパー
出力: site/data/pippu/members.json

ページ構造:
  - 議長・副議長はh3見出しに議席番号なし（名前のみ）
  - 一般議員はh3見出しに「N番 氏名 議員」形式
  - 各議員の詳細は◆マーカー付きテキストで記載
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.pippu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/cms/section/gikai/i9kb6d0000003ccr.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "pippu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "pippu"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 議員ではない見出しを除外するキーワード
NON_MEMBER_KEYWORDS = ["名簿", "一覧", "任期", "定数", "お知らせ"]


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def download_photo(remote_url: str, fname: str) -> str:
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/pippu/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗: {remote_url} -> {e}")
        return ""


def is_member_heading(text: str) -> bool:
    """議員の見出しかどうかを判定"""
    if any(kw in text for kw in NON_MEMBER_KEYWORDS):
        return False
    # 「議長」「副議長」「N番」「議員」いずれかを含む
    return bool(re.search(r"議[長員]|副議長|[0-9０-９]+\s*番", text))


def extract_seat_number(text: str) -> int | None:
    """見出しテキストから議席番号を抽出"""
    m = re.search(r"([0-9０-９]+)\s*番", text)
    if not m:
        return None
    num_str = m.group(1).translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    return int(num_str)


def extract_role(text: str) -> str:
    if "副議長" in text:
        return "副議長"
    if "議長" in text:
        return "議長"
    return ""


def scrape_members():
    print("比布町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    content = soup.find("div", id=re.compile(r"content|main", re.I))
    if content is None:
        content = soup.body

    headings = content.find_all(["h2", "h3"])
    members = []
    # 議長・副議長はseat_numberなしなので末尾に付番するためのオフセット管理
    no_seat_counter = 0

    for h in headings:
        heading_text = h.get_text(strip=True)

        if not is_member_heading(heading_text):
            continue

        role = extract_role(heading_text)
        seat_number = extract_seat_number(heading_text)

        member = {
            "seat_number": seat_number,
            "name": "",
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
            "role": role,
        }

        # 見出し直後の兄弟要素を走査
        sibling = h.find_next_sibling()
        block_text_parts = []
        photo_saved = False

        while sibling and sibling.name not in ["h2", "h3"]:
            # 写真を探す（seat_numberが確定後に保存）
            img_tag = sibling if sibling.name == "img" else sibling.find("img")
            if img_tag and not photo_saved:
                src = img_tag.get("src", "")
                if src and not src.startswith("data:"):
                    member["_photo_src"] = src

            text = sibling.get_text(separator="\n", strip=True)
            if text:
                block_text_parts.append(text)

            sibling = sibling.find_next_sibling()

        block_text = "\n".join(block_text_parts)

        # ◆マーカーからフィールド抽出
        furigana_m = re.search(r"◆\s*ふりがな[…・\s]*([ぁ-ん\s　ー]+)", block_text)
        if furigana_m:
            member["furigana"] = re.sub(r"[ 　]+", " ", furigana_m.group(1)).strip()

        name_m = re.search(r"◆\s*氏名[…・\s]*([^\n◆]+)", block_text)
        if name_m:
            member["name"] = name_m.group(1).strip()

        party_m = re.search(r"◆\s*党派[…・\s]*([^\n◆]+)", block_text)
        if party_m:
            member["party"] = party_m.group(1).strip()

        # 氏名未取得時は見出しから推測
        if not member["name"]:
            candidate = re.sub(
                r"(議席|[0-9０-９]+番|副議長|議長|議員|\s)", "", heading_text
            ).strip()
            if len(candidate) >= 2:
                member["name"] = candidate

        if not member["name"]:
            print(f"  [WARN] 氏名取得失敗、スキップ: {heading_text}")
            continue

        # 議席番号なし（議長・副議長）は一時的にNoneのまま記録
        if seat_number is None:
            no_seat_counter += 1

        label = f"議席{seat_number}番" if seat_number else role
        print(f"  {label}: {member['name']} ({member['furigana']}) {member['party']}")
        members.append(member)

    # 議席番号なしの議員に最後の番号を付与（7番以降）
    max_seat = max((m["seat_number"] for m in members if m["seat_number"]), default=0)
    extra = max_seat
    for m in members:
        if m["seat_number"] is None:
            extra += 1
            m["seat_number"] = extra

    # 写真をダウンロード（seat_number確定後）
    for m in members:
        src = m.pop("_photo_src", None)
        if src:
            remote_url = src if src.startswith("http") else BASE_URL + src
            ext = src.split(".")[-1].split("?")[0] or "jpg"
            fname = f"seat_{m['seat_number']}.{ext}"
            m["photo_url"] = download_photo(remote_url, fname)
            time.sleep(0.3)

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データを抽出できませんでした")
        return

    output = [
        {
            "seat_number": m["seat_number"],
            "name": m["name"],
            "furigana": m["furigana"],
            "party": m["party"],
            "faction": m["faction"],
            "committees": m["committees"],
            "photo_url": m["photo_url"],
        }
        for m in members
    ]

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n取得議員数: {len(output)}名")
    print(f"出力: {out_path}")


if __name__ == "__main__":
    main()
