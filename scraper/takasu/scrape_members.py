"""
鷹栖町議会 議員名簿スクレイパー
出力: site/data/takasu/members.json
参照: https://www.town.takasu.hokkaido.jp/site/gikai/1165.html
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.takasu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/site/gikai/1165.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "takasu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "takasu"
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
    print("鷹栖町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("ページ取得失敗")
        return []

    full_text = soup.get_text("\n")

    # 「氏名(ふりがな)：氏名（ふりがな）」のパターンを抽出
    # 例: 氏名(ふりがな)：大石　隆（おおいし たかし)
    member_blocks = re.findall(
        r'氏名\(ふりがな\)[：:]\s*([^\n（(]+)[（(]([^)）\n]+)[)）]',
        full_text
    )

    if not member_blocks:
        print("  議員情報が見つかりませんでした")
        return []

    # 委員会情報を各議員に紐付けるため、テキストをブロック分割
    # 役職ごとのセクションを解析する
    committee_map: dict[str, list[str]] = {}  # name -> [committee roles]
    role_map: dict[str, str] = {}  # name -> 議長/副議長など

    # テキストをブロック分割して役職を把握
    lines = full_text.split("\n")
    current_committee = ""
    current_role = ""
    current_name = ""

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # 委員会名の検出（例: 「総務文教常任委員会」で終わる行）
        if line.endswith('常任委員会'):
            current_committee = line.strip()
            continue

        # 役職の検出
        if line in ("議長", "副議長"):
            current_role = line
            current_committee = ""
            continue
        if line in ("委員長", "副委員長", "委員"):
            current_role = line
            continue

        # 氏名の検出
        m = re.match(r'氏名\(ふりがな\)[：:]\s*([^\n（(]+)[（(]([^)）\n]+)[)）]', line)
        if m:
            name = re.sub(r'\s+', '', m.group(1)).strip()
            current_name = name
            # 役職・委員会をマッピング
            if name not in committee_map:
                committee_map[name] = []
            if current_committee and current_role:
                role_label = f"{current_committee}{current_role}"
                if role_label not in committee_map[name]:
                    committee_map[name].append(role_label)
            elif current_role in ("議長", "副議長"):
                role_map[name] = current_role

    # 重複除去して議員リストを作成
    seen_names = set()
    members = []
    seat_number = 1

    # テキスト順（出現順）に一意の議員を収集
    for raw_name, raw_kana in member_blocks:
        name = re.sub(r'\s+', '', raw_name).strip()
        furigana = re.sub(r'\s+', ' ', raw_kana).strip()

        if name in seen_names:
            continue
        seen_names.add(name)

        committees = committee_map.get(name, [])
        faction = role_map.get(name, "")

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": "無所属",
            "faction": faction,
            "committees": committees,
            "photo_url": "",
        }
        print(f"  [{seat_number}] {name}（{furigana}）{faction} {committees}")
        members.append(member)
        seat_number += 1

    return members


def main():
    members = scrape_members()

    if not members:
        print("取得不可: 議員データをHTMLから抽出できませんでした")
        return

    out_path = OUTPUT_DIR / "members.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(members)}名 -> {out_path}")


if __name__ == "__main__":
    main()
