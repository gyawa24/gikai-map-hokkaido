"""
浜頓別町議会 議員名簿スクレイパー
出力: data/hamatombetsu/members.json, site/data/hamatombetsu/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "http://www.town.hamatonbetsu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/town/detail.php?content=39"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "hamatombetsu"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "hamatombetsu"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "hamatombetsu"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

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


def normalize_name(s: str) -> str:
    # 全角スペース/半角スペースを除去して姓名を連結した比較用キーを返す
    return re.sub(r"[\s\u3000]+", "", s)


def parse_members_table(soup: BeautifulSoup) -> list[dict]:
    """議席番号/氏名/当選回数/党派のテーブルから議員を抽出"""
    members = []
    for table in soup.find_all("table"):
        headers = [th.get_text(strip=True) for th in table.find_all("th")]
        if not any("議席" in h for h in headers):
            continue
        for tr in table.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 4:
                continue
            seat_text = tds[0].get_text(strip=True)
            if not seat_text.isdigit():
                continue
            seat_number = int(seat_text)
            name = tds[1].get_text(strip=True)
            # 当選回数 tds[2] は使わない
            party = tds[3].get_text(strip=True)
            members.append({
                "seat_number": seat_number,
                "name": name,
                "furigana": "",
                "party": party,
                "faction": "",
                "committees": [],
            })
        if members:
            break
    return members


def parse_positions_and_committees(soup: BeautifulSoup, members: list[dict]) -> None:
    """議長/副議長/委員会情報を本文から抽出して各議員に付与"""
    # detail本文全体からテキストを取り出す
    text_blocks = []
    for div in soup.find_all(class_="container_detail"):
        text_blocks.append(div.get_text("\n", strip=False))
    body_text = "\n".join(text_blocks)
    # <br /> はすでに text() 経由で改行化されているはず
    lines = [re.sub(r"[\s\u3000]+", "", ln) for ln in body_text.splitlines()]
    full = "\n".join(lines)

    by_key = {normalize_name(m["name"]): m for m in members}

    def add_role(name_key: str, role: str) -> None:
        m = by_key.get(name_key)
        if m and role not in m["committees"]:
            m["committees"].append(role)

    # 議長・副議長
    m_giin = re.search(r"議長([^\n●]+)", full)
    if m_giin:
        add_role(normalize_name(m_giin.group(1)), "議長")
    m_fuku = re.search(r"副議長([^\n●]+)", full)
    if m_fuku:
        add_role(normalize_name(m_fuku.group(1)), "副議長")

    # 委員会パート（●で区切られたブロックごとに処理）
    blocks = re.split(r"●", full)
    for block in blocks:
        if not block.strip():
            continue
        # 先頭行＝見出し
        head_match = re.match(r"([^\n]+)", block)
        if not head_match:
            continue
        heading = head_match.group(1)
        # 見出しから「常任委員会」等の一般見出しは飛ばし、個別委員会名を拾う
        # サブブロック: ＜...委員会＞ 単位で分割
        sub_blocks = re.split(r"[＜<]([^＞>]+)[＞>]", block)
        # sub_blocks = [before, name1, body1, name2, body2, ...]
        if len(sub_blocks) >= 3:
            for i in range(1, len(sub_blocks) - 1, 2):
                com_name = sub_blocks[i].strip()
                com_body = sub_blocks[i + 1]
                assign_committee_roles(com_name, com_body, add_role)
        else:
            # 直接 "●XXX委員会\n ..." 形式
            com_name = heading.strip()
            com_body = block[len(heading):]
            if "委員" in com_name or "監査" in com_name or "組合" in com_name:
                assign_committee_roles(com_name, com_body, add_role)


def assign_committee_roles(com_name: str, body: str, add_role) -> None:
    """委員会名と本文テキストから委員長/副委員長/委員を割り当て"""
    # 委員長
    m = re.search(r"委員長[・:\s]*([^副委員長委\s、]+)", body)
    if m:
        add_role(normalize_name(m.group(1)), f"{com_name}委員長")
    m = re.search(r"副委員長[・:\s]*([^委員\s、]+)", body)
    if m:
        add_role(normalize_name(m.group(1)), f"{com_name}副委員長")
    # 委員行: "委員・・・A、B、C"
    m = re.search(r"委[　\s]*員[・:]+([^\n]+)", body)
    if m:
        names = re.split(r"[、,]", m.group(1))
        for n in names:
            n = n.strip()
            if not n:
                continue
            # 末尾の区切り記号を除去
            n = re.sub(r"[　\s]+$", "", n)
            if n:
                add_role(normalize_name(n), f"{com_name}委員")
    # 監査委員のように本文が単に氏名のみのパターン
    if "監査" in com_name and not re.search(r"委員長|副委員長", body):
        names = re.findall(r"[一-龥々]{1,4}[　\s]*[一-龥々ぁ-んァ-ヶ]+", body)
        for n in names:
            add_role(normalize_name(n), com_name)
    # 組合議会議員
    if "組合" in com_name:
        names = re.split(r"[、,]", body)
        for n in names:
            n = n.strip()
            if not n or "議員" in n or len(n) < 2:
                continue
            add_role(normalize_name(n), com_name)


def main():
    print("浜頓別町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    members = parse_members_table(soup)
    if not members:
        print("  議員テーブルが見つかりませんでした")
        return

    parse_positions_and_committees(soup, members)

    # 議席番号順にソート
    members.sort(key=lambda m: m["seat_number"])

    out_path = DATA_DIR / "members.json"
    site_path = SITE_DATA_DIR / "members.json"
    payload = json.dumps(members, ensure_ascii=False, indent=2)
    out_path.write_text(payload, encoding="utf-8")
    site_path.write_text(payload, encoding="utf-8")

    print(f"  取得議員数: {len(members)}名")
    for m in members:
        print(f"    席{m['seat_number']} {m['name']} / {m['party']} / {', '.join(m['committees'])}")
    print(f"  出力: {out_path}")
    print(f"  出力: {site_path}")


if __name__ == "__main__":
    main()
