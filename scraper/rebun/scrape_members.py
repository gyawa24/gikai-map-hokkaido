"""
礼文町議会 議員名簿スクレイパー
出力: site/data/rebun/members.json

データ源:
  - 議員名簿PDF・委員会構成PDFは「礼文町議会の概要」ページに都度添付される
  - ページURLから PDF リンクを動的取得し、pdfplumber でテーブル抽出する
"""

import io
import json
import re
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.rebun.hokkaido.jp"
OVERVIEW_URL = f"{BASE_URL}/hotnews/detail/00000133.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "rebun"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def normalize_name(raw: str) -> str:
    """PDF表から抽出した氏名の空白類を取り除く"""
    if not raw:
        return ""
    return re.sub(r"[\s\u3000]+", "", raw).strip()


def fetch_bytes(url: str) -> bytes:
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    return resp.content


def find_pdf_links() -> dict[str, str]:
    """概要ページからラベル→絶対URL の辞書を返す"""
    resp = requests.get(OVERVIEW_URL, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    links: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not href.lower().endswith(".pdf"):
            continue
        label = a.get_text(strip=True)
        url = href if href.startswith("http") else BASE_URL + href
        if label:
            links[label] = url
    return links


def pick_url(links: dict[str, str], keywords: list[str]) -> str | None:
    for label, url in links.items():
        if any(k in label for k in keywords):
            return url
    return None


def extract_members(pdf_bytes: bytes) -> list[dict]:
    """議員名簿PDFから議席・氏名・職業・政党を取り出す"""
    members: list[dict] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                header = [normalize_name(c or "") for c in table[0]]
                if not any("氏名" in h or "氏" == h for h in header):
                    continue
                try:
                    col_seat = next(i for i, h in enumerate(header) if "議席" in h)
                    col_name = next(i for i, h in enumerate(header) if "氏" in h)
                    col_party = next(
                        (i for i, h in enumerate(header) if "政党" in h or "会派" in h),
                        None,
                    )
                except StopIteration:
                    continue

                for row in table[1:]:
                    if row is None or len(row) <= col_name:
                        continue
                    seat_raw = (row[col_seat] or "").strip()
                    name_raw = row[col_name] or ""
                    name = normalize_name(name_raw)
                    if not seat_raw.isdigit() or not name:
                        continue
                    party = ""
                    if col_party is not None:
                        p = normalize_name(row[col_party] or "")
                        # "〃" は上の行を参照する記号
                        if p and p not in {"〃", "″", "”"}:
                            party = p
                    members.append(
                        {
                            "seat_number": int(seat_raw),
                            "name": name,
                            "party_raw": party,
                        }
                    )
    # "〃" リピートの解決
    last_party = ""
    for m in members:
        if m["party_raw"]:
            last_party = m["party_raw"]
        else:
            m["party_raw"] = last_party
    return members


def extract_committees(pdf_bytes: bytes) -> dict[str, list[str]]:
    """委員会PDFから「氏名 -> 所属委員会（役職付）」のマッピングを作る"""
    result: dict[str, list[str]] = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            # 委員会名を拾う（☆で始まる行 or ●委員会 で終わる行）
            # 次にテーブルを順に処理し、登場順で委員会名と対応付ける
            committee_names = re.findall(r"☆\s*([^\s（(]+(?:委員会|協議会))", text)
            tables = page.extract_tables() or []
            for idx, table in enumerate(tables):
                if idx >= len(committee_names):
                    break
                committee = committee_names[idx]
                for row in table:
                    if not row or len(row) < 2:
                        continue
                    role = normalize_name(row[0] or "")
                    name = normalize_name(row[1] or "")
                    if not name or "氏名" in name:
                        continue
                    label = committee
                    if role == "委員長":
                        label = f"{committee}（委員長）"
                    elif role == "副委員長":
                        label = f"{committee}（副委員長）"
                    result.setdefault(name, []).append(label)
    return result


def main():
    print("礼文町議会 議員名簿スクレイパー")
    print(f"  概要ページ: {OVERVIEW_URL}")

    links = find_pdf_links()
    if not links:
        raise SystemExit("PDFリンクを検出できませんでした")
    print(f"  PDFリンク {len(links)} 件検出")
    for label, url in links.items():
        print(f"    - {label}: {url}")

    members_url = pick_url(links, ["議員名簿", "名簿"])
    committees_url = pick_url(links, ["委員会"])
    if not members_url:
        raise SystemExit("議員名簿PDFのリンクが見つかりません")

    print(f"  議員名簿PDF: {members_url}")
    members_pdf = fetch_bytes(members_url)
    members = extract_members(members_pdf)
    if not members:
        raise SystemExit("PDFから議員表を抽出できませんでした")
    print(f"  議員 {len(members)} 名を抽出")

    committee_map: dict[str, list[str]] = {}
    if committees_url:
        print(f"  委員会PDF: {committees_url}")
        committees_pdf = fetch_bytes(committees_url)
        committee_map = extract_committees(committees_pdf)
        print(f"  委員会マップ: {len(committee_map)} 名")
    else:
        print("  [WARN] 委員会PDFが見つからず、委員会情報はスキップ")

    output = []
    for m in members:
        raw_party = m.get("party_raw", "")
        output.append(
            {
                "seat_number": m["seat_number"],
                "name": m["name"],
                "furigana": "",
                "party": raw_party,
                "faction": "",
                "committees": committee_map.get(m["name"], []),
                "photo_url": "",
            }
        )

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"  -> {out_path}")
    print(f"取得議員数: {len(output)}名")


if __name__ == "__main__":
    main()
