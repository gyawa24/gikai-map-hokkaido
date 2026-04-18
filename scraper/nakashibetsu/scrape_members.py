"""
中標津町議会 議員名簿スクレイパー
議員名簿PDF + 委員会等所属一覧表PDF から動的取得
出力: data/nakashibetsu/members.json
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.nakashibetsu.jp"
MEMBERS_PAGE = f"{BASE_URL}/gikai/giinmeibo/"
COMMITTEES_PAGE = f"{BASE_URL}/gikai/giin_iinkai/"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "nakashibetsu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

COMMITTEE_KEYWORDS = [
    "総務経済常任委員会",
    "文教厚生常任委員会",
    "議会運営委員会",
    "議会広報特別委員会",
]

FULLWIDTH_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")


def fetch_html(url: str) -> str:
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return resp.text


def find_pdf_on_page(page_url: str, name_pattern: re.Pattern) -> str | None:
    """ページ内から指定パターンにマッチするPDFリンクを動的に探す"""
    soup = BeautifulSoup(fetch_html(page_url), "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not href.lower().endswith(".pdf"):
            continue
        if name_pattern.search(href):
            return href if href.startswith("http") else BASE_URL + href
    return None


def download_pdf(url: str, dest: Path) -> Path:
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    dest.write_bytes(resp.content)
    return dest


def normalize_name(s: str) -> str:
    # NFKC で CJK 互換字形（例: ⾧=U+2FA7 → 長=U+9577）を揃えてから空白除去
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s))


def parse_members_pdf(pdf_path: Path) -> list[dict]:
    """members.pdf から議員の基本情報を抽出"""
    with pdfplumber.open(pdf_path) as pdf:
        text = "\n".join(p.extract_text() or "" for p in pdf.pages)

    # 各議員ブロックは「氏 名 <name>（<yomi>）」で始まる
    blocks = re.split(r"(?=氏\s*名\s+[^\n（]+（)", text)

    members: list[dict] = []
    for block in blocks:
        m = re.search(r"氏\s*名\s+([^（\n]+)（([^）]+)）", block)
        if not m:
            continue
        # 氏名も NFKC 正規化（PDF 内の互換字形を標準字形に揃える）
        name = unicodedata.normalize(
            "NFKC", re.sub(r"\s+", " ", m.group(1)).strip()
        )
        furigana = m.group(2).strip()

        # 党派は同じ行にある値のみを拾う（改行を越えて委員会名を拾わないように）
        party = ""
        party_m = re.search(r"党\s*派[ \t]+(\S+)", block)
        if party_m:
            party = party_m.group(1).strip()

        seat_number = None
        seat_m = re.search(r"議席番号\s*([０-９\d]+)", block)
        if seat_m:
            seat_number = int(seat_m.group(1).translate(FULLWIDTH_DIGITS))

        members.append(
            {
                "seat_number": seat_number,
                "name": name,
                "furigana": furigana,
                "party": party,
            }
        )
    return members


def parse_committees_pdf(
    pdf_path: Path, known_names: list[str]
) -> dict[str, list[str]]:
    """
    committees.pdf から各議員の委員会所属・役職を抽出
    known_names: 正規化済み（空白除去済み）の議員氏名リスト
    Returns: {normalized_name: [所属の表示用文字列, ...]}
    """
    with pdfplumber.open(pdf_path) as pdf:
        text = "\n".join(p.extract_text() or "" for p in pdf.pages)

    result: dict[str, list[str]] = {n: [] for n in known_names}
    known_set = set(known_names)
    # 最長一致を優先（短い名前が長い名前の接頭辞になる場合の誤マッチ回避）
    sorted_names = sorted(known_names, key=len, reverse=True)

    # 議長・副議長（◎マーク付きの冒頭行）
    for raw in text.split("\n"):
        line = raw.strip()
        m = re.match(r"◎\s*議\s*長\s+(.+)", line)
        if m:
            n = normalize_name(m.group(1))
            if n in known_set:
                result[n].append("議長")
            continue
        m = re.match(r"◎\s*副\s*議\s*長\s+(.+)", line)
        if m:
            n = normalize_name(m.group(1))
            if n in known_set:
                result[n].append("副議長")

    # 各委員会セクション（●で始まる）
    sections = re.findall(r"●([^\n]+)\n((?:(?!●).)+)", text, re.DOTALL)
    for header, body in sections:
        header = header.strip()
        committee_name = next((kw for kw in COMMITTEE_KEYWORDS if kw in header), header)

        body_norm = normalize_name(body)

        i = 0
        matches: list[tuple[int, str]] = []
        while i < len(body_norm):
            hit = None
            for n in sorted_names:
                if body_norm.startswith(n, i):
                    hit = n
                    break
            if hit:
                matches.append((i, hit))
                i += len(hit)
            else:
                i += 1

        for idx, name in matches:
            prefix = body_norm[max(0, idx - 4):idx]
            # 「副委員長」判定を先に、次に「委員長」。
            # 普通の「委員」は役職サフィックス不要（committee名のみ登録）
            if prefix.endswith("副委員長"):
                entry = f"{committee_name}副委員長"
            elif prefix.endswith("委員長"):
                entry = f"{committee_name}委員長"
            else:
                entry = committee_name
            result[name].append(entry)

    # 重複排除（出現順保持）
    for n in result:
        result[n] = list(dict.fromkeys(result[n]))
    return result


def main() -> None:
    print("中標津町議会 議員名簿を収集中...")

    print(f"  議員名簿ページ: {MEMBERS_PAGE}")
    members_pdf_url = find_pdf_on_page(
        MEMBERS_PAGE, re.compile(r"giinmeibo", re.I)
    )
    if not members_pdf_url:
        print("  [ERROR] 議員名簿PDFが見つかりません")
        sys.exit(1)
    print(f"  議員名簿PDF: {members_pdf_url}")

    print(f"  委員会一覧ページ: {COMMITTEES_PAGE}")
    committees_pdf_url = find_pdf_on_page(
        COMMITTEES_PAGE, re.compile(r"iinkai|syozoku|shozoku", re.I)
    )
    if committees_pdf_url:
        print(f"  委員会一覧PDF: {committees_pdf_url}")
    else:
        print("  [WARN] 委員会一覧PDFが見つかりません（委員会情報は空になります）")

    members_pdf_path = download_pdf(members_pdf_url, OUTPUT_DIR / "members.pdf")
    print(f"  保存: {members_pdf_path}")

    committees_pdf_path: Path | None = None
    if committees_pdf_url:
        committees_pdf_path = download_pdf(
            committees_pdf_url, OUTPUT_DIR / "committees.pdf"
        )
        print(f"  保存: {committees_pdf_path}")

    members = parse_members_pdf(members_pdf_path)
    if not members:
        print("  [ERROR] 議員情報を抽出できませんでした")
        sys.exit(1)
    print(f"  議員 {len(members)} 名を抽出")

    committee_map: dict[str, list[str]] = {}
    if committees_pdf_path:
        known = [normalize_name(m["name"]) for m in members]
        committee_map = parse_committees_pdf(committees_pdf_path, known)

    for m in members:
        key = normalize_name(m["name"])
        m["faction"] = ""  # 中標津町議会は会派制を明示していない
        m["committees"] = committee_map.get(key, [])

    members.sort(key=lambda x: x["seat_number"] if x["seat_number"] is not None else 999)

    output = [
        {
            "seat_number": m["seat_number"],
            "name": m["name"],
            "furigana": m["furigana"],
            "party": m["party"],
            "faction": m["faction"],
            "committees": m["committees"],
        }
        for m in members
    ]

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  書き出し: {out_path}")
    print(f"取得議員数: {len(output)}名")


if __name__ == "__main__":
    main()
