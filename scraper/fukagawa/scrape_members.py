"""
深川市議会 議員名簿スクレイパー
出力: data/fukagawa/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.fukagawa.lg.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/giin/i1r7hk00000002z9.html"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "fukagawa"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "fukagawa"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "fukagawa"
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize(text: str) -> str:
    """全角スペース・連続スペースを単一スペースに統一"""
    return re.sub(r"[\s\u3000]+", " ", text).strip()


def parse_field(li_text: str, label: str) -> str:
    """「ラベル：値」形式から値を抽出"""
    m = re.match(rf"^{label}[：:]\s*(.+)$", li_text)
    return m.group(1).strip() if m else ""


def absolutize(src: str, page_url: str) -> str:
    if src.startswith("http"):
        return src
    if src.startswith("/"):
        return BASE_URL + src
    # relative
    base_dir = page_url.rsplit("/", 1)[0]
    return f"{base_dir}/{src}"


def scrape_members():
    print(f"深川市議会 議員名簿を収集中... ({MEMBERS_URL})")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        print("  ページ取得失敗")
        return

    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    section = soup.find("div", id="s0") or soup.find("main", id="main")
    if section is None:
        print("  セクションが見つかりませんでした")
        return

    members = []
    seat = 0

    # 各 h3 が議員見出し、次の div.txtPart.row に詳細
    for h3 in section.find_all("h3"):
        h3_text = normalize(h3.get_text())
        # 「○○ 議員」 形式の見出しのみ対象
        m = re.match(r"^(.+?)\s*議員$", h3_text)
        if not m:
            continue
        name_from_h3 = normalize(m.group(1))

        detail = h3.find_next_sibling("div", class_="txtPart")
        if detail is None:
            continue

        seat += 1

        # 各フィールドを抽出
        name = name_from_h3
        furigana = ""
        faction = ""
        party = ""
        committee = ""

        for li in detail.find_all("li"):
            text = normalize(li.get_text())
            if not furigana:
                v = parse_field(text, "ふりがな")
                if v:
                    furigana = v
                    continue
            v = parse_field(text, "氏名")
            if v:
                name = v
                continue
            v = parse_field(text, "所属会派等")
            if v:
                faction = v
                continue
            v = parse_field(text, "党派")
            if v:
                party = v
                continue
            v = parse_field(text, "常任委員会")
            if v:
                committee = v
                continue

        # 写真の取得
        photo_url = ""
        img = detail.find("img")
        if img and img.get("src"):
            remote_url = absolutize(img["src"], MEMBERS_URL)
            ext = remote_url.split("?")[0].rsplit(".", 1)[-1].lower()
            if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
                ext = "jpg"
            fname = f"seat_{seat}.{ext}"
            try:
                img_resp = requests.get(remote_url, headers=HEADERS, timeout=10)
                img_resp.raise_for_status()
                (PHOTO_DIR / fname).write_bytes(img_resp.content)
                photo_url = f"/members/fukagawa/{fname}"
                print(f"    写真保存: {fname}")
            except Exception as e:
                print(f"    [WARN] 写真取得失敗 {remote_url}: {e}")
            time.sleep(0.3)

        committees = []
        if committee and "所属していません" not in committee:
            committees = [committee]

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": faction,
            "committees": committees,
            "photo_url": photo_url,
        }
        members.append(member)
        print(f"  [{seat}] {name} / {furigana} / {faction} / {party}")

    if not members:
        print("  議員データが取得できませんでした")
        return

    # data/fukagawa/members.json と site/data/fukagawa/members.json の両方に出力
    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    site_out = SITE_DATA_DIR / "members.json"
    site_out.write_text(
        json.dumps(members, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n  保存: {out_path} ({len(members)}名)")
    print(f"  保存: {site_out}")


if __name__ == "__main__":
    scrape_members()
