"""
南富良野町議会 議員名簿スクレイパー
出力: site/data/minamifurano/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.minamifurano.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/%e8%ad%b0%e4%bc%9a%e5%af%a9%e8%ad%b0%e3%81%ab%e3%81%a4%e3%81%84%e3%81%a6/"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "minamifurano"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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


def parse_name_furigana(cell_text: str) -> tuple[str, str]:
    """「氏名\n（ふりがな）」形式から氏名とふりがなを抽出する"""
    text = cell_text.strip()
    m = re.search(r"（([^）]+)）", text)
    furigana = m.group(1).strip() if m else ""
    name = re.sub(r"（[^）]+）", "", text).strip()
    # 全角スペースを半角に統一
    name = re.sub(r"\u3000", " ", name).strip()
    furigana = re.sub(r"\u3000", " ", furigana).strip()
    return name, furigana


def scrape_members():
    print("南富良野町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    # 議長・副議長を本文テキストから抽出
    body_text = soup.get_text(separator="\n")
    speaker = ""
    deputy_speaker = ""
    m_speaker = re.search(r"議\s*長\s*([^\n副]+)", body_text)
    if m_speaker:
        speaker = re.sub(r"\s+", " ", m_speaker.group(1)).strip()
    m_deputy = re.search(r"副議長\s*([^\n]+)", body_text)
    if m_deputy:
        deputy_speaker = re.sub(r"\s+", " ", m_deputy.group(1)).strip()

    print(f"  議長: {speaker}, 副議長: {deputy_speaker}")

    # tablepress テーブルから議員データ取得
    table = soup.find("table", class_=re.compile(r"tablepress"))
    if table is None:
        print("  議員テーブルが見つかりませんでした")
        return

    members = []
    rows = table.find("tbody").find_all("tr")
    for row in rows:
        cols = row.find_all("td")
        if len(cols) < 2:
            continue

        seat_text = cols[0].get_text(strip=True)
        name_cell = cols[1].get_text(separator="\n", strip=True)

        # 空行（欠員）はスキップ
        if not seat_text or not name_cell:
            continue

        # 全角数字を半角に変換して議席番号を取得
        seat_text = seat_text.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
        try:
            seat_number = int(seat_text)
        except ValueError:
            continue

        name, furigana = parse_name_furigana(name_cell)
        if not name:
            continue

        # 役職判定
        role = ""
        if name.replace(" ", "　") == speaker or name == speaker:
            role = "議長"
        elif name.replace(" ", "　") == deputy_speaker or name == deputy_speaker:
            role = "副議長"

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": "",
            "role": role,
            "committees": [],
            "photo_url": "",
        }
        members.append(member)
        print(f"  [{seat_number}] {name}（{furigana}）{' / ' + role if role else ''}")

    if not members:
        print("  議員データが取得できませんでした")
        return

    output_path = OUTPUT_DIR / "members.json"
    output_path.write_text(json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完了: {len(members)} 名 -> {output_path}")


if __name__ == "__main__":
    scrape_members()
