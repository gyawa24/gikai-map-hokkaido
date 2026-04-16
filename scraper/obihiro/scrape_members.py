"""
帯広市議会 議員名簿スクレイパー
出力: data/obihiro/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.obihiro.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/shisei/shigikai/giinn/1001270.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "obihiro"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "obihiro"
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


def parse_name_furigana(h2_text: str) -> tuple[str, str]:
    """'有城　正憲（ありしろ　まさのり）' -> ('有城　正憲', 'ありしろ　まさのり')"""
    m = re.match(r"^(.+?)（(.+?)）\s*$", h2_text.strip())
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return h2_text.strip(), ""


def scrape_members():
    print("帯広市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    body = soup.find(id="houdou_mail_body")
    if body is None:
        print("  コンテンツエリアが見つかりません")
        return

    members = []
    h2_elements = body.find_all("h2")
    print(f"  議員 {len(h2_elements)} 名発見")

    for i, h2 in enumerate(h2_elements):
        seat = i + 1
        name, furigana = parse_name_furigana(h2.get_text())

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        }

        # h2の直後の要素を順に走査して写真・テーブルを収集
        img_el = None
        table_el = None

        # h2の次の兄弟要素を探す
        sibling = h2.find_next_sibling()
        while sibling:
            tag = sibling.name
            if tag == "h2":
                break  # 次の議員
            if tag == "p" and img_el is None:
                img_el = sibling.find("img")
            if tag == "table" and table_el is None:
                table_el = sibling
                break
            sibling = sibling.find_next_sibling()

        # 写真取得
        if img_el and img_el.get("src"):
            src = img_el["src"]
            # 相対パスを絶対パスに変換
            if src.startswith("http"):
                remote_url = src
            else:
                # ../../../_res/... の相対パスを解決
                # MEMBERS_URL: /shisei/shigikai/giinn/1001270.html
                # src: ../../../_res/...  -> /  + _res/...
                from urllib.parse import urljoin
                remote_url = urljoin(MEMBERS_URL, src)

            ext = remote_url.split(".")[-1].split("?")[0] or "jpg"
            fname = f"seat_{seat}.{ext}"
            try:
                img_resp = requests.get(remote_url, headers=HEADERS, timeout=10)
                img_resp.raise_for_status()
                (PHOTO_DIR / fname).write_bytes(img_resp.content)
                member["photo_url"] = f"/members/obihiro/{fname}"
                print(f"  [{seat}] {name} 写真保存: {fname}")
            except Exception as e:
                print(f"  [WARN] 写真取得失敗 seat {seat} ({name}): {e}")

        # テーブルから各種情報を抽出
        if table_el:
            for th in table_el.find_all("th"):
                text = th.get_text(strip=True)

                if text.startswith("所属会派名：") or text.startswith("所属会派名:"):
                    val = re.sub(r"^所属会派名[：:]", "", text).strip()
                    # 議長・副議長は役職表示のため会派なしとする
                    if re.fullmatch(r"[（(].*[）)]", val):
                        val = ""
                    member["faction"] = val

                elif text.startswith("所属委員会名：") or text.startswith("所属委員会名:"):
                    val = re.sub(r"^所属委員会名[：:]", "", text).strip()
                    if val and val != "なし":
                        member["committees"] = [v.strip() for v in re.split(r"[、,・]", val) if v.strip()]

                elif text.startswith("党派：") or text.startswith("党派:"):
                    val = re.sub(r"^党派[：:]", "", text).strip()
                    member["party"] = val

        print(f"  [{seat}] {name}（{furigana}）会派: {member['faction']} 党派: {member['party']}")
        members.append(member)

    if members:
        out_path = OUTPUT_DIR / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n-> 保存: {out_path} ({len(members)}名)")
    else:
        print("  議員データが取得できませんでした。")
        print(f"  対象URL: {MEMBERS_URL}")


if __name__ == "__main__":
    scrape_members()
