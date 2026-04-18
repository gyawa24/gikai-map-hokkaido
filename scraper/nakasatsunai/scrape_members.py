"""
中札内村議会 議員名簿スクレイパー
出力: data/nakasatsunai/members.json

議員紹介ページ (HTML) には議員写真しか掲載されておらず、
議員の氏名・会派・委員会等は PDF (giinnshoukaiR5.5.9genzai.pdf) に
含まれているため、HTML から PDF と写真URLを動的に取得し、
PDF を pdfplumber でパースして構造化データに変換する。
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.vill.nakasatsunai.hokkaido.jp"
INDEX_URL = f"{BASE_URL}/gikai/giin_shokai/"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "nakasatsunai"
SITE_DATA_DIR = ROOT / "site" / "data" / "nakasatsunai"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "nakasatsunai"

for d in (OUTPUT_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def http_get(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def fetch_index() -> tuple[str | None, list[str]]:
    """議員紹介ページから PDF URL と写真URLリストを抽出"""
    resp = http_get(INDEX_URL)
    if resp is None:
        return None, []
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    pdf_url = None
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().endswith(".pdf") and "giin" in href.lower():
            pdf_url = urljoin(BASE_URL, href)
            break

    photo_urls: list[str] = []
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if "/output/contents/image/" in src and src.lower().endswith((".jpg", ".jpeg", ".png")):
            photo_urls.append(urljoin(BASE_URL, src))

    return pdf_url, photo_urls


def download_pdf(pdf_url: str, dest: Path) -> bool:
    resp = http_get(pdf_url)
    if resp is None:
        return False
    dest.write_bytes(resp.content)
    return True


# 期数や住所の行を除去するためのパターン
SEAT_RE = re.compile(r"^([０-９0-9]+)番(?:\s*(議長|副議長))?")
FURIGANA_RE = re.compile(r"^（([ぁ-んー\s]+)）$")


def normalize_digits(s: str) -> str:
    return s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))


def parse_committees(line: str) -> list[str]:
    """「総務厚生（委員長）、産業文教、議運」のような文字列をリスト化"""
    raw = line.replace("委員会：", "").strip()
    parts = re.split(r"[、,]", raw)
    return [p.strip() for p in parts if p.strip()]


def parse_pdf(pdf_path: Path) -> list[dict]:
    members: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            if not lines:
                continue

            seat_match = SEAT_RE.match(lines[0])
            if not seat_match:
                continue
            seat_number = int(normalize_digits(seat_match.group(1)))
            role = seat_match.group(2) or ""

            name = ""
            furigana = ""
            party = ""
            committees: list[str] = []

            for ln in lines[1:]:
                if not name and not ln.startswith("（") and not ln.startswith("期数") \
                        and not ln.startswith("党派") and not ln.startswith("委員会") \
                        and not ln.startswith("住所"):
                    name = ln
                    continue
                m = FURIGANA_RE.match(ln)
                if m and not furigana:
                    furigana = m.group(1).strip()
                    continue
                if ln.startswith("党派"):
                    party = ln.replace("党派：", "").strip()
                    continue
                if ln.startswith("委員会"):
                    committees = parse_committees(ln)
                    continue

            if not name:
                continue

            members.append({
                "seat_number": seat_number,
                "name": name,
                "furigana": furigana,
                "party": party,
                "faction": "",
                "committees": committees,
                "role": role,
                "photo_url": "",
            })
    members.sort(key=lambda m: m["seat_number"])
    return members


def download_photos(members: list[dict], photo_urls: list[str]) -> None:
    """HTML 上の写真は議員紹介ページの掲載順 = 議席番号順に並んでいる前提で、
    seat_number に対応する写真をダウンロードする。"""
    for member in members:
        idx = member["seat_number"] - 1
        if idx < 0 or idx >= len(photo_urls):
            continue
        url = photo_urls[idx]
        ext = url.rsplit(".", 1)[-1].split("?")[0].lower() or "jpg"
        if ext == "jpeg":
            ext = "jpg"
        fname = f"seat_{member['seat_number']}.{ext}"
        resp = http_get(url)
        if resp is None:
            continue
        (PHOTO_DIR / fname).write_bytes(resp.content)
        member["photo_url"] = f"/members/nakasatsunai/{fname}"
        time.sleep(0.3)


def main() -> None:
    print("中札内村議会 議員名簿を収集中...")

    pdf_url, photo_urls = fetch_index()
    if not pdf_url:
        print("  [ERROR] 議員名簿PDFのリンクが見つかりませんでした")
        return
    print(f"  PDF: {pdf_url}")
    print(f"  写真リンク: {len(photo_urls)} 件")

    pdf_path = OUTPUT_DIR / "members.pdf"
    if not download_pdf(pdf_url, pdf_path):
        print("  [ERROR] PDFダウンロード失敗")
        return

    members = parse_pdf(pdf_path)
    if not members:
        print("  [ERROR] PDFから議員情報を抽出できませんでした")
        return

    print(f"  PDFから {len(members)} 名抽出")

    download_photos(members, photo_urls)

    out_path = OUTPUT_DIR / "members.json"
    site_path = SITE_DATA_DIR / "members.json"
    payload = json.dumps(members, ensure_ascii=False, indent=2)
    out_path.write_text(payload, encoding="utf-8")
    site_path.write_text(payload, encoding="utf-8")

    print(f"  [OK] {out_path}")
    print(f"  [OK] {site_path}")
    for m in members:
        print(f"    {m['seat_number']}番 {m['name']} ({m['furigana']}) {m['party']} {m['committees']}")


if __name__ == "__main__":
    main()
