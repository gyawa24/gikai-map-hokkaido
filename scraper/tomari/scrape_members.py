"""
泊村議会 議員名簿スクレイパー

泊村公式サイトには議員一覧のHTMLページが存在しない。
「議会だより」PDFのうち、統一地方選挙直後に発行されるものに
「改選後の議員の顔ぶれ」として全議員の氏名・当選回数・議長/副議長が掲載されている。

このスクレイパーは議会だよりページ一覧から、議員紹介が載っているPDFを動的に探し出し、
pdfplumber でテキストを抽出して議員情報を取り出す。

出力: data/tomari/members.json
"""

import json
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup
import pdfplumber

BASE_URL = "https://www.vill.tomari.hokkaido.jp"
GIKAI_INDEX = f"{BASE_URL}/machizukuri/gikai/"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "tomari"
SITE_OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "tomari"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 当選回数（全角数字）
TOSEN_RE = re.compile(r"当選([０-９\d一二三四五六七八九十]+)回")
KANJI_RE = re.compile(r"[\u4e00-\u9fff]")


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def collect_bulletin_page_urls() -> list[str]:
    resp = fetch(GIKAI_INDEX)
    if resp is None:
        return []
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")
    urls = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/machizukuri/gikai/gikaidayori/" in href and href.endswith(".html"):
            full = href if href.startswith("http") else BASE_URL + href
            if full not in urls:
                urls.append(full)
    return urls


def extract_pdf_url(bulletin_page_url: str) -> str | None:
    resp = fetch(bulletin_page_url)
    if resp is None:
        return None
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().endswith(".pdf"):
            return href if href.startswith("http") else BASE_URL + href
    return None


def download_pdf(url: str, dest: Path) -> bool:
    resp = fetch(url)
    if resp is None:
        return False
    dest.write_bytes(resp.content)
    return True


def zenkaku_to_hankaku_digit(s: str) -> str:
    table = str.maketrans("０１２３４５６７８９", "0123456789")
    return s.translate(table)


def kanji_num_to_int(s: str) -> int | None:
    s = zenkaku_to_hankaku_digit(s)
    if s.isdigit():
        return int(s)
    table = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
             "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
    if s in table:
        return table[s]
    if len(s) == 2 and s[0] == "十":
        return 10 + table.get(s[1], 0)
    if len(s) == 2 and s[1] == "十":
        return table.get(s[0], 0) * 10
    if len(s) == 3 and s[1] == "十":
        return table.get(s[0], 0) * 10 + table.get(s[2], 0)
    return None


def clean_name(raw: str) -> str:
    # 半角/全角スペース、制御文字を除去。姓と名の間の空白（半角 "\u3000" ）もすべて削除。
    s = raw.replace("\u3000", "").replace(" ", "")
    s = re.sub(r"[\x00-\x1f\x7f]", "", s)
    return s.strip()


def parse_members_from_words(pdf_path: Path, max_pages: int = 5) -> list[dict]:
    """
    pdfplumber の extract_words を使い、x座標で列を揃えて議員氏名を抽出する。
    バレット号のレイアウト：
      - 氏名行（例: '鎌田耕行', '飯田有二', '長尾透'）が水平に並ぶ
      - その直下に '当選N回' が各列のxレンジに合わせて並ぶ
    手順：
      1) 各ページで '当選N回' の単語を y, x0, x1 と共に収集
      2) 同じ y に並ぶ '当選' 群を「1行」とみなす
      3) その行のすぐ上（yが小さい側、差10-20pt程度）にある漢字単語を
         各 '当選' 単語の x レンジ（少し余裕を取る）に収まるものだけ拾う
      4) 拾った漢字群を x0 昇順で結合して氏名にする
    """
    members: list[dict] = []
    seen_names: set[str] = set()
    row_assignments: list[list[str]] = []  # 各「当選行」で取れた氏名（左→右の順）

    with pdfplumber.open(pdf_path) as pdf:
        for page_index, page in enumerate(pdf.pages[:max_pages]):
            words = page.extract_words(keep_blank_chars=False)
            if not words:
                continue

            tosen_words = [w for w in words if TOSEN_RE.fullmatch(w["text"])]
            if not tosen_words:
                continue

            # 同じ y (top) の '当選' 単語をグループ化（±2pt 許容）
            tosen_words.sort(key=lambda w: (round(w["top"]), w["x0"]))
            rows: list[list[dict]] = []
            for w in tosen_words:
                if rows and abs(w["top"] - rows[-1][0]["top"]) <= 3:
                    rows[-1].append(w)
                else:
                    rows.append([w])

            for row in rows:
                row_y = row[0]["top"]
                row_names: list[str] = []
                # 氏名行は 当選行の直上（y が小さい側）にある。
                # 漢字単語のうち、y が row_y - 28 から row_y - 4 の範囲にあるものを候補に。
                name_candidates = [
                    w for w in words
                    if (row_y - 28) <= w["top"] <= (row_y - 4)
                    and all(KANJI_RE.match(c) for c in w["text"])
                ]
                if not name_candidates:
                    continue

                # '当選' 各列の中心座標を算出し、各漢字を「最も近い列」に割り当てる
                col_centers = [(i, (c["x0"] + c["x1"]) / 2) for i, c in enumerate(row)]
                # 行の想定垂直位置（名前行）を揃える：name_candidates のうち row_y 直上の最頻 y に絞る
                from collections import Counter
                y_vals = [round(w["top"]) for w in name_candidates]
                if not y_vals:
                    continue
                dominant_y = Counter(y_vals).most_common(1)[0][0]
                name_candidates = [w for w in name_candidates if abs(round(w["top"]) - dominant_y) <= 2]

                # 各漢字を最も近い列に割り当て
                col_kanji: dict[int, list[dict]] = {i: [] for i in range(len(row))}
                for w in name_candidates:
                    cx = (w["x0"] + w["x1"]) / 2
                    nearest = min(col_centers, key=lambda ic: abs(ic[1] - cx))
                    idx, center_x = nearest
                    # 極端に離れすぎている場合はスキップ（50pt 以上離れている = 別領域）
                    if abs(center_x - cx) > 60:
                        continue
                    col_kanji[idx].append(w)

                for i, col in enumerate(row):
                    kanji_words = sorted(col_kanji.get(i, []), key=lambda w: w["x0"])
                    if not kanji_words:
                        continue
                    name = clean_name("".join(w["text"] for w in kanji_words))
                    if len(name) < 2 or not all(KANJI_RE.match(c) for c in name):
                        continue
                    tm = TOSEN_RE.match(col["text"])
                    elected_count = kanji_num_to_int(tm.group(1)) if tm else None
                    row_names.append(name)
                    if name in seen_names:
                        for mm in members:
                            if mm["name"] == name and (mm.get("elected_count") or 0) < (elected_count or 0):
                                mm["elected_count"] = elected_count
                        continue
                    seen_names.add(name)
                    members.append({
                        "name": name,
                        "elected_count": elected_count,
                    })
                if row_names:
                    row_assignments.append(row_names)
    return members, row_assignments


def detect_chair_vice_chair(text: str) -> tuple[str | None, str | None]:
    """
    本文から議長・副議長の氏名を特定する。
    『議 長 ： 宇留間 文 宣』『副 議 長 ： 三 浦 弘 文』などの記述を探す。
    """
    # スペースを除去した圧縮テキストを作って探す
    compact = re.sub(r"\s+", "", text)
    chair = None
    vice = None
    m = re.search(r"議\s*長\s*[:：]?\s*([\u4e00-\u9fff]{2,6})", text)
    if m:
        chair = clean_name(m.group(1))
    m = re.search(r"副\s*議\s*長\s*[:：]?\s*([\u4e00-\u9fff]{2,6})", text)
    if m:
        vice = clean_name(m.group(1))
    # compactテキストでも検索
    if not chair:
        m = re.search(r"議長([\u4e00-\u9fff]{2,5})氏", compact)
        if m:
            chair = m.group(1)
    if not vice:
        m = re.search(r"副議長([\u4e00-\u9fff]{2,5})氏", compact)
        if m:
            vice = m.group(1)
    return chair, vice


def find_member_bulletin(bulletin_urls: list[str]) -> tuple[str, str] | None:
    """
    議員紹介が載っているPDFを動的に探す。戻り値は (bulletin_page_url, pdf_url)。
    """
    tmp_dir = Path("/tmp/tomari_scrape")
    tmp_dir.mkdir(exist_ok=True)

    keywords = ["改選後の議員の顔ぶれ", "議員の紹介", "当選された議員"]

    for page_url in bulletin_urls:
        pdf_url = extract_pdf_url(page_url)
        if not pdf_url:
            continue
        pdf_path = tmp_dir / Path(pdf_url).name
        if not pdf_path.exists():
            print(f"  Downloading {pdf_url}")
            if not download_pdf(pdf_url, pdf_path):
                continue
            time.sleep(0.5)
        try:
            with pdfplumber.open(pdf_path) as pdf:
                first_pages_text = "\n".join(
                    (p.extract_text() or "") for p in pdf.pages[:3]
                )
        except Exception as e:
            print(f"  [WARN] pdfplumber failed on {pdf_path}: {e}")
            continue
        if any(kw in first_pages_text for kw in keywords):
            print(f"  Found member-introducing bulletin: {page_url}")
            return page_url, pdf_url
    return None


def main():
    print("泊村議会 議員名簿を収集中...")
    print("議会だより一覧ページを取得...")
    bulletin_urls = collect_bulletin_page_urls()
    print(f"  議会だよりページ {len(bulletin_urls)} 件")
    if not bulletin_urls:
        print("取得不可: 議会だよりページが見つかりません")
        sys.exit(1)

    # 最新から順に見て、議員紹介が含まれる号を探す
    # 選挙後の号に掲載されるため、新しい順で十分
    found = find_member_bulletin(bulletin_urls)
    if not found:
        print("取得不可: 議員紹介を含む議会だよりPDFが見つかりません")
        sys.exit(1)
    page_url, pdf_url = found

    tmp_dir = Path("/tmp/tomari_scrape")
    pdf_path = tmp_dir / Path(pdf_url).name

    with pdfplumber.open(pdf_path) as pdf:
        full_text = "\n".join((p.extract_text() or "") for p in pdf.pages[:5])

    members_raw, row_assignments = parse_members_from_words(pdf_path, max_pages=5)
    print(f"  抽出候補 {len(members_raw)} 件: {[m['name'] for m in members_raw]}")

    if len(members_raw) < 3:
        print("取得不可: 議員名の抽出に失敗（候補が3件未満）")
        sys.exit(1)

    chair, vice = detect_chair_vice_chair(full_text)
    # 副議長検出のフォールバック：
    # 「議員紹介」で最後に登場する『2人だけの行』は議長と副議長専用の枠
    # （左＝議長、右＝副議長）であることが多い。
    if row_assignments:
        last_row = row_assignments[-1]
        if len(last_row) == 2:
            if not chair:
                chair = last_row[0]
            if not vice:
                vice = last_row[1]
    print(f"  議長: {chair} / 副議長: {vice}")

    # 役職順に並べる: 議長 → 副議長 → その他（当選回数降順 → 氏名）
    def sort_key(m):
        n = m["name"]
        if chair and n == chair:
            return (0, 0, n)
        if vice and n == vice:
            return (1, 0, n)
        return (2, -(m.get("elected_count") or 0), n)

    members_sorted = sorted(members_raw, key=sort_key)

    members: list[dict] = []
    for i, m in enumerate(members_sorted, 1):
        role = ""
        if chair and m["name"] == chair:
            role = "議長"
        elif vice and m["name"] == vice:
            role = "副議長"
        members.append({
            "seat_number": i,
            "name": m["name"],
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": [],
            "role": role,
            "elected_count": m.get("elected_count"),
            "source_pdf": pdf_url,
        })

    output = {
        "municipality": "tomari",
        "source_url": page_url,
        "source_pdf": pdf_url,
        "count": len(members),
        "members": members,
    }

    for target in [OUTPUT_DIR / "members.json", SITE_OUTPUT_DIR / "members.json"]:
        target.write_text(
            json.dumps(output, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {target}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
