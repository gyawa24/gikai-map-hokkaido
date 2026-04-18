"""
鶴居村議会 議員名簿スクレイパー
出力: data/tsurui/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.vill.tsurui.lg.jp"
MEMBERS_URL = f"{BASE_URL}/muranoshokai_sonsei/tsuruimuragikai/923.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "site" / "data" / "tsurui"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR = ROOT / "data" / "tsurui"
DATA_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "tsurui"
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


def normalize_url(src: str) -> str:
    if src.startswith("//"):
        return "https:" + src
    if src.startswith("/"):
        return BASE_URL + src
    return src


def extract_committees(section_text: str) -> list[str]:
    """役職・委員会文字列から委員会名を抽出"""
    committees = []
    for line in section_text.splitlines():
        line = line.strip()
        if not line:
            continue
        # 委員会・議員を含む行を収集（議会運営・常任・広聴・消防組合議会など）
        if "委員会" in line or "組合議会" in line:
            # "【役職】"プレフィックスを除去
            line = re.sub(r"^【[^】]+】", "", line).strip()
            if line and line not in committees:
                committees.append(line)
    return committees


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext.upper() == "JPG":
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/tsurui/{fname}"
    except Exception as e:
        print(f"    [WARN] photo download failed: {remote_url} -> {e}")
        return ""


def parse_member_block(h2, container) -> dict | None:
    """h2（氏名）とその後続コンテナ（cmstag div）から議員情報を抽出"""
    # 氏名・ふりがな: "松井 俊治（まつい しゅんじ）"
    title = h2.get_text(strip=True)
    m = re.match(r"^(.+?)[（(]([ぁ-んー\s]+)[)）]$", title)
    if not m:
        return None
    name = re.sub(r"\s+", " ", m.group(1)).strip()
    furigana = re.sub(r"\s+", " ", m.group(2)).strip()

    block_text = container.get_text("\n", strip=False)

    # 議席番号
    seat = None
    m2 = re.search(r"【議席番号】\s*(\d+)\s*番", block_text)
    if m2:
        seat = int(m2.group(1))

    # 党派
    party = ""
    m3 = re.search(r"【党派】\s*([^\n]+)", block_text)
    if m3:
        party = m3.group(1).strip()

    # 役職以降の段落から委員会抽出
    # 【役職】以降、【在職期数】より前までを対象にする
    m4 = re.search(r"【役職】([\s\S]*?)(?=【在職期数】|【|$)", block_text)
    role_section = m4.group(1) if m4 else ""
    # 役職行自体も含めて処理するため先頭に「【役職】」を付けない
    committees = extract_committees(role_section)

    # 写真
    photo_url = ""
    img = container.find("img")
    if img and img.get("src"):
        remote = normalize_url(img["src"])
        if seat is not None:
            photo_url = download_photo(remote, seat)

    return {
        "seat_number": seat if seat is not None else 0,
        "name": name,
        "furigana": furigana,
        "party": party,
        "faction": "",
        "committees": committees,
        "photo_url": photo_url,
    }


def scrape_members():
    print("鶴居村議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    members = []
    # 各議員は h2（氏名）→ 直後の div.cmstag に情報が入っている
    h2s = soup.find_all("h2")
    for h2 in h2s:
        title = h2.get_text(strip=True)
        if not re.search(r"[（(][ぁ-ん\s]+[)）]$", title):
            continue
        # 次の兄弟要素から cmstag を探す
        sib = h2
        container = None
        for _ in range(10):
            sib = sib.find_next_sibling()
            if sib is None:
                break
            if sib.name == "div" and "cmstag" in (sib.get("class") or []):
                container = sib
                break
            # 稀に入れ子しているケースにも対応
            inner = sib.find("div", class_="cmstag") if hasattr(sib, "find") else None
            if inner:
                container = inner
                break
        if container is None:
            continue

        print(f"  処理中: {title}")
        member = parse_member_block(h2, container)
        if member:
            members.append(member)
        time.sleep(0.2)

    # 議席番号でソート
    members.sort(key=lambda m: m["seat_number"])

    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データが取得できませんでした")
        return
    # data/tsurui/ と site/data/tsurui/ 両方に書き出す
    out_paths = [
        DATA_DIR / "members.json",
        OUTPUT_DIR / "members.json",
    ]
    for p in out_paths:
        p.write_text(
            json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  書き出し: {p}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
