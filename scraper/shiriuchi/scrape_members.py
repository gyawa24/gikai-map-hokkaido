"""
知内町議会 議員名簿スクレイパー
出力: data/shiriuchi/members.json, site/data/shiriuchi/members.json

公式ページ（HTML テキスト）から議員名・議席番号・役職を動的取得する。
氏名等のハードコードは禁止。
"""

import json
import re
import unicodedata
from pathlib import Path

import requests
from bs4 import BeautifulSoup

MEMBERS_URL = "https://www.town.shiriuchi.hokkaido.jp/chosei/gikai/meibo.html"

ROOT = Path(__file__).parent.parent.parent
OUT_DIRS = [
    ROOT / "data" / "shiriuchi",
    ROOT / "site" / "data" / "shiriuchi",
]
for d in OUT_DIRS:
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


def normalize_name(raw: str) -> str:
    # 全角スペースは残す（姓名区切り）。前後の空白と改行だけ削る。
    return raw.strip().replace("\u3000\u3000", "\u3000")


def parse_roster(soup: BeautifulSoup) -> list[dict]:
    """議長・副議長・議員リストから氏名と議席番号を抽出する。"""
    text_blocks = soup.find_all(["span", "p", "div"])

    chair_name = ""
    vice_chair_name = ""

    # 見出し「議長」「副議長」の直後の span テキストを取得
    for h in soup.find_all(["h1", "h2", "h3", "h4"]):
        title = h.get_text(strip=True)
        sib = h.find_next_sibling()
        # 直後の兄弟が span などでその中に氏名
        if not sib:
            continue
        sib_text = sib.get_text(" ", strip=True)
        if title == "議長" and not chair_name:
            chair_name = normalize_name(sib_text)
        elif title == "副議長" and not vice_chair_name:
            vice_chair_name = normalize_name(sib_text)

    # 議員一覧 span を特定：「定数」を含む見出しの直後の span が本体
    roster_span = None
    for h in soup.find_all(["h1", "h2", "h3", "h4"]):
        if "定数" in h.get_text() and "議席番号" in h.get_text():
            nxt = h.find_next_sibling()
            if nxt:
                roster_span = nxt
                break

    members: list[dict] = []
    if roster_span is None:
        return members

    # <br/> を改行に変換してテキスト化
    for br in roster_span.find_all("br"):
        br.replace_with("\n")
    raw = roster_span.get_text("\n", strip=False)

    # 全角数字→半角
    def z2h_digits(s: str) -> str:
        return unicodedata.normalize("NFKC", s)

    line_pat = re.compile(r"^\s*(\d+)\s*[\.\．。]\s*(.+?)\s*$")

    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        norm = z2h_digits(line)
        m = line_pat.match(norm)
        if not m:
            continue
        seat = int(m.group(1))
        name = normalize_name(m.group(2))
        if not name or len(name) < 2:
            continue

        def strip_ws(s: str) -> str:
            return re.sub(r"\s+", "", s)

        role = ""
        if chair_name and strip_ws(name) == strip_ws(chair_name):
            role = "議長"
        elif vice_chair_name and strip_ws(name) == strip_ws(vice_chair_name):
            role = "副議長"

        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": role,  # 議長/副議長の役職をここに入れる（会派情報は公式HTMLに無い）
            "committees": [],
        })

    return members


def main():
    print("知内町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  [取得不可] ページを取得できませんでした")
        return 1

    members = parse_roster(soup)
    if not members:
        print("  [取得不可] HTML から議員データを抽出できませんでした")
        return 1

    # 議席番号順に並べる
    members.sort(key=lambda x: x["seat_number"])

    for d in OUT_DIRS:
        out = d / "members.json"
        out.write_text(
            json.dumps(members, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  書き出し: {out} ({len(members)} 名)")

    print(f"取得議員数: {len(members)}名")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
