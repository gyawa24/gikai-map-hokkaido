"""
標津町議会 議員名簿スクレイパー

標津町は HTML テーブルで議員一覧を公開しておらず、公式サイトの
「議会の仕組みと組織 > 標津町議会議員名簿」ページから配布されている
PDF（議員名簿・議員所属委員会名簿）を動的に取得して解析する。

データ源:
  https://www.shibetsutown.jp/administration/?content=132

出力:
  data/shibetsucho/members.json
  site/data/shibetsucho/members.json
"""

import json
import re
import urllib.parse
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.shibetsutown.jp"
LIST_URL = f"{BASE_URL}/administration/?content=132"

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "shibetsucho"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "shibetsucho"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> requests.Response:
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    return resp


def find_pdf_links() -> tuple[str, str | None]:
    """議員名簿・委員会名簿 PDF の URL を動的に解決する。"""
    resp = fetch(LIST_URL)
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    members_url: str | None = None
    committees_url: str | None = None
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if ".pdf" not in href.lower():
            continue
        label = a.get_text(strip=True)
        absolute = urllib.parse.urljoin(LIST_URL, href)
        if members_url is None and "議員名簿" in label and "委員会" not in label:
            members_url = absolute
        elif committees_url is None and "委員会名簿" in label:
            committees_url = absolute

    if members_url is None:
        raise RuntimeError("議員名簿 PDF のリンクを発見できませんでした")
    return members_url, committees_url


COMMITTEE_ALIASES = {
    # 議員名簿 PDF の短縮表記 -> 委員会名簿 PDF で明示されている正式名称
    "総務経済": "総務経済常任委員会",
    "文教福祉": "文教福祉建設常任委員会",
    "広報": "広報特別委員会",
    "議運": "議会運営委員会",
}


def parse_committees(cell: str) -> list[str]:
    """所属委員会セルをパースし ['委員会名(委員長)', ...] 形式に整形する。"""
    out: list[str] = []
    for raw in cell.splitlines():
        line = raw.strip()
        if not line:
            continue

        role = ""
        if line.startswith("◎"):
            role = "委員長"
            line = line[1:].strip()
        elif line.startswith(("〇", "○")):
            role = "副委員長"
            line = line[1:].strip()

        bracketed = False
        m = re.fullmatch(r"\[(.+)\]", line)
        if m:
            bracketed = True
            line = m.group(1).strip()

        name = COMMITTEE_ALIASES.get(line, line)
        label = f"{name}(委員長)" if role == "委員長" else f"{name}(副委員長)" if role == "副委員長" else name
        if bracketed:
            label = f"{label}(兼任)"
        out.append(label)
    return out


def clean_join(text: str) -> str:
    return re.sub(r"\s+", "", text)


def extract_members(pdf_path: Path) -> list[dict]:
    """pdfplumber の表抽出で議員行を取り出す。"""
    members: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    if not row:
                        continue
                    seat_cell = (row[0] or "").strip()
                    if not re.fullmatch(r"\d+", seat_cell):
                        continue

                    name_cell = row[1] or ""
                    committee_cell = row[2] or ""
                    role_cell = row[3] or ""

                    lines = [l.strip() for l in name_cell.splitlines() if l.strip()]
                    furigana = clean_join(lines[0]) if len(lines) >= 1 else ""
                    name = clean_join(lines[1]) if len(lines) >= 2 else ""

                    committees = parse_committees(committee_cell)
                    role = clean_join(role_cell)
                    if role:
                        committees.insert(0, role)

                    members.append({
                        "seat_number": int(seat_cell),
                        "name": name,
                        "furigana": furigana,
                        "party": "",
                        "faction": "",
                        "committees": committees,
                    })
    members.sort(key=lambda m: m["seat_number"])
    return members


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)

    print(f"標津町議会 議員名簿ページを取得中: {LIST_URL}")
    members_pdf_url, committees_pdf_url = find_pdf_links()
    print(f"  議員名簿 PDF: {members_pdf_url}")
    if committees_pdf_url:
        print(f"  委員会名簿 PDF: {committees_pdf_url}")

    members_pdf = DATA_DIR / "members.pdf"
    members_pdf.write_bytes(fetch(members_pdf_url).content)
    if committees_pdf_url:
        (DATA_DIR / "committees.pdf").write_bytes(fetch(committees_pdf_url).content)

    members = extract_members(members_pdf)
    if not members:
        raise RuntimeError("議員データを 1 件も抽出できませんでした")

    payload = json.dumps(members, ensure_ascii=False, indent=2)
    (DATA_DIR / "members.json").write_text(payload, encoding="utf-8")
    (SITE_DATA_DIR / "members.json").write_text(payload, encoding="utf-8")

    print(f"  議員 {len(members)} 名を書き出しました")
    for m in members:
        print(f"    [{m['seat_number']}] {m['name']} ({m['furigana']}) — {m['committees']}")


if __name__ == "__main__":
    main()
