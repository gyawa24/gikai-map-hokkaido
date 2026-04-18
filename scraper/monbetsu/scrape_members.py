"""
紋別市議会 議員名簿スクレイパー
出力: data/monbetsu/members.json

HTML構造:
  div.c-memberList_item
    figure.c-card_img > img                # 写真
    p.c-card_num                           # "議席番号：1"
    p.c-card_name > ruby  ... <rt>...</rt> # 氏名とふりがな
    dl.c-card_def > dt/dd                  # 生年月日, 当選回数, 会派, 所属等
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://mombetsu.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/member/"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "monbetsu"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR = ROOT / "site" / "data" / "monbetsu"
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "monbetsu"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

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


def extract_name_and_furigana(ruby_el) -> tuple[str, str]:
    """ruby 要素から氏名（rt除く）とふりがな（rt内）を抽出。"""
    if ruby_el is None:
        return "", ""
    rt = ruby_el.find("rt")
    furigana = rt.get_text(strip=True) if rt else ""
    # rtを取り除いてからテキスト抽出
    ruby_copy = BeautifulSoup(str(ruby_el), "html.parser").find("ruby")
    if ruby_copy:
        for rt_tag in ruby_copy.find_all("rt"):
            rt_tag.decompose()
        name = ruby_copy.get_text(strip=True)
    else:
        name = ""
    # 氏名は "田中 勝彦" のように姓名スペース区切りなのでそのまま
    name = re.sub(r"\s+", " ", name).strip()
    furigana = re.sub(r"\s+", " ", furigana).strip()
    return name, furigana


def parse_committees(shozoku_text: str) -> list[str]:
    """所属等の文字列をカンマ・読点で分割して委員会リストを作る。"""
    if not shozoku_text:
        return []
    parts = re.split(r"[、,]\s*", shozoku_text)
    return [p.strip() for p in parts if p.strip()]


def download_photo(remote_url: str, seat: int) -> str:
    """写真をダウンロードし public/members/monbetsu/seat_N.ext パスを返す。失敗なら空。"""
    try:
        ext = remote_url.split(".")[-1].split("?")[0].lower()
        if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
            ext = "jpg"
        fname = f"seat_{seat}.{ext}"
        resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/monbetsu/{fname}"
    except Exception as e:
        print(f"    [photo ERROR] {remote_url} -> {e}")
        return ""


def scrape_members() -> list[dict]:
    print("紋別市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    # 議席順名簿セクションのみ対象にする（会派別・委員会別は重複）
    section = soup.find("div", id="content-1")
    if section is None:
        # フォールバック: ページ全体から探す
        section = soup

    cards = section.find_all("div", class_="c-memberList_item")
    print(f"  議員カード {len(cards)} 件発見")

    members = []
    for card in cards:
        num_el = card.find("p", class_="c-card_num")
        name_el = card.find("p", class_="c-card_name")
        dl = card.find("dl", class_="c-card_def")
        img = card.find("img")

        # 議席番号
        seat_number = 0
        if num_el:
            m = re.search(r"(\d+)", num_el.get_text())
            if m:
                seat_number = int(m.group(1))

        # 氏名・ふりがな
        name, furigana = "", ""
        if name_el:
            ruby = name_el.find("ruby")
            if ruby:
                name, furigana = extract_name_and_furigana(ruby)
            else:
                name = name_el.get_text(strip=True)

        if not name or seat_number == 0:
            continue

        # 会派・委員会
        faction = ""
        committees: list[str] = []
        if dl:
            current_key = ""
            for child in dl.find_all(["dt", "dd"]):
                if child.name == "dt":
                    current_key = child.get_text(strip=True)
                elif child.name == "dd":
                    val = child.get_text(strip=True)
                    if current_key == "会派":
                        faction = val
                    elif current_key == "所属等":
                        committees = parse_committees(val)

        # 写真
        photo_url = ""
        if img and img.get("src"):
            src = img["src"]
            remote = src if src.startswith("http") else BASE_URL + src
            photo_url = download_photo(remote, seat_number)
            time.sleep(0.3)

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": faction,
            "committees": committees,
            "photo_url": photo_url,
        }
        members.append(member)
        print(f"  [{seat_number:2d}] {name} ({furigana}) / {faction}")

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データを抽出できませんでした")
        return

    out_data = DATA_DIR / "members.json"
    out_site = SITE_DATA_DIR / "members.json"
    payload = json.dumps(members, ensure_ascii=False, indent=2)
    out_data.write_text(payload, encoding="utf-8")
    out_site.write_text(payload, encoding="utf-8")
    print(f"\n取得議員数: {len(members)}名")
    print(f"  -> {out_data}")
    print(f"  -> {out_site}")


if __name__ == "__main__":
    main()
