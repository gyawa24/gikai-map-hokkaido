"""
釧路町議会 議員名簿スクレイパー
出力: site/data/kushirocho/members.json

データソース（公式サイト）:
  - 議員名簿: http://www.town.kushiro.lg.jp/gikai/meibo.html
  - 委員会・会派: http://www.town.kushiro.lg.jp/gikai/iinmeibo.html
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "http://www.town.kushiro.lg.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/meibo.html"
COMMITTEES_URL = f"{BASE_URL}/gikai/iinmeibo.html"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "kushirocho"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 委員会名簿と会派名簿で使われる空白（全角・半角）を除去して比較するためのキー
def normalize_name(name: str) -> str:
    return re.sub(r"[\s　]+", "", name or "")


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
    """
    meibo.html のテーブルから議員リストを抽出する。
    セル[0]: "氏名（ふりがな）" の書式。
    議席番号は公式ページに明示されていないため、掲載順を seat_number とする。
    """
    members: list[dict] = []
    hontai = soup.find(id="Hontai")
    if hontai is None:
        return members

    table = hontai.find("table")
    if table is None:
        return members

    for tr in table.find_all("tr"):
        tds = tr.find_all("td")
        if not tds:
            continue
        raw_name = tds[0].get_text(strip=True)
        # "梅津加代子（うめつかよこ）" を name / furigana に分離
        m = re.match(r"^(.*?)[（(]([ぁ-んー\s　]+)[）)]\s*$", raw_name)
        if m:
            name = m.group(1).strip()
            furigana = re.sub(r"[\s　]+", "", m.group(2))
        else:
            name = raw_name
            furigana = ""
        if not name:
            continue
        members.append({
            "seat_number": len(members) + 1,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        })
    return members


def parse_committees_and_factions(soup: BeautifulSoup) -> tuple[dict, dict]:
    """
    iinmeibo.html から委員会と会派情報を抽出する。
    ページは見出し(h3, h4相当) + テーブル/リスト構造が混在するため、
    全テキスト行を順次走査して現在の委員会／会派コンテキストを追跡する。

    戻り値:
      committees_by_name: {正規化氏名: [{"name": 委員会名, "role": 委員長/副委員長/委員}, ...]}
      factions_by_name:   {正規化氏名: 会派名}
    """
    committees_by_name: dict[str, list[dict]] = {}
    factions_by_name: dict[str, str] = {}

    hontai = soup.find(id="Hontai")
    if hontai is None:
        return committees_by_name, factions_by_name

    # タグ単位ではなくテキストノードを行単位で走査するため、get_text を利用
    raw = hontai.get_text("\n", strip=True)
    lines = [ln for ln in raw.split("\n") if ln]

    committee_keywords = ("委員会",)
    faction_header_keywords = (
        "党派・会派名簿", "会派名簿",
    )
    # 会派判定ロジック用: 党派・会派セクションに入ったかどうかのフラグ
    in_faction_section = False

    current_committee: str | None = None
    current_role: str | None = None
    current_faction: str | None = None

    role_tokens = {"委員長", "副委員長", "委員", "代表"}

    for line in lines:
        # セクション切替
        if any(k in line for k in faction_header_keywords):
            in_faction_section = True
            current_committee = None
            current_role = None
            current_faction = None
            continue

        if not in_faction_section:
            # 委員会セクション
            if line.endswith("委員会"):
                current_committee = line
                current_role = None
                continue
            if line in role_tokens:
                current_role = line
                continue
            # 氏名行
            if current_committee and current_role:
                name_key = normalize_name(line)
                if not name_key:
                    continue
                committees_by_name.setdefault(name_key, []).append({
                    "name": current_committee,
                    "role": current_role,
                })
        else:
            # 会派セクション
            # "日本共産党", "公明党", "会派 町政クラブ", "会派 町民連合", "無所属" などが会派見出し
            if line in {"日本共産党", "公明党", "無所属"} or line.startswith("会派"):
                # "会派 町政クラブ" → "町政クラブ"
                if line.startswith("会派"):
                    current_faction = line.replace("会派", "", 1).strip()
                else:
                    current_faction = line
                continue
            if line == "代表" or line == "副代表":
                # 役職行はスキップ（会派名のコンテキストはそのまま）
                continue
            # それ以外は氏名行とみなす（釧路町議会事務局などのフッタは別途除外）
            if "議会" in line or "電話" in line or "FAX" in line or "〒" in line or line.startswith("北海道"):
                continue
            name_key = normalize_name(line)
            if name_key and current_faction:
                factions_by_name[name_key] = current_faction

    return committees_by_name, factions_by_name


def scrape():
    print("釧路町議会 議員名簿を収集中...")

    meibo_soup = fetch(MEMBERS_URL)
    if meibo_soup is None:
        print("  議員名簿ページの取得に失敗しました")
        return None

    members = parse_members(meibo_soup)
    if not members:
        print("  議員データが抽出できませんでした")
        return None
    print(f"  議員 {len(members)} 名を抽出")

    iin_soup = fetch(COMMITTEES_URL)
    if iin_soup is not None:
        committees_map, factions_map = parse_committees_and_factions(iin_soup)
    else:
        print("  [WARN] 委員会名簿ページの取得に失敗。会派・委員会は空で出力")
        committees_map, factions_map = {}, {}

    for m in members:
        key = normalize_name(m["name"])
        if key in factions_map:
            m["faction"] = factions_map[key]
            # 党派系（日本共産党・公明党）は party、会派系は faction のみに入れる
            if factions_map[key] in {"日本共産党", "公明党"}:
                m["party"] = factions_map[key]
            elif factions_map[key] == "無所属":
                m["party"] = "無所属"
                m["faction"] = ""
        if key in committees_map:
            m["committees"] = committees_map[key]

    return members


def main():
    members = scrape()
    if members is None:
        print("取得不可: 議員データを生成できませんでした")
        return

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)
    print(f"  出力: {output_path}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
