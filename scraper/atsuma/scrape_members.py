"""
厚真町議会 議員名簿スクレイパー
出力: data/atsuma/members.json + site/data/atsuma/members.json
写真: site/public/members/atsuma/seat_N.jpg
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.atsuma.lg.jp"
MEMBERS_URL = f"{BASE_URL}/site/gikai/2677.html"

ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT / "data" / "atsuma"
SITE_DATA_DIR = ROOT / "site" / "data" / "atsuma"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "atsuma"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 党派略号 → 正式名称（ページ凡例に合わせる）
PARTY_MAP = {
    "無": "無所属",
    "共": "日本共産党",
    "自": "自由民主党",
    "公": "公明党",
    "民": "国民民主党",
    "立": "立憲民主党",
}


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def clean(text: str) -> str:
    if not text:
        return ""
    # 全角/半角スペース・ゼロ幅スペース等を除去
    return re.sub(r"[\s\u200b\u3000]+", "", text)


def parse_name_cell(cell_text: str) -> tuple[str, str]:
    """「澤口　千里 (さわぐち　ちさと)」形式から氏名とふりがなを分離。"""
    m = re.search(r"[（(]([^）)]+)[)）]", cell_text)
    furigana = ""
    if m:
        furigana = clean(m.group(1))
        name_part = cell_text[: m.start()] + cell_text[m.end():]
    else:
        name_part = cell_text
    return clean(name_part), furigana


def derive_role(remark: str) -> str | None:
    compact = clean(remark)
    if not compact:
        return None
    if "副議長" in compact:
        return "副議長"
    if "議長" in compact:
        return "議長"
    if "監査" in compact:
        return "議選監査委員"
    return compact or None


def download_photo(src: str, seat: int) -> str | None:
    if not src:
        return None
    url = src if src.startswith("http") else BASE_URL + src
    ext = url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        time.sleep(0.3)
        return f"/members/atsuma/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗 {url} -> {e}")
        return None


def find_members_table(soup: BeautifulSoup):
    """ヘッダ行に「議席」「氏名」「党派」を含む表を特定する。"""
    for table in soup.find_all("table"):
        first_row = table.find("tr")
        if not first_row:
            continue
        headers = [clean(c.get_text(" ", strip=True)) for c in first_row.find_all(["th", "td"])]
        joined = "|".join(headers)
        if "議席番号" in joined and "氏名" in joined and "党派" in joined:
            return table
    return None


def scrape() -> list[dict]:
    print("厚真町議会 議員名簿を収集中...")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        return []
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    table = find_members_table(soup)
    if table is None:
        print("  [ERROR] 議員名簿テーブルを特定できませんでした")
        return []

    members: list[dict] = []
    rows = table.find_all("tr")
    for row in rows[1:]:
        cells = row.find_all(["th", "td"])
        if len(cells) < 5:
            continue

        seat_text = clean(cells[0].get_text(" ", strip=True))
        seat_match = re.search(r"\d+", seat_text)
        if not seat_match:
            continue
        seat = int(seat_match.group(0))

        name_raw = cells[1].get_text(" ", strip=True)
        name, furigana = parse_name_cell(name_raw)
        if not name:
            continue

        party_code = clean(cells[3].get_text(" ", strip=True))
        party = PARTY_MAP.get(party_code, party_code)

        remark = cells[4].get_text(" ", strip=True)
        role = derive_role(remark)

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": [],
        }
        if role:
            member["role"] = role

        img = cells[1].find("img") or row.find("img")
        if img and img.get("src"):
            photo_url = download_photo(img["src"], seat)
            if photo_url:
                member["photo_url"] = photo_url

        members.append(member)

    members.sort(key=lambda m: m["seat_number"])
    return members


def main() -> int:
    members = scrape()
    if not members:
        print("取得不可: 議員一覧を抽出できなかったため members.json は作成しません")
        return 1

    payload = json.dumps(members, ensure_ascii=False, indent=2) + "\n"
    (DATA_DIR / "members.json").write_text(payload, encoding="utf-8")
    (SITE_DATA_DIR / "members.json").write_text(payload, encoding="utf-8")

    print(f"取得議員数: {len(members)}名")
    for m in members:
        role = f" [{m.get('role')}]" if m.get("role") else ""
        print(f"  議席{m['seat_number']:>2}: {m['name']} ({m['furigana']}) {m['party']}{role}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
