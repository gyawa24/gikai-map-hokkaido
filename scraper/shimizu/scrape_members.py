"""
清水町議会 議員名簿スクレイパー
出力: data/shimizu/members.json
    site/data/shimizu/members.json
写真: site/public/members/shimizu/seat_N.jpg
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.shimizu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/introduction/"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "shimizu"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "shimizu"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "shimizu"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize_ws(s: str) -> str:
    # 全角スペース・連続空白を1個の半角スペースに
    s = s.replace("\u3000", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


PARTY_KEYWORDS = [
    "自民党", "自由民主党",
    "立憲民主党", "立民",
    "国民民主党", "国民",
    "公明党",
    "日本共産党", "共産党",
    "日本維新の会", "維新",
    "れいわ新選組", "れいわ",
    "社民党", "社会民主党",
    "参政党",
    "NHK党",
    "無所属",
]


def pick_party(text: str) -> str:
    t = normalize_ws(text)
    for kw in PARTY_KEYWORDS:
        if kw in t:
            # 「日本共産党」「共産党」などは長い方優先で最初の一致を採用
            return kw
    return ""


def extract_committees_from_li(li) -> list[str]:
    """委員会の<li>から、<br>と<p>を改行として分割して項目化する。"""
    # <br> を改行に変換
    # html.parser は `<br />` を自己閉じと扱わず後続要素を子扱いするため、
    # unwrap で「<br>その先</br>」の子要素を保持しつつ <br> 開始点に改行を挿入する。
    for br in list(li.find_all("br")):
        br.insert_before("\n")
        br.unwrap()

    raw_items: list[str] = []
    ps = li.find_all("p")
    if ps:
        for p in ps:
            for piece in p.get_text().split("\n"):
                piece = normalize_ws(piece)
                if not piece or piece == "所属委員会":
                    continue
                raw_items.append(piece)
    else:
        text = li.get_text()
        text = re.sub(r"^\s*所属委員会\s*", "", text)
        for piece in text.split("\n"):
            piece = normalize_ws(piece)
            if piece:
                raw_items.append(piece)

    out: list[str] = []
    seen = set()
    for p in raw_items:
        if not re.search(r"委員会|委員長|監査委員", p):
            continue
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


def scrape_members() -> list[dict]:
    print("清水町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    boxes = soup.select("div.giin-box")
    print(f"  giin-box {len(boxes)} 件検出")
    if not boxes:
        return []

    members: list[dict] = []
    for box in boxes:
        # 議席番号
        seat_text = ""
        seat_el = box.select_one("div.nam")
        if seat_el:
            seat_text = normalize_ws(seat_el.get_text(" ", strip=True))
        m = re.search(r"(\d+)", seat_text)
        if not m:
            continue
        seat_number = int(m.group(1))

        # 氏名・ふりがな
        kana_el = box.select_one(".name .kana")
        furigana = normalize_ws(kana_el.get_text(" ", strip=True)) if kana_el else ""

        name_p = box.select_one(".name p")
        name = ""
        if name_p:
            # <span class="age"> を除去してから取得
            for age in name_p.select("span.age"):
                age.extract()
            name = normalize_ws(name_p.get_text(" ", strip=True))
        if not name:
            continue

        # 政党・委員会
        ul = box.select_one("div.text > ul")
        party = ""
        committees: list[str] = []
        if ul:
            lis = ul.find_all("li", recursive=False)
            for li in lis:
                li_text = normalize_ws(li.get_text(" ", strip=True))
                if not li_text:
                    continue
                # 「所属委員会」ラベルのある li を委員会情報として処理
                if li.find("span", string=re.compile(r"所属委員会")) or "所属委員会" in li_text:
                    committees = extract_committees_from_li(li)
                    continue
                # 「期数」を含む項目はスキップ
                if li.find("span", string=re.compile(r"期数")) or re.fullmatch(r"期数\s*\d+\s*期", li_text):
                    continue
                # それ以外で政党名らしきもの
                p = pick_party(li_text)
                if p and not party:
                    party = p

        # faction: 議長・副議長表記（「12番は副議長」などから抽出。数値境界に注意）
        faction = ""
        page_notes = soup.select_one("ul.flex-list")
        if page_notes:
            notes_text = page_notes.get_text(" ", strip=True)
            if re.search(rf"(?<!\d){seat_number}番\s*は?\s*議長", notes_text):
                faction = "議長"
            elif re.search(rf"(?<!\d){seat_number}番\s*は?\s*副議長", notes_text):
                faction = "副議長"

        # 写真
        img = box.select_one("div.image img")
        photo_url = ""
        if img and img.get("src"):
            src = img["src"].strip()
            remote_url = src if src.startswith("http") else BASE_URL + src
            ext = remote_url.split("?")[0].rsplit(".", 1)[-1].lower() or "jpg"
            if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
                ext = "jpg"
            fname = f"seat_{seat_number}.{ext}"
            try:
                img_resp = requests.get(remote_url, headers=HEADERS, timeout=15)
                img_resp.raise_for_status()
                (PHOTO_DIR / fname).write_bytes(img_resp.content)
                photo_url = f"/members/shimizu/{fname}"
                time.sleep(0.3)
            except Exception as e:
                print(f"  [WARN] 写真取得失敗 seat={seat_number}: {e}")

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": faction,
            "committees": committees,
        }
        if photo_url:
            member["photo_url"] = photo_url

        members.append(member)
        print(f"  [{seat_number:>2}] {name} / {party or '-'} / {faction or '-'} / 委員会={committees}")

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データが1件も取得できませんでした")
        return

    payload = {"members": members}
    for out_dir in (DATA_DIR, SITE_DATA_DIR):
        out_file = out_dir / "members.json"
        out_file.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {out_file}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
