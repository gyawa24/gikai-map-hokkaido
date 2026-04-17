"""
寿都町議会 議員名簿スクレイパー

現状（2026-04時点）、寿都町公式サイトの議員名簿ページは以下の状態:
  - 議員一覧が画像 (cassette_3_img_*.png) に埋め込まれており、HTML には
    議長・副議長の氏名のみしかテキストとして存在しない
  - 議員名簿としての PDF は公開されておらず、公開されている PDF は
    選挙結果（候補者名・得票数）のみで、現行の議席番号・辞職の反映が無い

プロジェクトの厳守事項（画像OCR・学習データ推測によるハードコード禁止）に
従い、両方式とも取得不可と判断した場合は members.json を作成せず終了する。

将来、公式サイトが HTML テキストでの名簿掲載 / 名簿 PDF 公開に切り替えた場合に
再利用できるよう、取得処理の土台は残してある。

参照URL:
  http://www.town.suttu.lg.jp/town/detail.php?id=61
"""

import re
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup

MEMBERS_URL = "http://www.town.suttu.lg.jp/town/detail.php?id=61"

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


def try_html_scrape(soup: BeautifulSoup) -> list[dict]:
    """HTML テキスト中に議員一覧がテーブル/リスト形式で存在すれば抽出する。

    現状の寿都町サイトでは議長・副議長のみしか得られないため、ここでは
    議席番号付きで抽出できる構造が無い限り空リストを返す。
    """
    members: list[dict] = []

    # テーブル形式（議席番号 / 氏名 ... のヘッダを持つもの）を探す
    for table in soup.find_all("table"):
        headers_text = [th.get_text(strip=True) for th in table.find_all("th")]
        if not headers_text:
            continue
        if any("議席" in h for h in headers_text) and any("氏名" in h for h in headers_text):
            # 想定構造: 議席番号, 氏名, 所属/会派, ...
            idx_seat = next((i for i, h in enumerate(headers_text) if "議席" in h), None)
            idx_name = next((i for i, h in enumerate(headers_text) if "氏名" in h), None)
            idx_party = next(
                (i for i, h in enumerate(headers_text) if "所属" in h or "会派" in h),
                None,
            )
            for tr in table.find_all("tr"):
                tds = [td.get_text(strip=True) for td in tr.find_all("td")]
                if not tds or idx_seat is None or idx_name is None:
                    continue
                if idx_seat >= len(tds) or idx_name >= len(tds):
                    continue
                seat_raw = tds[idx_seat]
                name = tds[idx_name]
                if not seat_raw or not name:
                    continue
                seat_match = re.search(r"\d+", seat_raw)
                if not seat_match:
                    continue
                members.append(
                    {
                        "seat_number": int(seat_match.group()),
                        "name": name,
                        "furigana": "",
                        "party": tds[idx_party] if idx_party is not None and idx_party < len(tds) else "",
                        "faction": "",
                        "committees": [],
                    }
                )
            if members:
                return members

    return members


def try_pdf_scrape(soup: BeautifulSoup) -> list[dict]:
    """議員名簿PDF（議席番号付き）が公開されていれば pdfplumber で抽出する。

    現状、リンクされている PDF は選挙結果のみで名簿ではないため、
    「議員名簿」「議員紹介」等のキーワードを含む PDF リンクのみを対象にする。
    """
    members: list[dict] = []
    pdf_candidates = []
    for a in soup.find_all("a", href=True):
        href: str = a["href"]
        if not href.lower().endswith(".pdf"):
            continue
        label = a.get_text(strip=True)
        if any(k in label for k in ("議員名簿", "議員一覧", "議員紹介", "議員名")):
            pdf_candidates.append((label, href))

    if not pdf_candidates:
        return members

    # 実装は PDF 公開後に追加する
    print(f"  [INFO] 議員名簿候補PDF {len(pdf_candidates)} 件検出: 現在未対応")
    return members


def main() -> int:
    print("寿都町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("取得不可: 議員名簿ページの取得に失敗")
        return 1

    members = try_html_scrape(soup)
    if members:
        # 現状ここは到達しないが、将来 HTML テキスト化された際の受け皿
        out_dir = Path(__file__).parent.parent.parent / "site" / "data" / "suttsu"
        out_dir.mkdir(parents=True, exist_ok=True)
        import json
        (out_dir / "members.json").write_text(
            json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"取得議員数: {len(members)}名 (HTML)")
        return 0

    members = try_pdf_scrape(soup)
    if members:
        out_dir = Path(__file__).parent.parent.parent / "site" / "data" / "suttsu"
        out_dir.mkdir(parents=True, exist_ok=True)
        import json
        (out_dir / "members.json").write_text(
            json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"取得議員数: {len(members)}名 (PDF)")
        return 0

    print(
        "取得不可: 議員一覧が画像(PNG)に埋め込まれており、HTMLテキスト/名簿PDFから"
        "動的取得できない。画像OCRや学習データ推測によるハードコードは禁止のため"
        "members.json は作成しない。"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
