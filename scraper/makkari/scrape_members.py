"""
真狩村議会 議員名簿スクレイパー
出力: data/makkari/members.json, site/data/makkari/members.json
写真: site/public/members/makkari/seat_N.jpg
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.vill.makkari.lg.jp"
MEMBERS_URL = f"{BASE_URL}/songikai/ginnshokai/"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "makkari"
SITE_DATA_DIR = ROOT / "site" / "data" / "makkari"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "makkari"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

FURIGANA_RE = re.compile(r"（([ぁ-ゞ\s　]+)）")
ELECTION_RE = re.compile(r"当選回数[:：]?\s*(\d+)")


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def download_image(url: str, dest: Path) -> bool:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        return True
    except Exception as e:
        print(f"  [IMG ERROR] {url} -> {e}")
        return False


def parse_member_block(text: str) -> dict:
    """テキストブロックから氏名・ふりがな・役職等を抽出"""
    result = {
        "name": "",
        "furigana": "",
        "position": "",
        "election_count": None,
        "committees": [],
        "other_posts": [],
    }

    # 氏名とふりがな（例: 佐伯 秀範（さいき ひでのり））
    name_match = re.search(r"([一-龥々ヶ]+[\s　]+[一-龥々ヶ]+)[\s　]*（([ぁ-ゞ\s　]+)）", text)
    if name_match:
        result["name"] = re.sub(r"[\s　]+", " ", name_match.group(1).strip())
        result["furigana"] = re.sub(r"[\s　]+", " ", name_match.group(2).strip())

    # 当選回数
    em = ELECTION_RE.search(text)
    if em:
        result["election_count"] = int(em.group(1))

    return result


def scrape_members():
    print(f"真狩村議会 議員名簿を収集中: {MEMBERS_URL}")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    members = []

    # 本文領域を特定（真狩村サイトは記事本文が特定クラスに無いため body 全体を使用）
    content = (
        soup.find("main")
        or soup.find("article")
        or soup.find(id=re.compile(r"content|main", re.I))
        or soup.body
        or soup
    )

    # 画像を起点に議員ブロックを検出
    images = content.find_all("img", src=re.compile(r"thumb.*\.(jpe?g|png)", re.I))
    # 議員写真らしきものだけ
    member_imgs = [img for img in images if img.get("src") and re.search(r"release/\d+", img["src"])]

    print(f"  候補画像 {len(member_imgs)} 件")

    # もしくは全文テキストをパースして議員ブロック単位に分割する方式
    full_text = content.get_text("\n", strip=True)

    # 議員ブロックを「氏名（ふりがな）」の出現位置で分割
    name_pattern = re.compile(r"([一-龥々ヶ]{1,4}[\s　]+[一-龥々ヶ]{1,4})[\s　]*（([ぁ-ゞ\s　]+)）")
    matches = list(name_pattern.finditer(full_text))
    print(f"  氏名候補 {len(matches)} 件")

    if not matches:
        print("  議員名のパターンが見つかりません")
        return None

    # 本文末尾（連絡先・フッタ）を除外する境界を検出
    footer_match = re.search(r"このページの情報に関するお問い合わせ先", full_text)
    text_end = footer_match.start() if footer_match else len(full_text)

    # 各一致の範囲を決定してブロックを切り出す
    blocks = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else text_end
        blocks.append((m, full_text[start:end]))

    # 画像URLは出現順に対応すると仮定
    img_urls = [urljoin(BASE_URL, img["src"]) for img in member_imgs]

    for idx, (m, block) in enumerate(blocks):
        seat = idx + 1
        name = re.sub(r"[\s　]+", " ", m.group(1).strip())
        furigana = re.sub(r"[\s　]+", " ", m.group(2).strip())

        position = ""
        committees = []
        other_posts = []
        election_count = None

        # ブロック内のセクション構造:
        #   当選回数　　　X回
        #   役職・常任委員会等　　　<役職・委員会が改行区切りで1行以上>
        #   その他の役職　　　　　<組合議会・議員会などが改行区切りで0行以上>
        section = None  # "role" | "other" | None
        for raw_line in block.split("\n"):
            line = raw_line.strip()
            if not line:
                continue

            em = ELECTION_RE.search(line)
            if em:
                election_count = int(em.group(1))
                section = None
                continue

            # セクション切替ラベルを検出（値が後ろに続く場合は切り出す）
            role_label = re.match(r"役職・常任委員会等[\s　]*(.*)$", line)
            other_label = re.match(r"その他の役職[\s　]*(.*)$", line)
            if role_label:
                section = "role"
                line = role_label.group(1).strip()
                if not line:
                    continue
            elif other_label:
                section = "other"
                line = other_label.group(1).strip()
                if not line:
                    continue

            # 氏名行・ふりがな行はスキップ
            if re.search(r"（[ぁ-ゞ\s　]+）", raw_line):
                continue

            if section == "role":
                if line in ("議長", "副議長"):
                    position = line
                else:
                    committees.append(line)
            elif section == "other":
                other_posts.append(line)

        # 重複除去
        committees = list(dict.fromkeys([c for c in committees if c]))
        other_posts = list(dict.fromkeys([o for o in other_posts if o]))

        photo_url = ""
        if idx < len(img_urls):
            remote_url = img_urls[idx]
            ext = remote_url.split(".")[-1].split("?")[0].lower()
            if ext not in ("jpg", "jpeg", "png"):
                ext = "jpg"
            fname = f"seat_{seat}.{ext}"
            if download_image(remote_url, PHOTO_DIR / fname):
                photo_url = f"/members/makkari/{fname}"
            time.sleep(0.3)

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": "",
            "position": position,
            "election_count": election_count,
            "committees": committees,
            "other_posts": other_posts,
            "photo_url": photo_url,
        }
        members.append(member)
        print(f"  [{seat}] {name} ({furigana}) {position} 当{election_count or '?'}回")

    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データが抽出できませんでした")
        return

    output = {
        "source_url": MEMBERS_URL,
        "count": len(members),
        "members": members,
    }

    for out_dir in (DATA_DIR, SITE_DATA_DIR):
        out_path = out_dir / "members.json"
        out_path.write_text(
            json.dumps(output, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き込み: {out_path}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
