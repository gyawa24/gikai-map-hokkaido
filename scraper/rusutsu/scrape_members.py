"""
留寿都村議会 議員名簿スクレイパー
出力:
  - data/rusutsu/members.json
  - site/data/rusutsu/members.json
  - site/public/members/rusutsu/seat_N.jpg （写真）

ソース: https://www.vill.rusutsu.lg.jp/hotnews/detail/00002269.html
HTML構造: <h2>議席番号N：氏名</h2> → <img> → <table> の繰り返し
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.vill.rusutsu.lg.jp"
MEMBERS_URL = f"{BASE_URL}/hotnews/detail/00002269.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIRS = [
    ROOT / "data" / "rusutsu",
    ROOT / "site" / "data" / "rusutsu",
]
PHOTO_DIR = ROOT / "site" / "public" / "members" / "rusutsu"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

ROLE_KEYWORDS = ("議長", "副議長", "監査委員")


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def clean_cell(raw: str) -> str:
    s = raw.replace("\u3000", " ").replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def normalize_name(raw: str) -> str:
    # 氏名は全角スペースをそのまま保つ方針もあるが、既存実装（niseko）に倣い半角スペース1つへ
    s = raw.replace("\u3000", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def split_committees(cell) -> list[str]:
    for br in cell.find_all("br"):
        br.replace_with("\n")
    text = cell.get_text("\n", strip=True)
    lines = [clean_cell(ln) for ln in text.split("\n")]
    return [ln for ln in lines if ln]


def extract_role(committees: list[str]) -> tuple[str, list[str]]:
    """議長/副議長/監査委員を faction に抜き出し、残りを committees として返す。"""
    role = ""
    rest: list[str] = []
    for item in committees:
        if item in ROLE_KEYWORDS:
            # 複数付いた場合は最初のものを優先（留寿都は同時に複数の役職を持たない想定だが安全策）
            if not role:
                role = item
            else:
                # 監査委員は役職ではあるが委員会枠として残す
                rest.append(item)
        else:
            rest.append(item)
    return role, rest


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.rsplit(".", 1)[-1].split("?")[0].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    dest = PHOTO_DIR / fname
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        dest.write_bytes(r.content)
        return f"/members/rusutsu/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗: {remote_url} -> {e}")
        return ""


def parse_member_table(table) -> dict:
    fields: dict[str, object] = {}
    for tr in table.find_all("tr"):
        th = tr.find("th")
        td = tr.find("td")
        if not th or not td:
            continue
        key = clean_cell(th.get_text(" ", strip=True))
        if key == "役職・所属委員会":
            fields[key] = split_committees(td)
        else:
            fields[key] = clean_cell(td.get_text(" ", strip=True))
    return fields


def scrape_members() -> list[dict]:
    print(f"留寿都村議会 議員名簿を収集中: {MEMBERS_URL}")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        return []
    soup = BeautifulSoup(resp.text, "html.parser")

    article = soup.find("div", id="article") or soup
    headings = article.find_all("h2", class_="pagetitle_a3")
    seat_re = re.compile(r"議席番号(\d+)")

    members: list[dict] = []
    for h2 in headings:
        m = seat_re.search(h2.get_text(" ", strip=True))
        if not m:
            continue
        seat = int(m.group(1))

        # h2 の後続を走査して最初の img と table を拾う
        img_tag = None
        table_tag = None
        sib = h2.next_sibling
        while sib is not None:
            # 次の h2 に到達したら停止
            if getattr(sib, "name", None) == "h2" and "pagetitle_a3" in (sib.get("class") or []):
                break
            if getattr(sib, "name", None) == "img" and img_tag is None:
                img_tag = sib
            # テーブルは <div class="table-wrap"> にラップされているので find で探す
            if hasattr(sib, "find"):
                if img_tag is None:
                    found_img = sib.find("img") if sib.name else None
                    if found_img:
                        img_tag = found_img
                if table_tag is None:
                    found_table = sib.find("table") if sib.name else None
                    if found_table:
                        table_tag = found_table
            sib = sib.next_sibling

        if table_tag is None:
            print(f"  [WARN] 議席{seat}: テーブル未検出")
            continue

        fields = parse_member_table(table_tag)
        name = normalize_name(str(fields.get("氏名", "")))
        if not name:
            print(f"  [WARN] 議席{seat}: 氏名取得失敗")
            continue

        committees_raw = fields.get("役職・所属委員会", [])
        if isinstance(committees_raw, str):
            committees_raw = [committees_raw] if committees_raw else []
        role, committees = extract_role(list(committees_raw))

        party = str(fields.get("党派", "")).strip()

        photo_url = ""
        if img_tag and img_tag.get("src"):
            remote = urljoin(BASE_URL, img_tag["src"])
            photo_url = download_photo(remote, seat)
            time.sleep(0.3)

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": role,
            "committees": committees,
            "photo_url": photo_url,
        }
        members.append(member)
        print(f"  [{seat}] {name} / {party} / {role or '-'} / {committees}")

    members.sort(key=lambda x: x["seat_number"])
    return members


def write_outputs(members: list[dict]) -> None:
    payload = {"members": members}
    for d in OUTPUT_DIRS:
        d.mkdir(parents=True, exist_ok=True)
        out = d / "members.json"
        out.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  書き出し: {out}")


def main() -> None:
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    members = scrape_members()
    if not members:
        print("取得不可: 議員データを抽出できませんでした")
        return
    write_outputs(members)
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
