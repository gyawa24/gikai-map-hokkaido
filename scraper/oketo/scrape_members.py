"""
置戸町議会 議員名簿スクレイパー
出力: data/oketo/members.json, site/data/oketo/members.json

HTML構造: 議員ごとに <h3 class="art-head-L"><span> N．氏名</span></h3> のヘッダと
対応する <div class="paragraph ... img_txt"> ブロックが並ぶ。
ブロック内の <img> が写真、<li>議席番号：N</li>・<li>氏名：…</li>・<li>所属委員会：</li>
の後にテキスト（改行区切り）で委員会名が続く。
ふりがなは一覧ページに無いが、町議会公式がふりがなを提供していないためスキップ。
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.oketo.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/giin/"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "oketo"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "oketo"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "oketo"

for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

SEAT_TITLE_RE = re.compile(r"^\s*(\d+)[．.。]\s*(.+?)\s*$")


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def parse_committees(txt_div) -> list[str]:
    """txt列の<br>区切りテキストから委員会名を抽出。
    「所属委員会：」の <li> より後、次の <ul> までが委員会リスト。
    """
    raw = txt_div.decode_contents()
    # 「所属委員会：</li></ul>」の後から次の <ul> までを取得
    m = re.search(r"所属委員会[：:]\s*</li>\s*</ul>(.*?)(?:<ul|$)", raw, re.S)
    if not m:
        return []
    chunk = m.group(1)
    # HTMLタグを除去して <br> を改行に
    chunk = re.sub(r"<br\s*/?>", "\n", chunk, flags=re.I)
    chunk = re.sub(r"<[^>]+>", "", chunk)
    chunk = chunk.replace("&nbsp;", " ").replace("\u3000", " ")
    committees: list[str] = []
    for line in chunk.split("\n"):
        name = line.strip().strip("・").strip()
        if not name:
            continue
        committees.append(name)
    return committees


def scrape():
    print("置戸町議会 議員名簿を収集中...")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        print("  ページ取得失敗")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    members: list[dict] = []

    # 各議員ヘッダ <h3 class="art-head-L"> を順に処理
    headers = soup.select("h3.art-head-L")
    print(f"  議員ヘッダ {len(headers)} 件検出")

    for h3 in headers:
        title = h3.get_text(strip=True).replace("\u3000", " ")
        m = SEAT_TITLE_RE.match(title)
        if not m:
            continue
        # タイトルの議席番号は検証用に取得。正式な番号は詳細内の「議席番号：N」を優先。
        title_seat = int(m.group(1))
        # 名前は詳細ブロックの「氏名：…」から取るのでタイトルからは補助のみ
        # 対応する詳細ブロックは同じ親配下の次の img_txt
        wrap = h3.find_parent(class_="paragraph")
        if wrap is None:
            continue
        block = wrap.find_next("div", class_=re.compile(r"img_txt"))
        if block is None:
            continue

        txt_div = block.find("div", class_=re.compile(r"\btxt\b"))
        if txt_div is None:
            continue
        text = txt_div.get_text("\n", strip=True)

        seat_match = re.search(r"議席番号[：:]\s*(\d+)", text)
        name_match = re.search(r"氏名[：:]\s*([^\n]+)", text)
        if not seat_match or not name_match:
            continue
        seat_number = int(seat_match.group(1))
        name = name_match.group(1).strip()

        # 整合チェック
        if seat_number != title_seat:
            print(f"  [WARN] seat mismatch: title={title_seat} block={seat_number}")

        # 議長・副議長表記を faction 扱いせず、committees 以外では保持しない
        committees = parse_committees(txt_div)

        # 写真
        photo_url = ""
        img = block.find("a", class_=re.compile(r"a_img_link"))
        remote = None
        if img and img.get("href"):
            remote = img["href"]
        else:
            img_tag = block.find("img")
            if img_tag and img_tag.get("src"):
                remote = img_tag["src"]
        if remote:
            if not remote.startswith("http"):
                remote = BASE_URL + remote
            ext = remote.rsplit(".", 1)[-1].split("?")[0].lower()
            if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
                ext = "jpg"
            fname = f"seat_{seat_number}.{ext}"
            try:
                img_resp = requests.get(remote, headers=HEADERS, timeout=15)
                img_resp.raise_for_status()
                (PHOTO_DIR / fname).write_bytes(img_resp.content)
                photo_url = f"/members/oketo/{fname}"
                time.sleep(0.3)
            except Exception as e:
                print(f"  [WARN] photo fetch failed seat={seat_number}: {e}")

        members.append({
            "seat_number": seat_number,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": committees,
            "photo_url": photo_url,
        })
        print(f"  [{seat_number}] {name} committees={committees} photo={'o' if photo_url else '-'}")

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape()
    if not members:
        print("取得不可: 議員データを抽出できませんでした")
        return
    payload = json.dumps(members, ensure_ascii=False, indent=2)
    (DATA_DIR / "members.json").write_text(payload + "\n", encoding="utf-8")
    (SITE_DATA_DIR / "members.json").write_text(payload + "\n", encoding="utf-8")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
