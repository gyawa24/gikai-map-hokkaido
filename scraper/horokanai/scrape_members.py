"""
幌加内町議会 議員名簿スクレイパー
出力: data/horokanai/members.json （および site/data/horokanai/members.json）

HTML構造:
  <div class="well clear">
    <div class="col-..."> <img src="..."> </div>
    <div class="col-..."> <h3>氏名</h3>
      <ul>
        <li>議員番号：N</li>
        <li>職名：議長/副議長/議員</li>
        <li>当選回数：N</li>
        <li>委員会等...</li>
      </ul>
    </div>
  </div>

ふりがな・会派・政党の記載は公式ページに存在しないため空文字で出力する。
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.horokanai.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/giinlist/genre_giinlist/genzai"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "horokanai"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "horokanai"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "horokanai"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 全角数字→半角
_ZEN2HAN = str.maketrans("０１２３４５６７８９", "0123456789")


def zen2han(s: str) -> str:
    return s.translate(_ZEN2HAN)


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def parse_member_block(block) -> dict | None:
    h3 = block.find("h3")
    if not h3:
        return None
    name = h3.get_text(strip=True)
    if not name:
        return None

    ul = block.find("ul")
    seat = None
    title = ""
    committees: list[str] = []
    if ul:
        for li in ul.find_all("li"):
            # <br/> を改行に
            text = li.get_text("\n", strip=True)
            # 行ごとに処理
            for line in text.splitlines():
                line = line.strip()
                if not line:
                    continue
                if line.startswith("議員番号") or "議員番号" in line:
                    m = re.search(r"(\d+)", zen2han(line))
                    if m:
                        seat = int(m.group(1))
                elif line.startswith("職名") or "職名" in line:
                    title = line.split("：", 1)[-1].strip() if "：" in line else ""
                elif line.startswith("当選回数") or "当選回数" in line:
                    # 不要。スキップ
                    continue
                else:
                    # 委員会等の情報
                    committees.append(line)

    # 画像
    img = block.find("img")
    img_src = ""
    if img:
        src = img.get("src", "")
        if src:
            img_src = src if src.startswith("http") else BASE_URL + src

    return {
        "seat_number": seat,
        "name": name,
        "title": title,
        "committees": committees,
        "_img_src": img_src,
    }


def download_photo(url: str, seat: int) -> str:
    if not url:
        return ""
    ext = url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/horokanai/{fname}"
    except Exception as e:
        print(f"    [IMG ERROR] {url} -> {e}")
        return ""


def scrape():
    print("幌加内町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    blocks = soup.find_all("div", class_=lambda c: c and "well" in c.split())
    print(f"  議員ブロック {len(blocks)} 件発見")

    members = []
    for block in blocks:
        parsed = parse_member_block(block)
        if not parsed or parsed["seat_number"] is None:
            continue
        seat = parsed["seat_number"]
        print(f"  [議席{seat}] {parsed['name']} ({parsed['title']})")

        photo_url = download_photo(parsed["_img_src"], seat)
        time.sleep(0.3)

        members.append({
            "seat_number": seat,
            "name": parsed["name"],
            "furigana": "",
            "party": "",
            "faction": "",
            "title": parsed["title"],
            "committees": parsed["committees"],
            "photo_url": photo_url,
        })

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape()
    if not members:
        print("取得不可: 議員情報を取得できませんでした")
        return

    out = {"members": members}
    for target in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        target.write_text(
            json.dumps(out, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {target}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
