"""
増毛町議会 議員名簿スクレイパー
出力: data/mashike/members.json
        site/data/mashike/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.mashike.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/division/gikai/gikaikosei.html"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "mashike"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "mashike"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "mashike"

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
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize_name(s: str) -> str:
    """全角/半角スペース除去・前後空白除去"""
    return re.sub(r"[\s\u3000]+", "", s or "").strip()


def katakana_to_hiragana(s: str) -> str:
    result = []
    for ch in s:
        code = ord(ch)
        if 0x30A1 <= code <= 0x30F6:
            result.append(chr(code - 0x60))
        else:
            result.append(ch)
    return "".join(result)


def parse_members_table(soup: BeautifulSoup) -> list[dict]:
    """議員一覧の表（議席番号/氏名/シメイ/性別/年齢/党派/期数）を抽出"""
    members = []
    for table in soup.find_all("table"):
        header_row = table.find("tr")
        if not header_row:
            continue
        header_text = header_row.get_text()
        # ヘッダに「議席」「氏名」が含まれる表を議員一覧とみなす
        if "議席" not in header_text or "氏名" not in header_text:
            continue

        for tr in table.find_all("tr")[1:]:
            cells = [td.get_text(strip=True) for td in tr.find_all("td")]
            if len(cells) < 7:
                continue
            seat_raw, name_raw, kana_raw, _sex, _age, party_raw, _term = cells[:7]
            if not seat_raw.isdigit():
                continue
            name = normalize_name(name_raw)
            kana_kata = normalize_name(kana_raw)
            furigana = katakana_to_hiragana(kana_kata)
            # 姓名の区切りを復元（ふりがなの切れ目から推定できないので名前はそのまま）
            members.append({
                "seat_number": int(seat_raw),
                "name": name,
                "furigana": furigana,
                "party": party_raw.strip(),
                "faction": "",
                "committees": [],
            })
        if members:
            break
    return members


def parse_committees(soup: BeautifulSoup) -> dict[str, list[str]]:
    """委員会セクションから {正規化氏名: [委員会名,...]} を構築"""
    assignments: dict[str, list[str]] = {}

    # h4タグに委員会名が入っている
    for h4 in soup.find_all("h4"):
        title = h4.get_text(strip=True)
        # "総務文教常任委員会 現員 ４人（定数 ５人）" のような形式
        # 非貪欲の +? は最低1文字を要求するため「議会運営委員会」等の短タイトルに対応できるよう、
        # まず「…委員会」全般を受け、残余テキストで絞り込む
        m = re.match(r"([^\s　]+?委員会)", title)
        if not m:
            continue
        committee_name = m.group(1)

        # 直後の ul から委員を抽出
        ul = h4.find_next_sibling("ul")
        if not ul:
            continue
        for li in ul.find_all("li"):
            text = li.get_text(strip=True)
            # "委員長 酒井 倫明" / "副委員長 上野 剛" / "委員 松倉 清道、合羽井 達男"
            m2 = re.match(r"^(委員長|副委員長|委員)\s*(.+)$", text)
            if not m2:
                continue
            names_part = m2.group(2)
            # 「、」で分割
            for name in re.split(r"[、,]", names_part):
                key = normalize_name(name)
                if not key:
                    continue
                assignments.setdefault(key, []).append(committee_name)

    return assignments


def parse_leadership(soup: BeautifulSoup) -> dict[str, str]:
    """議長・副議長を抽出: {正規化氏名: '議長'|'副議長'}"""
    roles = {}
    for li in soup.find_all("li"):
        text = li.get_text(strip=True)
        m = re.match(r"^(議長|副議長)\s*(.+)$", text)
        if m:
            roles[normalize_name(m.group(2))] = m.group(1)
    return roles


def scrape_members():
    print("増毛町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    members = parse_members_table(soup)
    if not members:
        print("  議員一覧の表が見つかりませんでした")
        return None

    print(f"  議員 {len(members)} 名を表から取得")

    committee_map = parse_committees(soup)
    leadership = parse_leadership(soup)

    for m in members:
        key = normalize_name(m["name"])
        if key in committee_map:
            # 重複除去しつつ順序保持
            seen = set()
            uniq = []
            for c in committee_map[key]:
                if c not in seen:
                    seen.add(c)
                    uniq.append(c)
            m["committees"] = uniq
        if key in leadership:
            m["faction"] = leadership[key]

    return members


def write_json(members: list[dict]):
    for out_dir in (DATA_DIR, SITE_DATA_DIR):
        path = out_dir / "members.json"
        path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き込み: {path}")


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員一覧の動的取得に失敗")
        return
    write_json(members)
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
