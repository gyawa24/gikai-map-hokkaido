"""
浦河町議会 議員名簿スクレイパー
出力: site/data/urakawa/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.urakawa.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gyosei/council/?content=770"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "urakawa"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "urakawa"
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


def clean_text(s: str) -> str:
    # 連続した空白・改行を単一スペースに、前後の空白を削除
    return re.sub(r"\s+", " ", s).strip()


def parse_table_to_dict(table) -> dict:
    """th→td の表から {ラベル: 値} の辞書を作る。"""
    data = {}
    for tr in table.find_all("tr"):
        th = tr.find("th")
        td = tr.find("td")
        if not th or not td:
            continue
        key = clean_text(th.get_text(" ", strip=True))
        # <br> を改行に変換してから正規化
        for br in td.find_all("br"):
            br.replace_with("\n")
        raw = td.get_text("\n", strip=True)
        # 値内の改行は「/」で結合（会派が複数行で書かれているケース対応）
        lines = [ln.strip() for ln in raw.split("\n") if ln.strip()]
        data[key] = "/".join(lines)
    return data


def scrape_members() -> bool:
    print("浦河町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return False

    # 「議席番号N」見出しを全件抽出
    headings = soup.find_all("h2", class_="c-secTtl02")
    seat_headings = [
        h for h in headings if re.search(r"議席番号\s*\d+", h.get_text(strip=True))
    ]
    print(f"  議席見出し {len(seat_headings)} 件発見")
    if not seat_headings:
        print("  議席見出しが見つかりません")
        return False

    members = []
    for h in seat_headings:
        m = re.search(r"議席番号\s*(\d+)", h.get_text(strip=True))
        if not m:
            continue
        seat = int(m.group(1))

        # 見出しの後続兄弟ノードから最初のテーブルを探す
        table = None
        for sib in h.find_all_next():
            if sib.name == "h2" and "c-secTtl02" in (sib.get("class") or []):
                break
            if sib.name == "table":
                table = sib
                break
        if table is None:
            print(f"  [議席{seat}] テーブルなし、スキップ")
            continue

        info = parse_table_to_dict(table)
        name = info.get("氏名", "")
        furigana = info.get("ふりがな", "")
        faction = info.get("会派", "")
        if not name:
            print(f"  [議席{seat}] 氏名取得失敗、スキップ")
            continue

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": faction,
            "committees": [],
        }
        members.append(member)
        print(f"  [議席{seat}] {name} ({furigana}) / 会派: {faction}")

    if not members:
        print("  議員データが抽出できませんでした")
        return False

    members.sort(key=lambda x: x["seat_number"])

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n取得議員数: {len(members)}名")
    print(f"出力: {output_path}")
    return True


if __name__ == "__main__":
    ok = scrape_members()
    exit(0 if ok else 1)
