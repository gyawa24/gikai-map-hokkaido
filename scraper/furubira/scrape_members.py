"""
古平町議会 議員名簿スクレイパー
出力: data/furubira/members.json

公式サイトの議員名簿ページ（id=56）は画像のみで議員名がテキストとして
存在しないため、議会会議録PDF（出席議員・欠席議員リスト）から
動的に議員名・議席番号・議長役職を抽出する。
"""

import json
import re
import time
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.furubira.lg.jp"
MINUTES_INDEX_URL = f"{BASE_URL}/town/detail.php?id=59"
GIINMEIBO_URL = f"{BASE_URL}/town/detail.php?id=56"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "furubira"
SITE_OUTPUT_DIR = REPO_ROOT / "site" / "data" / "furubira"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

EXPECTED_TOTAL = 10  # 議員定数
TMP_PDF_DIR = Path("/tmp/furubira_pdfs")
TMP_PDF_DIR.mkdir(exist_ok=True)


def fetch_html(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def collect_minutes_pdf_urls() -> list[str]:
    """会議録一覧ページから新しい順にPDFのURLを取得する。"""
    soup = fetch_html(MINUTES_INDEX_URL)
    if soup is None:
        return []
    urls: list[str] = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().endswith(".pdf") and "cassette" in href:
            full = href if href.startswith("http") else BASE_URL + href.replace("..", "")
            if full not in urls:
                urls.append(full)
    # ページ上は新しい年が先頭、各年内は番号順。先頭ほど新しい想定。
    return urls


def download_pdf(url: str) -> Path | None:
    fname = url.rsplit("/", 1)[-1]
    path = TMP_PDF_DIR / fname
    if path.exists() and path.stat().st_size > 0:
        return path
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        path.write_bytes(resp.content)
        return path
    except Exception as e:
        print(f"  [ERROR] download {url} -> {e}")
        return None


# 例: "議長１０番 堀 清 君 １番 工 藤 澄 男 君"
#     "２番 寶 福 勝 哉 君 ７番 堀 澤 理 恵 君"
# 数字は半角/全角混在の可能性あり。氏名はスペース挿入されている。
SEAT_PATTERN = re.compile(
    r"(議長|副議長)?\s*([0-9０-９]+)\s*番\s+([^\s君0-9０-９][^君0-9０-９]*?)\s*君"
)

ZEN_TO_HAN = str.maketrans("０１２３４５６７８９", "0123456789")


def normalize_name(raw: str) -> str:
    """氏名内のスペースを除去（姓名間スペース含め全削除）。"""
    return re.sub(r"\s+", "", raw).strip()


def parse_members_from_pdf(pdf_path: Path) -> list[dict]:
    """PDF1ファイルから (議席番号, 氏名, 役職) を抽出する。"""
    found: list[dict] = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            text = pdf.pages[0].extract_text() or ""
    except Exception as e:
        print(f"  [ERROR] pdfplumber {pdf_path.name} -> {e}")
        return found

    # 出席議員と欠席議員セクションを抽出
    sections: list[str] = []
    for marker in ["出席議員", "欠席議員"]:
        idx = text.find(marker)
        if idx == -1:
            continue
        # 次の "〇" まで（無ければ末尾まで）
        end = text.find("〇", idx + len(marker))
        sections.append(text[idx:end] if end != -1 else text[idx:])

    for section in sections:
        for m in SEAT_PATTERN.finditer(section):
            role_marker, seat_zh, name_raw = m.group(1), m.group(2), m.group(3)
            seat = int(seat_zh.translate(ZEN_TO_HAN))
            name = normalize_name(name_raw)
            if not name or len(name) < 2:
                continue
            role = ""
            if role_marker == "議長":
                role = "議長"
            elif role_marker == "副議長":
                role = "副議長"
            found.append({"seat_number": seat, "name": name, "role": role})
    return found


def merge_members(acc: dict[int, dict], new: list[dict]) -> None:
    for m in new:
        seat = m["seat_number"]
        if seat not in acc:
            acc[seat] = m
        else:
            # 役職が空でない方を優先
            if not acc[seat]["role"] and m["role"]:
                acc[seat]["role"] = m["role"]


def scrape() -> None:
    print("古平町議会 議員名簿を会議録PDFから収集中...")
    pdf_urls = collect_minutes_pdf_urls()
    if not pdf_urls:
        print("  会議録PDFのURLが取得できませんでした")
        return
    print(f"  会議録PDF {len(pdf_urls)} 件発見")

    acc: dict[int, dict] = {}
    used_pdfs = 0
    for url in pdf_urls:
        if len(acc) >= EXPECTED_TOTAL and used_pdfs >= 1:
            # 全議員揃ったら追加で1ファイルだけ確認して役職を補完
            pass
        path = download_pdf(url)
        time.sleep(0.3)
        if path is None:
            continue
        found = parse_members_from_pdf(path)
        if not found:
            continue
        merge_members(acc, found)
        used_pdfs += 1
        print(f"  [{used_pdfs}] {path.name}: 累計 {len(acc)}/{EXPECTED_TOTAL} 名")
        if len(acc) >= EXPECTED_TOTAL and used_pdfs >= 2:
            break  # 役職補完のため最低2ファイルは見る
        if used_pdfs >= 8:
            break

    if not acc:
        print("  PDFから議員情報が抽出できませんでした")
        return

    members = []
    for seat in sorted(acc.keys()):
        rec = acc[seat]
        members.append({
            "seat_number": rec["seat_number"],
            "name": rec["name"],
            "furigana": "",
            "party": "",
            "faction": rec["role"],  # 議長/副議長を faction に格納
            "committees": [],
            "photo_url": "",
        })

    out_data = {
        "city": "古平町",
        "city_slug": "furubira",
        "source_url": GIINMEIBO_URL,
        "source_note": "公式サイトの議員名簿は画像のみのため、会議録PDFから議員名・議席番号を抽出",
        "members": members,
    }

    out_path = OUTPUT_DIR / "members.json"
    site_out_path = SITE_OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(out_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    site_out_path.write_text(
        json.dumps(out_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n  -> {out_path}")
    print(f"  -> {site_out_path}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    scrape()
