"""
黒松内町議会 議員名簿スクレイパー
出力: site/data/kuromatsunai/members.json

取得元: http://kuromatsunai-news.sblo.jp/article/190694884.html
（黒松内町公式サイト towninfo/ からリンクされている「黒松内町議会」公式情報公開ページ）

議員氏名・ふりがなはページ本文に Shift_JIS テキストで
「N番　氏名（ふりがな）<br />」形式で掲載されている。
写真・会派・政党・委員会の情報はこのページでは公表されていない。
ハードコード禁止、全てDOMから動的取得する。
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

URL = "http://kuromatsunai-news.sblo.jp/article/190694884.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "kuromatsunai"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
ROOT_OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "kuromatsunai"
ROOT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}

# 全角→半角数字
ZEN_TO_HAN = str.maketrans("０１２３４５６７８９", "0123456789")

# 「N番 氏名（ふりがな）」行（全角・半角空白どちらにも対応）
# 氏名部分はアラインメント用の空白が挟まることがあるため非貪欲に取り、
# 後段でホワイトスペース正規化する。
MEMBER_LINE_RE = re.compile(
    r"^([０-９0-9]+)\s*番\s+(.+?)\s*[（(]\s*(.+?)\s*[）)]\s*$"
)


def normalize_ws(s: str) -> str:
    s = s.replace("\u3000", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def scrape():
    print(f"黒松内町議会 議員名簿を収集中... {URL}")
    resp = requests.get(URL, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    # Shift_JIS 明示
    resp.encoding = "shift_jis"
    soup = BeautifulSoup(resp.text, "html.parser")

    # 記事本文の div.text を取得（Seesaaブログ標準構造）
    text_div = soup.find("div", class_="text")
    if text_div is None:
        print("  [ERROR] 記事本文 div.text が見つかりません")
        return None

    # <br> は get_text(separator=) で改行化（replace_with はインラインの
    # タグが挟まる場合に階層が潰れる挙動のため使わない）
    raw_text = text_div.get_text(separator="\n")
    lines = [normalize_ws(l) for l in raw_text.split("\n")]

    members = []
    seen_seats: set[int] = set()

    for line in lines:
        if not line:
            continue
        m = MEMBER_LINE_RE.match(line)
        if not m:
            continue
        seat_zen, name_raw, furigana_raw = m.groups()
        seat_num = int(seat_zen.translate(ZEN_TO_HAN))
        if seat_num in seen_seats:
            continue
        seen_seats.add(seat_num)

        # 氏名は全角スペースで姓名区切り、単姓の場合アラインメント用に複数空白
        # が入っているのでホワイトスペースを 1 つの半角スペースにまとめる
        name = normalize_ws(name_raw)
        furigana = normalize_ws(furigana_raw)

        members.append({
            "seat_number": seat_num,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": "",
            "committees": [],
        })

    if not members:
        print("  [ERROR] 議員が1名も抽出できませんでした")
        return None

    members.sort(key=lambda x: x["seat_number"])

    for out_dir in (OUTPUT_DIR, ROOT_OUTPUT_DIR):
        out_path = out_dir / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  {len(members)}名を {out_path} に保存しました")

    return members


if __name__ == "__main__":
    result = scrape()
    if result:
        for m in result:
            print(f"  [{m['seat_number']}] {m['name']} ({m['furigana']})")
