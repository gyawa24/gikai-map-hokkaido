"""
当麻町議会 議員名簿スクレイパー
出力: site/data/toma/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.tohma.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/parliament/01"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "toma"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "toma"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def collect_member_links(soup: BeautifulSoup) -> list[str]:
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if re.search(r"/parliament/01/\d+", href):
            full = href if href.startswith("http") else BASE_URL + href
            if full not in links:
                links.append(full)
    return links


def parse_member(soup: BeautifulSoup, seat_number: int, url: str) -> dict:
    member = {
        "seat_number": seat_number,
        "name": "",
        "furigana": "",
        "party": "",
        "faction": "",
        "committees": [],
        "photo_url": "",
    }

    # 氏名: <h2> (最初の非空)
    for h2 in soup.find_all("h2"):
        t = h2.get_text(strip=True)
        if t:
            member["name"] = re.sub(r"\s+", " ", t)
            break

    # ふりがな: field--name-field-first-name-kana + field--name-field-last-name-kana
    def get_field_by_class(fragment: str) -> str:
        for div in soup.find_all("div"):
            cls_list = div.get("class", [])
            if any(fragment in c for c in cls_list):
                return div.get_text(strip=True)
        return ""

    first_kana = get_field_by_class("field-first-name-kana")
    last_kana = get_field_by_class("field-last-name-kana")
    if first_kana or last_kana:
        member["furigana"] = f"{first_kana} {last_kana}".strip()

    # 党派: ページ本文中の「党派：〇〇」
    body_div = soup.find("div", class_=lambda c: c and "field--name-body" in " ".join(c))
    body_text = body_div.get_text(separator="\n") if body_div else soup.get_text(separator="\n")
    m = re.search(r"党派[：:]\s*([^\n\r職業役職]+)", body_text)
    if m:
        party = m.group(1).strip().rstrip("　 ")
        member["party"] = party
        member["faction"] = party

    # 委員会: 本文中から「委員会」「委員長」「副委員長」「議長」「副議長」を含む行（UIラベル除外）
    LABEL_SKIP = {"所属委員会等"}
    for line in body_text.splitlines():
        line = line.strip()
        if line and line not in LABEL_SKIP and re.search(r"委員会|委員長|副委員長|議長|副議長", line):
            if line not in member["committees"]:
                member["committees"].append(line)

    # 写真URL
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if re.search(r"gmember|member|giin|photo", src, re.I):
            remote_url = src if src.startswith("http") else BASE_URL + src
            ext = remote_url.split(".")[-1].split("?")[0] or "jpg"
            fname = f"seat_{seat_number}.{ext}"
            try:
                img_resp = requests.get(remote_url, headers=HEADERS, timeout=10)
                img_resp.raise_for_status()
                (PHOTO_DIR / fname).write_bytes(img_resp.content)
                member["photo_url"] = f"/members/toma/{fname}"
                print(f"    写真保存: {fname}")
            except Exception as e:
                print(f"    [WARN] 写真取得失敗: {e}")
            break

    return member


def scrape_members():
    print("当麻町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    member_links = collect_member_links(soup)
    print(f"  議員リンク {len(member_links)} 件発見")

    if not member_links:
        print("  議員リンクが見つかりませんでした。取得不可。")
        return

    members = []
    for i, url in enumerate(member_links):
        print(f"  [{i+1}] {url}")
        detail = fetch(url)
        time.sleep(0.5)
        if detail is None:
            print(f"    [SKIP] 取得失敗")
            continue
        member = parse_member(detail, i + 1, url)
        print(f"    氏名: {member['name']} / ふりがな: {member['furigana']} / 会派: {member['faction']}")
        members.append(member)

    if not members:
        print("  議員データが取得できませんでした。")
        return

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完了: {len(members)} 名 -> {out_path}")


if __name__ == "__main__":
    scrape_members()
