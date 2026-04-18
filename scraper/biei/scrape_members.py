"""
美瑛町議会 議員名簿スクレイパー
出力: site/data/biei/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.biei.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/administration/parliament/meibo.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "biei"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "biei"
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


def download_photo(remote_url: str, fname: str) -> str:
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/biei/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗: {remote_url} -> {e}")
        return ""


def normalize_name(text: str) -> str:
    """氏名・ふりがなの余分な空白を除去する"""
    # 全角スペース・非改行スペース・半角スペースを単一の半角スペースに
    text = re.sub(r"[\u3000\xa0\s]+", " ", text).strip()
    return text


def split_committees(td) -> list[str]:
    """委員会セルを複数の委員会に分割する"""
    text = td.get_text(separator="\n", strip=True)
    text = re.sub(r"[\u3000\xa0]+", " ", text)
    parts = re.split(r"[\n・、]", text)
    result = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        # 「産業経済常任委員会 副委員長議会運営委員会 委員」のような結合を分割
        entries = re.findall(
            r"(?:[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+?委員会(?:\s*(?:委員長|副委員長|委員))?|監査委員|副議長|議長)",
            part,
        )
        if entries:
            result.extend(e.strip() for e in entries if e.strip())
        else:
            result.append(part)
    return result


def scrape_members():
    print("美瑛町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    members = []

    # テーブル行を探す
    rows = soup.find_all("tr")
    print(f"  tr要素: {len(rows)} 件")

    for row in rows:
        tds = row.find_all("td")
        if not tds:
            continue

        img = row.find("img")
        text_cells = [td.get_text(strip=True) for td in tds]
        print(f"  行データ: {text_cells[:6]}")

        # 議席番号らしいセルを探す
        seat_number = None
        for cell_text in text_cells:
            if re.match(r"^\d{1,2}$", cell_text):
                seat_number = int(cell_text)
                break

        if seat_number is None:
            continue

        member = {
            "seat_number": seat_number,
            "name": "",
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        }

        # 氏名とふりがなを抽出（「氏名（ふりがな）」形式）
        for td in tds:
            td_text = td.get_text(strip=True)
            furigana_match = re.search(r"[（(]([ぁ-んァ-ン\s\u3000\xa0]+)[）)]", td_text)
            if furigana_match:
                raw_furigana = furigana_match.group(1)
                member["furigana"] = normalize_name(raw_furigana)
                name_part = re.sub(r"[（(][ぁ-んァ-ン\s\u3000\xa0]+[）)]", "", td_text)
                member["name"] = normalize_name(name_part)
                break

        if not member["name"]:
            for td in tds:
                td_text = td.get_text(strip=True)
                if re.match(r"^[\u4e00-\u9fff]{2,6}$", td_text):
                    member["name"] = td_text
                    break

        # 党派
        for td in tds:
            td_text = td.get_text(strip=True)
            if td_text in ("無所属",) or ("党" in td_text and len(td_text) <= 20):
                if td_text not in ("", "党派", "会派"):
                    member["party"] = td_text
                    member["faction"] = td_text
                    break

        # 委員会
        for td in tds:
            td_text = td.get_text(strip=True)
            if any(kw in td_text for kw in ["委員会", "委員長", "議長", "監査"]):
                member["committees"] = split_committees(td)
                break

        # 写真
        if img and img.get("src"):
            src = img["src"]
            remote_url = src if src.startswith("http") else BASE_URL + src
            ext = remote_url.split(".")[-1].split("?")[0] or "jpg"
            fname = f"seat_{seat_number}.{ext}"
            print(f"  写真取得: {remote_url}")
            member["photo_url"] = download_photo(remote_url, fname)
            time.sleep(0.3)

        if member["name"]:
            print(f"  [{seat_number}] {member['name']}（{member['furigana']}）{member['party']}")
            members.append(member)

    members.sort(key=lambda m: m["seat_number"])
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
    print(f"\n完了: {len(members)} 名 -> {out_path}")


if __name__ == "__main__":
    main()
