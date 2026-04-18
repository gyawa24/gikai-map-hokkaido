"""
足寄町議会 議員名簿スクレイパー
出力: data/ashoro/members.json
写真: site/public/members/ashoro/seat_N.jpg

ハードコード禁止: 議員氏名等は必ず公式サイトから動的に取得する。
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.ashoro.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/giin/page_4.html"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "ashoro"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "ashoro"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "ashoro"

for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch_html(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize_text(s: str) -> str:
    # 全角スペース・連続空白を1スペースへ正規化
    s = s.replace("\u3000", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def collapse_padding_spaces(s: str) -> str:
    # 公式ページは見栄えのため "副 議 長" のように1文字ごとに全角スペースを入れている。
    # 空白で区切ったトークンが全て1文字なら連結する（例: "副 議 長" -> "副議長"）。
    tokens = s.split(" ")
    if len(tokens) >= 2 and all(len(t) == 1 for t in tokens):
        return "".join(tokens)
    return s


def parse_committees(text: str) -> list[str]:
    text = text.replace("\u3000", " ")
    parts = []
    for raw in re.split(r"[|｜\n]", text):
        p = re.sub(r"\s+", " ", raw).strip()
        if p:
            parts.append(collapse_padding_spaces(p))
    return parts


def download_photo(remote_urls: list[str], seat: int) -> str:
    # 複数候補を順に試す（同じ写真の異なる拡張子表記が並んでいることがある）
    for remote_url in remote_urls:
        ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
        if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
            ext = "jpg"
        fname = f"seat_{seat}.{ext}"
        try:
            resp = requests.get(remote_url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            (PHOTO_DIR / fname).write_bytes(resp.content)
            return f"/members/ashoro/{fname}"
        except Exception as e:
            print(f"    [WARN] photo failed {remote_url} -> {e}")
    return ""


def scrape() -> list[dict]:
    print(f"足寄町議会 議員名簿を収集中... ({MEMBERS_URL})")
    soup = fetch_html(MEMBERS_URL)
    if soup is None:
        return []

    table = soup.find("table")
    if table is None:
        print("  [ERROR] table 要素が見つかりません")
        return []

    rows = table.find_all("tr")
    # 1人あたり 4行: [photo|seat|committees], [furigana|age], [name|term], [party]
    members: list[dict] = []
    i = 0
    while i + 3 < len(rows):
        r0 = rows[i].find_all(["td", "th"])
        # 議員ブロックの先頭は3セル（写真・議席・委員会）
        if len(r0) != 3:
            i += 1
            continue
        seat_text = normalize_text(r0[1].get_text())
        if not seat_text.isdigit():
            i += 1
            continue

        seat = int(seat_text)
        committees = parse_committees(r0[2].get_text("\n"))

        photo_url = ""
        imgs = r0[0].find_all("img")
        candidates: list[str] = []
        for im in imgs:
            src = im.get("src")
            if not src:
                continue
            candidates.append(src if src.startswith("http") else BASE_URL + src)
        if candidates:
            time.sleep(0.3)
            photo_url = download_photo(candidates, seat)

        r1 = rows[i + 1].find_all(["td", "th"])
        r2 = rows[i + 2].find_all(["td", "th"])
        r3 = rows[i + 3].find_all(["td", "th"])

        furigana = normalize_text(r1[0].get_text()) if len(r1) >= 1 else ""
        name = normalize_text(r2[0].get_text()) if len(r2) >= 1 else ""
        party = normalize_text(r3[0].get_text()) if len(r3) >= 1 else ""

        # 公式ページは見栄え調整のため氏名の各文字間に全角スペースを入れている。
        # ふりがな（仮名）と党派名は表記そのまま、氏名は連結して保存する。
        name = re.sub(r"\s+", "", name)
        furigana = re.sub(r"\s+", " ", furigana).strip()
        party = party.replace(" ", "")

        if not name:
            i += 4
            continue

        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": committees,
            "photo_url": photo_url,
        })
        print(f"  [{seat:2d}] {name} ({furigana}) / {party} / committees={len(committees)} / photo={'OK' if photo_url else '-'}")

        i += 4

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape()
    if not members:
        print("取得不可: 議員データを抽出できませんでした")
        return

    out = {
        "source_url": MEMBERS_URL,
        "members": members,
    }
    payload = json.dumps(out, ensure_ascii=False, indent=2)
    (DATA_DIR / "members.json").write_text(payload, encoding="utf-8")
    (SITE_DATA_DIR / "members.json").write_text(payload, encoding="utf-8")
    print(f"\n取得議員数: {len(members)}名")
    print(f"  -> {DATA_DIR / 'members.json'}")
    print(f"  -> {SITE_DATA_DIR / 'members.json'}")


if __name__ == "__main__":
    main()
