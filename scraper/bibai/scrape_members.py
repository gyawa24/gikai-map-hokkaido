"""
美唄市議会 議員名簿スクレイパー

美唄市議会は議員一覧を PDF のみで公開している。
https://www.city.bibai.hokkaido.jp/site/gikai/1025.html
→ 議員の紹介 (PDF)
→ 常任委員会等の構成 (PDF)
→ 会派の構成 (PDF)

議員紹介ページ HTML から PDF URL を動的に取得し、
pdfplumber のテーブル抽出で議員氏名・会派・委員会を抽出する。
ふりがなは members.pdf のレイアウトが 2 段組で文字混線するため、
議長・副議長のみ確実に取得できる（残りは空）。

出力:
  data/bibai/members.json
  site/data/bibai/members.json
"""

import io
import json
import re
import sys
from pathlib import Path
from urllib.parse import urljoin

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.bibai.hokkaido.jp"
MEMBERS_PAGE_URL = f"{BASE_URL}/site/gikai/1025.html"

ROOT = Path(__file__).parent.parent.parent
OUT_DIRS = [ROOT / "site" / "data" / "bibai", ROOT / "data" / "bibai"]
for d in OUT_DIRS:
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

ROLE_LABELS = {"会長", "副会長", "幹事長", "副幹事長", "会員", "幹事"}


def compact(s: str) -> str:
    if not s:
        return ""
    return re.sub(r"[\s\u3000]+", "", s)


def norm_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\u3000", " ")).strip()


def fetch_bytes(url: str) -> bytes:
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.content


def find_pdf_urls() -> dict:
    resp = requests.get(MEMBERS_PAGE_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")
    urls: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        text = a.get_text(strip=True)
        href = a["href"]
        if ".pdf" not in href.lower():
            continue
        full = href if href.startswith("http") else urljoin(BASE_URL, href)
        if "議員" in text and ("紹介" in text or "名簿" in text):
            urls.setdefault("members", full)
        elif "委員会" in text:
            urls.setdefault("committees", full)
        elif "会派" in text:
            urls.setdefault("factions", full)
    return urls


def parse_factions_pdf(pdf_bytes: bytes) -> dict:
    """会派PDF → {compact_name: (display_name, faction)}"""
    result: dict[str, tuple[str, str]] = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            for tbl in page.extract_tables() or []:
                current_faction = None
                for row in tbl:
                    cells = [(c or "").strip() for c in row]
                    # 会派名行
                    header_found = False
                    for c in cells:
                        cc = compact(c)
                        if cc and (
                            "議員会" in cc
                            or "クラブ" in cc
                            or cc == "無会派"
                        ) and cc != "所属議員":
                            current_faction = cc
                            header_found = True
                            break
                    if header_found:
                        continue
                    # 議員名行
                    for c in cells:
                        if not c or not current_faction:
                            continue
                        c_norm = norm_spaces(c)
                        if c_norm in ROLE_LABELS:
                            continue
                        m = re.match(r"^(\S+)[ \u3000]+(\S+)$", c_norm)
                        if not m:
                            continue
                        first, last = m.group(1), m.group(2)
                        if first in ROLE_LABELS or last in ROLE_LABELS:
                            continue
                        joined = compact(first + last)
                        # 氏名は漢字＋ひらがなのみ
                        if not re.match(r"^[\u4e00-\u9fff\u3040-\u309f]+$", joined):
                            continue
                        name = f"{first} {last}"
                        ck = compact(name)
                        if ck and ck not in result:
                            result[ck] = (name, current_faction)
    return result


def parse_committees_pdf(pdf_bytes: bytes):
    """委員会PDF → ({compact_name: [committees]}, chair_compact, vice_chair_compact)"""
    committees: dict[str, list[str]] = {}
    chair: str | None = None
    vice: str | None = None

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if chair is None:
                m = re.search(
                    r"議\s*長[ \u3000]+([\u4e00-\u9fff\s\u3000]+?)[ \u3000]+"
                    r"副\s*議\s*長[ \u3000]+([\u4e00-\u9fff\s\u3000]+?)"
                    r"(?=\s*(?:\n|委\s*員|$))",
                    text,
                    re.DOTALL,
                )
                if m:
                    chair = compact(m.group(1))
                    vice = compact(m.group(2))

            for tbl in page.extract_tables() or []:
                if not tbl:
                    continue
                header_str = compact("".join([(c or "") for c in tbl[0]]))
                # 委員会テーブル（「委員会 委員長 副委員長 委員」）のみ処理
                if "委員長" not in header_str:
                    continue
                current_committee: str | None = None
                for row in tbl[1:]:
                    cells = [(c or "").strip() for c in row]
                    if cells and cells[0]:
                        current_committee = compact(cells[0])
                        if current_committee in {"議員会役員", "会派名"}:
                            current_committee = None
                            continue
                        # 委員長 / 副委員長 / 委員
                        name_cells = cells[1:]
                    else:
                        if current_committee is None:
                            continue
                        # 前行の継続（委員のみ）。先頭3列は空なので後ろだけ拾う
                        name_cells = cells[3:]
                    for c in name_cells:
                        if not c:
                            continue
                        key = compact(c)
                        if not key:
                            continue
                        if not re.match(r"^[\u4e00-\u9fff\u3040-\u309f]+$", key):
                            continue
                        committees.setdefault(key, []).append(current_committee)

    # 重複除去（順序保持）
    for k in committees:
        seen = []
        for v in committees[k]:
            if v and v not in seen:
                seen.append(v)
        committees[k] = seen

    return committees, chair, vice


def parse_leading_furigana(pdf_bytes: bytes, n: int = 2) -> list:
    """members.pdf の先頭から n 個のふりがな（姓 名）を取得。
    議長・副議長はページ冒頭に配置されているため安定して取れる。
    """
    result: list[str] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for m in re.finditer(r"[（(]([ぁ-ん]+)[ \u3000]+([ぁ-ん]+)[)）]", text):
                result.append(f"{m.group(1)} {m.group(2)}")
                if len(result) >= n:
                    return result
            if len(result) >= n:
                break
    return result


def main() -> int:
    print("美唄市議会 議員名簿スクレイパー")
    print(f"出典: {MEMBERS_PAGE_URL}")
    print()

    pdf_urls = find_pdf_urls()
    print("PDF URL を検出:")
    for k, v in pdf_urls.items():
        print(f"  {k}: {v}")

    required = {"members", "committees", "factions"}
    missing = required - set(pdf_urls.keys())
    if missing:
        print(f"  [ERROR] 期待する PDF が見つかりません: {missing}")
        return 1

    print("\nPDF を取得中...")
    pdfs: dict[str, bytes] = {}
    for key in ("members", "committees", "factions"):
        print(f"  fetch {key}: {pdf_urls[key]}")
        pdfs[key] = fetch_bytes(pdf_urls[key])

    print("\n会派 PDF を解析中...")
    faction_info = parse_factions_pdf(pdfs["factions"])
    print(f"  会派情報: {len(faction_info)} 名")
    for ck, (nm, fc) in faction_info.items():
        print(f"    - {nm}  [{fc}]")

    print("\n委員会 PDF を解析中...")
    committee_info, chair, vice = parse_committees_pdf(pdfs["committees"])
    print(f"  委員会情報: {len(committee_info)} 名")
    print(f"  議長: {chair} / 副議長: {vice}")

    print("\n議長・副議長のふりがなを取得中...")
    leading_furi = parse_leading_furigana(pdfs["members"], n=2)
    print(f"  {leading_furi}")

    all_names = set(faction_info.keys()) | set(committee_info.keys())
    all_names.discard("")

    if not all_names:
        print("  [ERROR] 議員が抽出できませんでした")
        return 1

    # 並び順: 議長 → 副議長 → 会派PDFの登場順 → 委員会PDFのみに現れる名前
    ordered: list[str] = []
    if chair and chair in all_names:
        ordered.append(chair)
    if vice and vice in all_names and vice != chair:
        ordered.append(vice)
    for ck in faction_info:
        if ck in all_names and ck not in ordered:
            ordered.append(ck)
    for ck in committee_info:
        if ck in all_names and ck not in ordered:
            ordered.append(ck)

    members = []
    for i, ck in enumerate(ordered, start=1):
        if ck in faction_info:
            name, faction = faction_info[ck]
        else:
            # 委員会PDFのみで発見された場合は compact 名を表示（通常は発生しない）
            name = ck
            faction = ""
        furigana = ""
        if ck == chair and len(leading_furi) >= 1:
            furigana = leading_furi[0]
        elif ck == vice and len(leading_furi) >= 2:
            furigana = leading_furi[1]
        members.append(
            {
                "seat_number": i,
                "name": name,
                "furigana": furigana,
                "party": "",
                "faction": faction,
                "committees": committee_info.get(ck, []),
            }
        )

    for d in OUT_DIRS:
        out = d / "members.json"
        out.write_text(
            json.dumps(members, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"書き込み: {out} ({len(members)} 名)")

    print()
    print(f"取得議員数: {len(members)}名")
    return 0


if __name__ == "__main__":
    sys.exit(main())
