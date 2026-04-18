"""
当麻町議会 議員名簿スクレイパー
出力: site/data/toma/members.json

公式サイト: https://www.town.tohma.hokkaido.jp/parliament/01
各議員プロフィール: /parliament/01/{node_id}
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


def find_field(soup: BeautifulSoup, name_fragment: str) -> BeautifulSoup | None:
    """Drupal の field--name-field-XXX から本体 div を取得。"""
    for div in soup.find_all("div"):
        cls_list = div.get("class") or []
        if any(name_fragment in c for c in cls_list):
            return div
    return None


def extract_field_value(soup: BeautifulSoup, name_fragment: str) -> str:
    div = find_field(soup, name_fragment)
    if not div:
        return ""
    # field__item の中身を優先（label は除外）
    item = div.find("div", class_=lambda c: c and "field__item" in c)
    target = item if item else div
    return target.get_text(strip=True)


def parse_member(soup: BeautifulSoup, url: str) -> dict:
    member = {
        "seat_number": 0,
        "name": "",
        "furigana": "",
        "party": "",
        "faction": "",
        "committees": [],
        "photo_url": "",
    }

    # 氏名: 記事見出しの <h2>
    for h2 in soup.find_all("h2"):
        t = h2.get_text(strip=True)
        if t:
            member["name"] = re.sub(r"\s+", " ", t)
            break

    # ふりがな
    first_kana = extract_field_value(soup, "field-first-name-kana")
    last_kana = extract_field_value(soup, "field-last-name-kana")
    if first_kana or last_kana:
        member["furigana"] = f"{first_kana} {last_kana}".strip()

    # 議席番号 (例: "1番")
    seat_text = extract_field_value(soup, "field-seat")
    m = re.search(r"(\d+)", seat_text)
    if m:
        member["seat_number"] = int(m.group(1))

    # 本文 (所属委員会等)
    # label-above を持つ field--name-body を探す（ロゴ用の label-hidden と区別）
    body_div = None
    for d in soup.find_all("div"):
        cls = " ".join(d.get("class") or [])
        if "field--name-body" in cls and "label-above" in cls:
            body_div = d
            break

    if body_div:
        # 党派
        body_text = body_div.get_text(separator="\n")
        m = re.search(r"党派[：:]\s*(.+)", body_text)
        if m:
            party = m.group(1).strip()
            member["party"] = party
            member["faction"] = party

        # 役職（委員会等）: <li> タグから抽出
        for li in body_div.find_all("li"):
            text = li.get_text(strip=True)
            if text and text not in member["committees"]:
                member["committees"].append(text)

    # 写真
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if re.search(r"gmember|giin|member|photo", src, re.I):
            remote_url = src if src.startswith("http") else BASE_URL + src
            ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
            if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
                ext = "jpg"
            seat = member["seat_number"] or 0
            fname = f"seat_{seat}.{ext}"
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
        member = parse_member(detail, url)
        if not member["name"]:
            print(f"    [SKIP] 氏名取得失敗")
            continue
        print(
            f"    議席:{member['seat_number']} 氏名:{member['name']} "
            f"ふりがな:{member['furigana']} 会派:{member['faction']} "
            f"委員会:{len(member['committees'])}件"
        )
        members.append(member)

    if not members:
        print("  議員データが取得できませんでした。")
        return

    members.sort(key=lambda x: x["seat_number"] or 999)

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n完了: {len(members)} 名 -> {out_path}")


if __name__ == "__main__":
    scrape_members()
