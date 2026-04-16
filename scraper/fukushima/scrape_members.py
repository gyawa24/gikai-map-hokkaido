"""
福島町議会 議員名簿スクレイパー
出力: data/fukushima/members.json

データ取得先:
- 議会の構成・議員名簿: https://www.town.fukushima.hokkaido.jp/gikai/（議会構成・議員名簿）
- 政務活動費活用状況: https://www.town.fukushima.hokkaido.jp/gikai/（令和6年度ページ）
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.fukushima.hokkaido.jp/gikai"
# WordPress API で議員名簿ページ(ID=674)と政務活動費ページ(ID=10990)を取得
MEMBERS_PAGE_API = f"{BASE_URL}/wp-json/wp/v2/pages/674"
EXPENSES_PAGE_API = f"{BASE_URL}/wp-json/wp/v2/pages/10990"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "fukushima"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "fukushima"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch_json(url: str) -> dict | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def get_roles_from_members_page() -> dict[str, str]:
    """議員名簿ページから役職情報を取得"""
    print("議員名簿ページから役職情報を取得中...")
    data = fetch_json(MEMBERS_PAGE_API)
    if not data:
        return {}

    soup = BeautifulSoup(data["content"]["rendered"], "html.parser")
    text = soup.get_text(separator="\n", strip=True)
    lines = [l.strip() for l in text.split("\n") if l.strip()]

    roles = {}
    role_map = {
        "議　　長": "議長",
        "副　議　長": "副議長",
        "議会運営委員長": "議会運営委員長",
        "総務教育常任委員長": "総務教育常任委員長",
        "経済福祉常任委員長": "経済福祉常任委員長",
    }

    i = 0
    while i < len(lines) - 1:
        role_label = lines[i]
        for key, role in role_map.items():
            # 全角スペースを除去してマッチ
            if key.replace("\u3000", "") == role_label.replace("\u3000", "").replace(" ", ""):
                name = lines[i + 1].replace("\u3000", "").replace(" ", "").replace("　", "")
                roles[name] = role
                print(f"  役職: {name} -> {role}")
                break
        i += 1

    return roles


def get_members_from_expenses_page() -> list[dict]:
    """政務活動費ページから議員一覧を取得（議席番号・氏名）"""
    print("政務活動費ページから議員一覧を取得中...")
    data = fetch_json(EXPENSES_PAGE_API)
    if not data:
        return []

    soup = BeautifulSoup(data["content"]["rendered"], "html.parser")
    members = []

    # テーブルから議席・氏名を抽出
    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["td", "th"])
            # 議席番号 + 氏名 のペアを2組含む行を処理
            cell_texts = [c.get_text(strip=True) for c in cells]
            # ペアで処理: [席番, 氏名, 席番, 氏名]
            pairs = []
            i = 0
            while i < len(cell_texts) - 1:
                seat_text = cell_texts[i].strip()
                name_text = cell_texts[i + 1].strip()
                if re.match(r'^[１-１０\d]+$', seat_text) or re.match(r'^\d+$', seat_text):
                    # 全角数字を半角に変換
                    seat_num = seat_text.translate(str.maketrans('０１２３４５６７８９', '0123456789'))
                    try:
                        seat_int = int(seat_num)
                        if name_text and name_text != "欠　員" and name_text != "欠員":
                            name_clean = name_text.replace("　", "").replace(" ", "")
                            pairs.append((seat_int, name_clean))
                    except ValueError:
                        pass
                i += 2
            members.extend(pairs)

    # 重複除去・ソート
    seen = set()
    unique = []
    for seat, name in sorted(members):
        if (seat, name) not in seen:
            seen.add((seat, name))
            unique.append((seat, name))

    print(f"  議員 {len(unique)} 名発見")
    for seat, name in unique:
        print(f"    席{seat}: {name}")

    return unique


def scrape_members():
    print("福島町議会 議員名簿を収集中...")

    # 役職情報を取得
    roles = get_roles_from_members_page()
    time.sleep(0.5)

    # 議員一覧を取得
    member_list = get_members_from_expenses_page()
    time.sleep(0.5)

    members = []
    for seat_num, name in member_list:
        # 役職確認
        role = roles.get(name, "")

        # 委員会情報（役職から推定）
        committees = []
        if "総務教育常任委員長" in role:
            committees = ["総務教育常任委員会"]
        elif "経済福祉常任委員長" in role:
            committees = ["経済福祉常任委員会"]
        elif "議会運営委員長" in role:
            committees = ["議会運営委員会"]

        member = {
            "seat_number": seat_num,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": committees,
            "photo_url": "",
            "role": role,
        }
        members.append(member)
        print(f"  [{seat_num}] {name} / {role}")

    # 議席順にソート
    members.sort(key=lambda m: m["seat_number"])

    # 保存
    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(members)} 名 -> {output_path}")
    return members


if __name__ == "__main__":
    members = scrape_members()
    print(f"\n取得議員数: {len(members)}名")
