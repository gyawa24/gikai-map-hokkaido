"""
羽幌町議会 議員名簿スクレイパー
出力: data/haboro/members.json と site/data/haboro/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.haboro.lg.jp"
MEMBERS_URL = f"{BASE_URL}/gikai-iinkai/gikai/meibo.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIRS = [
    ROOT / "data" / "haboro",
    ROOT / "site" / "data" / "haboro",
]
for d in OUTPUT_DIRS:
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def normalize_name(s: str) -> str:
    """全角・半角スペースを除去して比較用に正規化"""
    return re.sub(r"[\s\u3000]+", "", s or "")


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def parse_members(soup: BeautifulSoup) -> list[dict]:
    """議員名簿テーブルから議員情報を抽出"""
    members = []
    for table in soup.find_all("table", class_="table_normal"):
        caption = table.find("caption")
        if not caption or "一覧" not in caption.get_text():
            continue
        for tr in table.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 2:
                continue
            seat_text = tds[0].get_text(strip=True)
            if not seat_text.isdigit():
                continue
            seat = int(seat_text)
            name_cell = tds[1].get_text(" ", strip=True)
            # 例: "佐藤　　満（さとう　みつる）"
            m = re.match(r"^(.+?)[（(](.+?)[）)]", name_cell)
            if m:
                name = re.sub(r"[\s\u3000]+", "", m.group(1))
                furigana = re.sub(r"[\s\u3000]+", " ", m.group(2)).strip()
            else:
                name = re.sub(r"[\s\u3000]+", "", name_cell)
                furigana = ""
            members.append({
                "seat_number": seat,
                "name": name,
                "furigana": furigana,
                "party": "",
                "faction": "",
                "committees": [],
                "photo_url": "",
            })
        break
    return members


def parse_committee_tables(soup: BeautifulSoup, members: list[dict]):
    """委員会テーブルから各議員の所属委員会を抽出"""
    name_to_member = {normalize_name(m["name"]): m for m in members}

    def has_committee(member: dict, committee_name: str) -> bool:
        return any(
            c == committee_name or c.startswith(f"{committee_name}（")
            for c in member["committees"]
        )

    def add_committee(person_name: str, committee_name: str, role: str = ""):
        key = normalize_name(person_name)
        if key not in name_to_member:
            return
        member = name_to_member[key]
        if not role and has_committee(member, committee_name):
            # 既に役職付きで登録済み → 重複登録しない
            return
        label = f"{committee_name}（{role}）" if role else committee_name
        if label not in member["committees"]:
            member["committees"].append(label)

    def names_from_cell(cell) -> list[str]:
        # <br/> 区切りの氏名リスト
        text = cell.get_text("\n", strip=True)
        return [n.strip() for n in text.split("\n") if n.strip()]

    for table in soup.find_all("table", class_="table_normal"):
        caption = table.find("caption")
        if not caption:
            continue
        cap_text = caption.get_text(strip=True)
        if cap_text == "一覧":
            continue

        headers = [th.get_text(strip=True) for th in table.find_all("th")]
        rows = table.find_all("tr")[1:]

        for tr in rows:
            tds = tr.find_all("td")
            if not tds:
                continue
            committee_name = tds[0].get_text(strip=True)

            # ヘッダ構造: 委員会 / 委員長 / 副委員長 / 委員
            #            委員会 / 会長 / 副会長 / 幹事 (議会議員会)
            #            一部事務組合 / 議員 (一部事務組合)
            if len(headers) >= 4 and len(tds) >= 4:
                role_chair = headers[1]   # 委員長 or 会長
                role_vice = headers[2]    # 副委員長 or 副会長
                role_member = headers[3]  # 委員 or 幹事

                for nm in names_from_cell(tds[1]):
                    add_committee(nm, committee_name, role_chair)
                for nm in names_from_cell(tds[2]):
                    add_committee(nm, committee_name, role_vice)
                for nm in names_from_cell(tds[3]):
                    if nm == "議員全員":
                        for m in members:
                            add_committee(m["name"], committee_name)
                    else:
                        add_committee(nm, committee_name)
            elif len(headers) >= 2 and len(tds) >= 2:
                # 一部事務組合: 委員会 / 議員
                for nm in names_from_cell(tds[1]):
                    add_committee(nm, committee_name)


def parse_roles(soup: BeautifulSoup, members: list[dict]):
    """議長・副議長・監査委員などの役職を抽出"""
    name_to_member = {normalize_name(m["name"]): m for m in members}
    member_names = sorted(name_to_member.keys(), key=len, reverse=True)

    # 役職表記とそれを示すラベルを定義（最長一致のため副議長を先に判定）
    role_labels = [
        ("副議長", "副議長"),
        ("監査委員（議会選出）", "監査委員（議会選出）"),
        ("議長", "議長"),
    ]

    for p in soup.find_all("p"):
        # 名前内の全角空白も含めて全空白を除去してから判定
        text = re.sub(r"[\s\u3000]+", "", p.get_text())
        for prefix, label in role_labels:
            if not text.startswith(prefix):
                continue
            remainder = text[len(prefix):]
            for name_key in member_names:
                if remainder.startswith(name_key):
                    member = name_to_member[name_key]
                    if label in ("議長", "副議長"):
                        member["faction"] = label
                    if label not in member["committees"]:
                        member["committees"].insert(0, label)
                    break
            break


def scrape():
    print("羽幌町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    members = parse_members(soup)
    if not members:
        print("  議員一覧が見つかりませんでした")
        return

    print(f"  議員 {len(members)} 名を抽出")
    parse_committee_tables(soup, members)
    parse_roles(soup, members)

    members.sort(key=lambda m: m["seat_number"])

    payload = {
        "source_url": MEMBERS_URL,
        "members": members,
    }

    for d in OUTPUT_DIRS:
        out = d / "members.json"
        out.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {out}")

    for m in members:
        print(f"  [{m['seat_number']:2d}] {m['name']} ({m['furigana']}) - {', '.join(m['committees']) or '(委員会未割当)'}")


if __name__ == "__main__":
    scrape()
