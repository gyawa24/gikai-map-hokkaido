"""
浜中町議会 議員名簿スクレイパー
出力:
  - data/hamanaka/members.json
  - site/data/hamanaka/members.json
  - site/public/members/hamanaka/seat_N.ext
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

BASE_URL = "https://www.townhamanaka.jp"
MEMBERS_URL = f"{BASE_URL}/gyousei/2019-1120-0948-33.html"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "hamanaka"
SITE_DATA_DIR = ROOT / "site" / "data" / "hamanaka"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "hamanaka"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def soupify(resp: requests.Response) -> BeautifulSoup:
    resp.encoding = resp.apparent_encoding
    return BeautifulSoup(resp.text, "html.parser")


def clean(s: str) -> str:
    if s is None:
        return ""
    return re.sub(r"\s+", "", s).strip()


def parse_committees(text: str) -> list[str]:
    if not text:
        return []
    # 区切り: 読点・カンマ・中黒・改行
    parts = re.split(r"[、,，・\n]+", text)
    return [p.strip() for p in parts if p.strip()]


def download_photo(src: str, seat_number: int, page_url: str) -> str:
    remote_url = urljoin(page_url, src)
    ext = remote_url.split("?")[0].split(".")[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "gif"):
        ext = "jpg"
    fname = f"seat_{seat_number}.{ext}"
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/hamanaka/{fname}"
    except Exception as e:
        print(f"    [WARN] photo download failed: {remote_url} -> {e}")
        return ""


def scrape_members() -> list[dict]:
    print("浜中町議会 議員名簿を収集中...")
    print(f"  URL: {MEMBERS_URL}")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        return []
    soup = soupify(resp)

    members: list[dict] = []

    tables = soup.find_all("table")
    print(f"  テーブル {len(tables)} 件発見")

    for t_idx, table in enumerate(tables):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue

        # ヘッダ行を検出
        header_cells = [clean(c.get_text()) for c in rows[0].find_all(["th", "td"])]
        header_text = "".join(header_cells)
        if not any(k in header_text for k in ("議席", "氏名")):
            continue

        print(f"  議員テーブル発見 (table #{t_idx}): cols={header_cells}")

        # 列インデックス判定
        def find_col(keywords: list[str]) -> int:
            for i, h in enumerate(header_cells):
                for k in keywords:
                    if k in h:
                        return i
            return -1

        col_seat = find_col(["議席"])
        col_name = find_col(["氏名", "名前"])
        col_party = find_col(["会派", "党派", "所属"])
        col_committee = find_col(["委員会", "役職"])

        for row in rows[1:]:
            cells = row.find_all(["td", "th"])
            if not cells:
                continue
            texts = [clean(c.get_text(separator=" ")) for c in cells]

            # 議席番号
            seat_raw = texts[col_seat] if 0 <= col_seat < len(texts) else ""
            m = re.search(r"\d+", seat_raw)
            if not m:
                continue
            seat_number = int(m.group(0))

            # 氏名 + ふりがな（セル内に両方入る構成が多い）
            name_cell_html = cells[col_name] if 0 <= col_name < len(cells) else None
            name = ""
            furigana = ""
            if name_cell_html is not None:
                raw_name = name_cell_html.get_text(separator="\n")
                lines = [l.strip() for l in raw_name.split("\n") if l.strip()]
                # ふりがな = ひらがなのみの行
                for l in lines:
                    if re.fullmatch(r"[ぁ-んー\s]+", l):
                        furigana = re.sub(r"\s+", "", l)
                    else:
                        if not name:
                            name = re.sub(r"\s+", "", l)
                # 欠員判定
                if "欠員" in name or "欠員" in raw_name:
                    print(f"    議席{seat_number}: 欠員のためスキップ")
                    continue

            if not name:
                continue

            # 「党派所属委員会等」列に党派と委員会が混在している。
            # 1要素目が党派、残りが委員会・役職。
            mix_text = texts[col_party] if 0 <= col_party < len(texts) else ""
            mix = parse_committees(mix_text)
            party = mix[0] if mix else ""
            committees = mix[1:] if len(mix) > 1 else []

            # 写真
            photo_url = ""
            img = row.find("img")
            if img and img.get("src"):
                photo_url = download_photo(img["src"], seat_number, MEMBERS_URL)
                time.sleep(0.3)

            member = {
                "seat_number": seat_number,
                "name": name,
                "furigana": furigana,
                "party": party,
                "faction": party,
                "committees": committees,
            }
            if photo_url:
                member["photo_url"] = photo_url

            members.append(member)
            print(f"    [{seat_number}] {name} ({furigana}) / {party} / {committees}")

        break  # 最初に見つけた議員テーブルのみ処理

    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データを取得できませんでした")
        return

    members.sort(key=lambda m: m["seat_number"])
    out = {"members": members}

    (DATA_DIR / "members.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (SITE_DATA_DIR / "members.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n取得議員数: {len(members)}名")
    print(f"  -> {DATA_DIR / 'members.json'}")
    print(f"  -> {SITE_DATA_DIR / 'members.json'}")


if __name__ == "__main__":
    main()
