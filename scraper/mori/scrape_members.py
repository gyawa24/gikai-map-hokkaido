"""
森町議会 議員名簿スクレイパー
出力: data/mori/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.hokkaido-mori.lg.jp"
MEMBERS_URL = f"{BASE_URL}/soshiki/gikai/Member_list/1605.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "mori"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUTPUT_DIR = ROOT / "site" / "data" / "mori"
SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "mori"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

NAME_RE = re.compile(r"^(.+?)[（(]([ぁ-んー\s]+)[）)]$")
SEAT_HEADER_RE = re.compile(r"^議員番号(\d+)$")
COMMITTEE_KEYWORDS = ("委員会", "広域連合議員")
ROLE_KEYWORDS = ("議長", "副議長", "監査委員")


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def absolutize(src: str) -> str:
    if src.startswith("http"):
        return src
    if src.startswith("//"):
        return "https:" + src
    if src.startswith("/"):
        return BASE_URL + src
    return BASE_URL + "/" + src


def parse_members(soup: BeautifulSoup) -> list[dict]:
    # Find the member table (the one containing "議員番号N" headers)
    target_table = None
    for t in soup.find_all("table"):
        if t.find(string=SEAT_HEADER_RE):
            target_table = t
            break
    if target_table is None:
        return []

    # Group rows by seat sections
    sections: list[tuple[int, list]] = []
    current_seat = None
    current_rows: list = []
    for tr in target_table.find_all("tr"):
        text = tr.get_text(strip=True)
        m = SEAT_HEADER_RE.match(text)
        if m:
            if current_seat is not None:
                sections.append((current_seat, current_rows))
            current_seat = int(m.group(1))
            current_rows = []
        else:
            if current_seat is not None:
                current_rows.append(tr)
    if current_seat is not None:
        sections.append((current_seat, current_rows))

    members: list[dict] = []
    for seat, rows in sections:
        # Collect all text cells (excluding photo cell which only contains img)
        texts: list[str] = []
        photo_src = None
        for tr in rows:
            for td in tr.find_all("td"):
                img = td.find("img")
                if img and img.get("src"):
                    photo_src = img["src"]
                    continue
                txt = td.get_text(" ", strip=True)
                if txt and txt != "\xa0":
                    texts.append(txt)

        # Skip vacancy (欠員): no data rows
        if not texts:
            print(f"  議席 {seat}: 欠員（スキップ）")
            continue

        # First non-empty text is "氏名（ふりがな）"
        name_raw = texts[0]
        name_match = NAME_RE.match(name_raw.replace(" ", " "))
        if name_match:
            name = re.sub(r"\s+", " ", name_match.group(1).strip())
            furigana = re.sub(r"\s+", " ", name_match.group(2).strip())
        else:
            name = name_raw
            furigana = ""

        party = ""
        faction = ""
        committees: list[str] = []
        role = ""

        for line in texts[1:]:
            line = line.strip()
            if not line or line.startswith("※"):
                continue
            if re.match(r"^(昭和|平成|令和|大正)", line) and "生" in line:
                continue  # birthdate
            if re.match(r"^当選\d+回$", line):
                continue
            if any(k in line for k in ROLE_KEYWORDS) and "委員会" not in line:
                # 議長 / 副議長 / 監査委員
                role = line if not role else role + " / " + line
                continue
            if any(k in line for k in COMMITTEE_KEYWORDS):
                committees.append(line)
                continue
            # Remaining lines are treated as party/会派
            # Known party names vs 無所属 (independent)
            if not party:
                party = line
            else:
                # extra info we don't capture
                pass

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": faction or party,
            "committees": committees,
        }
        if role:
            member["role"] = role

        # Download photo
        if photo_src:
            remote_url = absolutize(photo_src)
            ext = remote_url.split("?")[0].rsplit(".", 1)[-1].lower() or "jpg"
            if ext not in ("jpg", "jpeg", "png", "gif"):
                ext = "jpg"
            fname = f"seat_{seat}.{ext}"
            try:
                img_resp = requests.get(remote_url, headers=HEADERS, timeout=15)
                img_resp.raise_for_status()
                (PHOTO_DIR / fname).write_bytes(img_resp.content)
                member["photo_url"] = f"/members/mori/{fname}"
                time.sleep(0.3)
            except Exception as e:
                print(f"  [IMG ERROR] seat {seat}: {e}")
                member["photo_url"] = ""
        else:
            member["photo_url"] = ""

        members.append(member)
        print(
            f"  議席 {seat}: {name}（{furigana}） / {party} / "
            f"委員会 {len(committees)} 件"
        )

    return members


def main():
    print(f"森町議会 議員名簿を収集中: {MEMBERS_URL}")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  取得不可: ページ取得失敗")
        return

    members = parse_members(soup)
    if not members:
        print("  取得不可: 議員データをHTMLから抽出できませんでした")
        return

    payload = {
        "source_url": MEMBERS_URL,
        "members": members,
    }
    out = OUTPUT_DIR / "members.json"
    out.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    site_out = SITE_OUTPUT_DIR / "members.json"
    site_out.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n取得議員数: {len(members)}名")
    print(f"出力: {out}")
    print(f"出力: {site_out}")


if __name__ == "__main__":
    main()
