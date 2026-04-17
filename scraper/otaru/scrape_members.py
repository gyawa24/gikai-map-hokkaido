"""
小樽市議会 議員名簿スクレイパー
出力: data/otaru/members.json
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.otaru.lg.jp"
MEMBERS_URL = f"{BASE_URL}/docs/2020113000627/"
FACTIONS_URL = f"{BASE_URL}/docs/2020113000689/"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "site" / "data" / "otaru"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "otaru"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 会派名から政党を推定するマッピング（所属会派テキストに含まれるキーワードで判定）
PARTY_KEYWORDS = [
    ("自由民主党", "自由民主党"),
    ("公明党", "公明党"),
    ("日本共産党", "日本共産党"),
    ("立憲民主党", "立憲民主党"),
    ("国民民主党", "国民民主党"),
    ("日本維新の会", "日本維新の会"),
    ("れいわ", "れいわ新選組"),
    ("社民", "社会民主党"),
    ("参政党", "参政党"),
]


def fetch_soup(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def clean_text(s: str) -> str:
    if s is None:
        return ""
    s = s.replace("\u3000", " ").replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def split_name_furigana(raw: str) -> tuple[str, str]:
    """「新井田　邦宏　（にいだ　くにひろ）」→ ("新井田 邦宏", "にいだ くにひろ")"""
    if not raw:
        return "", ""
    m = re.match(r"^(.*?)[（(]\s*([ぁ-んー\s　]+?)\s*[）)]\s*$", raw)
    if m:
        name = clean_text(m.group(1))
        furigana = clean_text(m.group(2))
        return name, furigana
    return clean_text(raw), ""


def infer_party(faction: str) -> str:
    for key, party in PARTY_KEYWORDS:
        if key in faction:
            return party
    return ""


def parse_member_table(table) -> dict | None:
    """議員1名分のテーブル<table>から情報を抽出。議席番号が取れなければ None。"""
    rows = table.find_all("tr")
    member = {
        "seat_number": None,
        "name": "",
        "furigana": "",
        "party": "",
        "faction": "",
        "committees": [],
        "photo_src": "",
    }

    for tr in rows:
        tds = tr.find_all("td")
        ths = tr.find_all("th")
        if not tds:
            continue

        # 写真セル（rowspan付きのtd内にimg）
        for td in tds:
            img = td.find("img")
            if img and img.get("src") and not img["src"].startswith("data:"):
                if not member["photo_src"]:
                    member["photo_src"] = img["src"]

        # ラベル（<strong>）の行を処理
        label_el = tr.find("strong")
        if not label_el:
            continue
        label = clean_text(label_el.get_text())

        # ラベル直後のtd(value cell)を取得
        # ラベルが入っているtd自身は背景色#ffffccのセル
        value_td = None
        label_td = label_el.find_parent("td")
        if label_td:
            # 次のtdを探す
            sib = label_td.find_next_sibling("td")
            if sib:
                value_td = sib

        if value_td is None:
            continue

        value = clean_text(value_td.get_text(separator="\n"))

        if "議席番号" in label:
            m = re.search(r"\d+", value)
            if m:
                member["seat_number"] = int(m.group())
        elif "氏名" in label:
            name, furigana = split_name_furigana(value)
            member["name"] = name
            member["furigana"] = furigana
        elif "所属会派" in label:
            # 「公明党小樽市議会議員団 （内線516）」「自民会 （内線257、512、513）」等、内線記載を除去
            faction = re.sub(r"[（(]\s*内線[\s\d,、０-９]+[）)]", "", value).strip()
            member["faction"] = clean_text(faction)
            member["party"] = infer_party(member["faction"])
        elif "所属委員会" in label:
            # <br />区切りで複数委員会が入る。<br>を改行に変換してから再取得。
            for br in value_td.find_all("br"):
                br.replace_with("\n")
            raw = value_td.get_text(separator="\n")
            items = [clean_text(x) for x in re.split(r"[\n、,]", raw) if clean_text(x)]
            member["committees"] = items

    if member["seat_number"] is None or not member["name"]:
        return None
    return member


def download_photo(src: str, seat_number: int) -> str:
    """写真をローカル保存し /members/otaru/seat_N.ext を返す。失敗したら空文字。"""
    if not src:
        return ""
    remote_url = urljoin(MEMBERS_URL, src)
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        print(f"    [photo error] seat={seat_number} {remote_url} -> {e}")
        return ""
    ext = remote_url.split("?")[0].rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat_number}.{ext}"
    (PHOTO_DIR / fname).write_bytes(resp.content)
    return f"/members/otaru/{fname}"


def scrape_members():
    print("小樽市議会 議員名簿を収集中...")
    soup = fetch_soup(MEMBERS_URL)
    if soup is None:
        print("  [FATAL] 議員名簿ページ取得失敗")
        return []

    # 議席番号順名簿以降のテーブルだけを対象にする
    # 目印: <h2>議席番号順名簿</h2>
    h2 = soup.find(lambda tag: tag.name == "h2" and "議席番号順名簿" in tag.get_text())
    if h2 is None:
        print("  [FATAL] 『議席番号順名簿』見出しが見つかりません")
        return []

    # h2より後ろのテーブルを全収集
    tables = []
    for sib in h2.find_all_next("table"):
        tables.append(sib)

    print(f"  議席番号順名簿以降のtable数: {len(tables)}")

    members = []
    seen_seats = set()
    for table in tables:
        m = parse_member_table(table)
        if m is None:
            continue
        if m["seat_number"] in seen_seats:
            continue
        seen_seats.add(m["seat_number"])
        members.append(m)

    members.sort(key=lambda x: x["seat_number"])
    print(f"  抽出議員数: {len(members)}")

    # 写真ダウンロード
    for m in members:
        photo_rel = download_photo(m["photo_src"], m["seat_number"])
        m["photo_url"] = photo_rel
        del m["photo_src"]
        print(
            f"  [{m['seat_number']:>2}] {m['name']} / {m['furigana']} "
            f"/ {m['faction']} / 委員会={m['committees']} / photo={photo_rel or '-'}"
        )
        time.sleep(0.3)

    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データを抽出できませんでした")
        return
    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n書き出し: {out_path} ({len(members)}名)")


if __name__ == "__main__":
    main()
