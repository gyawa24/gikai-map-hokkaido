"""
室蘭市議会 議員名簿スクレイパー
出力: data/muroran/members.json

ページ構造:
  https://www.city.muroran.lg.jp/administration/?content=3451
  各議員 = head_block (h3:議席番号N) + img_block (写真) + table_block×2 (氏名等/会派等)
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.muroran.lg.jp"
MEMBERS_URL = f"{BASE_URL}/administration/?content=3451"
# 画像の相対パス ../../assets/... は /administration/ からなので → /assets/...
IMAGE_BASE = BASE_URL

OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "muroran"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "muroran"
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


def resolve_img_url(src: str) -> str:
    """../../assets/... → https://www.city.muroran.lg.jp/assets/..."""
    if src.startswith("http"):
        return src
    # urljoin で解決: base は /administration/ (末尾スラッシュ付き)
    base = f"{BASE_URL}/administration/"
    return urljoin(base, src)


def download_photo(src: str, seat: int) -> str:
    """写真をダウンロードして保存。成功したら photo_url を返す。"""
    remote_url = resolve_img_url(src)
    ext = remote_url.split("?")[0].rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        img_resp = requests.get(remote_url, headers=HEADERS, timeout=10)
        img_resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(img_resp.content)
        print(f"    写真保存: {fname}")
        return f"/members/muroran/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗 seat {seat}: {e}")
        return ""


def parse_name_furigana(text: str):
    """
    '羽立典弘（はだちのりひろ）' → ('羽立典弘', 'はだちのりひろ')
    括弧なし → (text.strip(), '')
    """
    m = re.search(r'[（(]([^）)]+)[）)]', text)
    furigana = m.group(1).strip() if m else ""
    name = re.sub(r'[（(].*', '', text).strip()
    # 全角スペースを半角に統一
    name = re.sub(r'\u3000', ' ', name).strip()
    furigana = re.sub(r'\u3000', ' ', furigana).strip()
    return name, furigana


def parse_table(div) -> dict:
    """table_block div の th→td ペアを辞書で返す。"""
    result = {}
    for tr in div.find_all("tr"):
        th = tr.find("th")
        td = tr.find("td")
        if th and td:
            key = th.get_text(" ", strip=True).replace("\xa0", "").strip()
            val = td.get_text(" ", strip=True).replace("\xa0", "").strip()
            result[key] = val
    return result


def scrape_members():
    print("室蘭市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    members = []

    # content-N の div を全取得し、head_block 起点でグループ化
    all_content_divs = soup.find_all("div", id=re.compile(r"^content-\d+$"))
    print(f"  content-N ブロック数: {len(all_content_divs)}")

    i = 0
    while i < len(all_content_divs):
        div = all_content_divs[i]
        classes = div.get("class", [])

        # head_block = 議席番号の見出し
        if "head_block" in classes:
            h3 = div.find("h3")
            if h3 is None:
                i += 1
                continue

            h3_text = h3.get_text(strip=True)
            m = re.search(r'議席番号\s*(\d+)', h3_text)
            if not m:
                i += 1
                continue

            seat_number = int(m.group(1))
            print(f"  [議席{seat_number}] パース中...")

            member = {
                "seat_number": seat_number,
                "name": "",
                "furigana": "",
                "party": "",
                "faction": "",
                "committees": [],
                "photo_url": "",
            }

            i += 1  # 次のブロックへ

            # img_block: 写真
            if i < len(all_content_divs) and "img_block" in all_content_divs[i].get("class", []):
                img = all_content_divs[i].find("img", src=True)
                if img:
                    photo_url = download_photo(img["src"], seat_number)
                    member["photo_url"] = photo_url
                    time.sleep(0.3)
                i += 1

            # table_block (1つ目): 氏名・住所・電話等
            if i < len(all_content_divs) and "table_block" in all_content_divs[i].get("class", []):
                data = parse_table(all_content_divs[i])
                for key, val in data.items():
                    if re.search(r'氏名', key):
                        name, furigana = parse_name_furigana(val)
                        member["name"] = name
                        if furigana:
                            member["furigana"] = furigana
                i += 1

            # table_block (2つ目): 当選回数・所属会派・所属委員会
            if i < len(all_content_divs) and "table_block" in all_content_divs[i].get("class", []):
                data = parse_table(all_content_divs[i])
                for key, val in data.items():
                    if re.search(r'所属会派|会派', key):
                        if val and val not in ("なし", "－", "-", "無所属"):
                            member["faction"] = val
                        elif val == "無所属":
                            member["faction"] = "無所属"
                    elif re.search(r'所属委員会|委員会', key):
                        if val and val not in ("なし", "－", "-"):
                            member["committees"] = [
                                v.strip()
                                for v in re.split(r'[、,・\n]', val)
                                if v.strip()
                            ]
                i += 1

            members.append(member)
            print(f"    {member['name']} ({member['furigana']}) / 会派:{member['faction']}")

        else:
            i += 1

    # 結果サマリー
    print(f"\n  取得議員数: {len(members)}")

    if members:
        out_path = OUTPUT_DIR / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  -> 保存: {out_path} ({len(members)}名)")
    else:
        print("  議員データが取得できませんでした。")
        print(f"  対象URL: {MEMBERS_URL}")


if __name__ == "__main__":
    scrape_members()
