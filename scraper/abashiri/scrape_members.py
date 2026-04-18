"""
網走市議会 議員名簿スクレイパー
出力: data/abashiri/members.json

ページ構造:
  - 議員一覧ページ: /site/gikai/1559.html
  - 各議員は <div class="detail_free"> 内の <p> タグで表現
  - <p> 内には <img>（写真）、br 区切りのテキスト行が並ぶ
      1行目: 「氏名（XX歳）X期」
      2行目: 会派（例: 希政会、研政会、同志会、無会派、公明クラブ、日本共産党議員団）
      3行目以降: 委員会・役職（議長/副議長/委員長/副委員長 など）
      末尾（任意）: <a>議員webサイト</a>
  - ふりがな・政党・議席番号の記載はなし（政党は会派名から推定可能な場合のみ付与）
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.abashiri.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/site/gikai/1559.html"
ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "abashiri"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "abashiri"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

NAME_LINE_RE = re.compile(r"^(.+?)[（(]\s*\d+\s*歳[)）]\s*\d+\s*期")

# 会派名→政党名のマッピング（明示できるもののみ）
FACTION_TO_PARTY = {
    "日本共産党議員団": "日本共産党",
    "公明クラブ": "公明党",
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


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/abashiri/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗 {remote_url} -> {e}")
        return ""


def parse_member_p(p, seat: int) -> dict | None:
    img = p.find("img")
    if img is None:
        return None

    # <p> 内のテキストを br 区切りで行に分割
    lines: list[str] = []
    for node in p.children:
        if getattr(node, "name", None) == "br":
            continue
        if getattr(node, "name", None) == "img":
            continue
        if getattr(node, "name", None) == "span":
            # <外部リンク> などは無視
            continue
        if getattr(node, "name", None) == "a":
            # 議員webサイトリンクは会派・委員会情報ではないのでスキップ
            continue
        text = node.get_text(" ", strip=True) if hasattr(node, "get_text") else str(node).strip()
        # ゼロ幅スペース等を除去
        text = text.replace("\u200b", "").replace("\u3000", " ").strip()
        if text:
            lines.append(text)

    if not lines:
        return None

    # 1行目が氏名行
    m = NAME_LINE_RE.match(lines[0])
    if not m:
        return None
    name = m.group(1).strip()
    # 全角・半角スペースを統一
    name = re.sub(r"\s+", " ", name)

    rest = lines[1:]
    if not rest:
        return None

    faction = rest[0].strip()
    committees_raw = [x.strip() for x in rest[1:] if x.strip()]

    # 委員会名・役職を分離
    committees: list[str] = []
    for item in committees_raw:
        # 空白やリンクテキスト残骸を除外
        if item in ("議員webサイト", "＜外部リンク＞"):
            continue
        committees.append(item)

    # 写真
    src = img.get("src", "")
    remote_url = src if src.startswith("http") else BASE_URL + src
    photo_url = download_photo(remote_url, seat) if remote_url else ""
    time.sleep(0.2)

    party = FACTION_TO_PARTY.get(faction, "")

    return {
        "seat_number": seat,
        "name": name,
        "furigana": "",
        "party": party,
        "faction": faction,
        "committees": committees,
        "photo_url": photo_url,
    }


def scrape_members():
    print("網走市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    container = soup.find("div", class_="detail_free")
    if container is None:
        print("  議員一覧コンテナ(.detail_free)が見つかりません")
        return

    # 議員画像を含む <p> のみを対象とする
    member_ps = [p for p in container.find_all("p") if p.find("img") is not None]
    print(f"  議員ブロック {len(member_ps)} 件発見")

    members: list[dict] = []
    for i, p in enumerate(member_ps, start=1):
        m = parse_member_p(p, i)
        if m is None:
            print(f"  [{i}] パース失敗（スキップ）")
            continue
        print(f"  [{i}] {m['name']} / {m['faction']} / 委員会{len(m['committees'])}件")
        members.append(m)

    if not members:
        print("  議員データが取得できませんでした")
        return

    out = OUTPUT_DIR / "members.json"
    out.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\n完了: {out} ({len(members)}名)")


if __name__ == "__main__":
    scrape_members()
