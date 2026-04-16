"""
名寄市議会 議員名簿スクレイパー
出力: data/nayoro/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "http://www.city.nayoro.lg.jp"
MEMBERS_URL = f"{BASE_URL}/assembly/l5o8uj000000003v.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "nayoro"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "nayoro"
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


def download_photo(url: str, dest: Path) -> bool:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        return True
    except Exception as e:
        print(f"  [PHOTO ERROR] {url} -> {e}")
        return False


def extract_furigana(text: str) -> str:
    """括弧内のひらがなを抽出"""
    m = re.search(r'[（(]([ぁ-んー\s　]+)[）)]', text)
    if m:
        return m.group(1).strip()
    return ""


def scrape_members():
    print("名寄市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    members = []

    # ページ内目次から議員リストを把握
    # 各議員のセクションは h2/h3 または定型パターンで区切られている
    # 実際のHTMLを解析: 議席番号N：名前（ふりがな） のパターン
    main = soup.find(id="main") or soup.find("div", class_="main") or soup

    # 全テキストブロックを取得し、議員エントリを解析
    # HTMLから直接パターンマッチング
    text_content = soup.get_text("\n")

    # 写真リスト（ロゴ除く）
    imgs = [
        img for img in soup.find_all("img")
        if "l5o8uj000000003v-img" in img.get("src", "")
    ]
    print(f"  写真 {len(imgs)} 件発見")

    # 議席番号と名前のパターンを抽出
    # "議席番号N：名前（ふりがな）" または "議員番号N：名前（ふりがな）"
    seat_pattern = re.compile(
        r'議[席員]番号(\d+)：([\u4e00-\u9fff\u3000-\u303f\s　]+)[（(]([ぁ-んー\s　]+)[）)]'
    )

    # soup のテキストから抽出
    raw_text = soup.get_text("\n")
    matches = list(seat_pattern.finditer(raw_text))
    print(f"  議員エントリ {len(matches)} 件発見")

    # 各議員の詳細情報を取得するため、HTML構造を使う
    # 各議員ブロックは <h2> or <h3> タグ、または特定のパターンで区切られている
    # テキスト全体を行ごとに解析
    lines = [l.strip() for l in raw_text.split("\n") if l.strip()]

    # 各議員の情報ブロックを特定
    seat_indices = []
    for i, line in enumerate(lines):
        if re.match(r'議[席員]番号\d+：', line):
            seat_indices.append(i)

    print(f"  議員ブロック開始位置 {len(seat_indices)} 件")

    # 目次（ページ内目次）と本文の両方でマッチするため、
    # 詳細情報（●会派）を含むブロックのみを採用する
    photo_idx = 0
    for idx, start in enumerate(seat_indices):
        end = seat_indices[idx + 1] if idx + 1 < len(seat_indices) else len(lines)
        block = lines[start:end]

        # 会派情報がないブロック（目次エントリ）はスキップ
        has_detail = any(re.match(r'●会派[：:]', line) for line in block)
        if not has_detail:
            continue

        # 議席番号と名前・ふりがな
        m = re.match(r'議[席員]番号(\d+)：([\u4e00-\u9fff\u3000-\u303f\s　]+)[（(]([ぁ-んー\s　]+)[）)]', block[0])
        if not m:
            continue

        seat_number = int(m.group(1))
        name = re.sub(r'\s+', '', m.group(2))
        furigana = re.sub(r'\s+', '', m.group(3))

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        }

        # ブロック内の各行を解析
        for line in block[1:]:
            # 会派
            faction_m = re.match(r'●会派[：:]\s*(.+)', line)
            if faction_m:
                member["faction"] = faction_m.group(1).strip()
                # 会派から政党を推定
                faction = member["faction"]
                if "共産" in faction:
                    member["party"] = "日本共産党"
                elif "公明" in faction:
                    member["party"] = "公明党"
                continue

            # 委員会
            if "委員" in line and line.startswith("●"):
                committee = line.lstrip("●").strip()
                member["committees"].append(committee)

        # 写真（詳細ブロックの順番で割り当て）
        if photo_idx < len(imgs):
            src = imgs[photo_idx].get("src", "")
            if src:
                remote_url = src if src.startswith("http") else BASE_URL + src
                ext = remote_url.split(".")[-1].split("?")[0] or "jpg"
                fname = f"seat_{seat_number}.{ext}"
                print(f"  写真ダウンロード: {fname}")
                if download_photo(remote_url, PHOTO_DIR / fname):
                    member["photo_url"] = f"/members/nayoro/{fname}"
                time.sleep(0.3)
        photo_idx += 1

        members.append(member)
        print(f"  [{seat_number}] {name} ({furigana}) 会派: {member['faction']}")

    return members


def main():
    members = scrape_members()
    if not members:
        print("議員データを取得できませんでした")
        return

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {output_path}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
