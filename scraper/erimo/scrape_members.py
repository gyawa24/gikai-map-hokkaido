"""
えりも町議会 議員名簿スクレイパー
出力: data/erimo/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.erimo.lg.jp"
MEMBERS_URL = f"{BASE_URL}/section/gikai/u9c3nn0000000p1q.html"

DATA_OUT = Path(__file__).parent.parent.parent / "data" / "erimo"
SITE_OUT = Path(__file__).parent.parent.parent / "site" / "data" / "erimo"
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "erimo"
for d in (DATA_OUT, SITE_OUT, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

NAME_RE = re.compile(r"^\s*(.+?)\s*[(（]\s*([ぁ-んー\s]+?)\s*[)）]\s*$")


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def parse_name(text: str) -> tuple[str, str]:
    """『髙松 亮裕（たかまつ すけひろ）』→ ('髙松 亮裕', 'たかまつ すけひろ')"""
    m = NAME_RE.match(text)
    if not m:
        return text.strip(), ""
    name = re.sub(r"\s+", " ", m.group(1)).strip()
    furigana = re.sub(r"\s+", " ", m.group(2)).strip()
    return name, furigana


def extract_field(ul, label: str) -> str | list[str] | None:
    """ul直下のliから strong が label に一致するものの値を取り出す"""
    for li in ul.find_all("li", recursive=False):
        strong = li.find("strong", recursive=False)
        if not strong:
            continue
        key = strong.get_text(strip=True).rstrip("：:").strip()
        if key != label:
            continue
        nested = li.find("ul", recursive=False)
        if nested:
            return [n.get_text(strip=True) for n in nested.find_all("li") if n.get_text(strip=True)]
        text = li.get_text(" ", strip=True)
        text = re.sub(rf"^{label}\s*[：:]\s*", "", text)
        return text.strip()
    return None


def scrape_members():
    print("えりも町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    section = soup.find(id="s0")
    if section is None:
        print("  議員名簿セクションが見つかりません")
        return []

    members = []
    h4_list = section.find_all("h4")
    print(f"  議員エントリ {len(h4_list)} 件")

    for h4 in h4_list:
        raw = h4.get_text(" ", strip=True)
        name, furigana = parse_name(raw)
        if not name:
            continue

        txt_part = h4.find_next_sibling("div", class_="txtPart")
        seat = None
        committees: list[str] = []
        note = ""
        if txt_part:
            ul = txt_part.find("ul", recursive=False)
            if ul:
                seat_val = extract_field(ul, "議席番号")
                if isinstance(seat_val, str):
                    m = re.search(r"\d+", seat_val)
                    if m:
                        seat = int(m.group(0))
                com_val = extract_field(ul, "所属委員会")
                if isinstance(com_val, list):
                    committees = com_val
                elif isinstance(com_val, str) and com_val and com_val != "なし":
                    committees = [com_val]
                note_val = extract_field(ul, "備考")
                if isinstance(note_val, str):
                    note = note_val

        member = {
            "seat_number": seat if seat is not None else len(members) + 1,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": "",
            "committees": committees,
        }
        if note:
            member["note"] = note
        members.append(member)
        print(f"  [{member['seat_number']:>2}] {name} ({furigana}) 委員会={committees} 備考={note}")

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データが取得できませんでした")
        return
    payload = {
        "city": "erimo",
        "city_name": "えりも町",
        "source_url": MEMBERS_URL,
        "members": members,
    }
    for out_dir in (DATA_OUT, SITE_OUT):
        out_path = out_dir / "members.json"
        out_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  書き込み: {out_path}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
