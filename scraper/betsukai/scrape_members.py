"""
別海町議会 議員名簿スクレイパー
出力: site/data/betsukai/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://betsukai.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/about/meibo/"
ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "site" / "data" / "betsukai"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "betsukai"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

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
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize_spaces(s: str) -> str:
    # 全角スペースを半角スペースに、連続空白を1つに
    s = s.replace("\u3000", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def parse_title(text: str) -> tuple[str, str, str]:
    """
    h2 タイトルから役職・氏名・ふりがなを抽出
    例: "議長　西原　浩（にしはら　ひろし）"
        "市川　聖母（いちかわ　まりあ）"
    returns: (role, name, furigana)
    """
    text = normalize_spaces(text)
    role = ""
    # 先頭に役職 (議長/副議長) または "N番" が付く
    m_role = re.match(r"^(議長|副議長)\s+(.+)$", text)
    if m_role:
        role = m_role.group(1)
        text = m_role.group(2)
    else:
        m_num = re.match(r"^[0-9０-９]+番\s+(.+)$", text)
        if m_num:
            text = m_num.group(1)
    # 氏名（ふりがな）
    m = re.match(r"^(.+?)[（(]([ぁ-んー\s]+)[）)]\s*$", text)
    if m:
        return role, normalize_spaces(m.group(1)), normalize_spaces(m.group(2))
    return role, normalize_spaces(text), ""


def parse_body(text: str) -> dict:
    """
    《議席番号 N》【氏名】…【生年月日】…【住所】…【職業】…【期数】…【所属】…
    のテキスト塊から情報を抽出
    """
    # <br> を改行に変換した後のテキストを想定
    info: dict = {
        "seat_number_text": "",
        "occupation": "",
        "terms": "",
        "committees": [],
    }

    # 議席番号
    m_seat = re.search(r"議(?:席番号|会議席)\s*([0-9０-９]+)", text)
    if m_seat:
        info["seat_number_text"] = m_seat.group(1)

    # 職業
    m_job = re.search(r"【職業】\s*([^\n【]*)", text)
    if m_job:
        info["occupation"] = normalize_spaces(m_job.group(1))

    # 期数 (例: "5期" → "5")
    m_term = re.search(r"【期数】\s*([0-9０-９]+)\s*期", text)
    if m_term:
        info["terms"] = normalize_spaces(m_term.group(1))

    # 所属/役職・所属 セクション以降を取得
    m_aff = re.search(r"【(?:役職・所属|所属)】\s*(.+)$", text, re.DOTALL)
    if m_aff:
        block = m_aff.group(1)
        # 改行で分割し、各行をトリム
        lines = [normalize_spaces(ln) for ln in block.splitlines()]
        items = [ln for ln in lines if ln]
        info["committees"] = items

    return info


def zenkaku_digits_to_ascii(s: str) -> str:
    tbl = str.maketrans("０１２３４５６７８９", "0123456789")
    return s.translate(tbl)


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/betsukai/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真DL失敗 {remote_url} -> {e}")
        return ""


def scrape_members():
    print(f"別海町議会 議員名簿を収集中: {MEMBERS_URL}")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    # 各議員の塊は <h2 class="btk-title large"> + 直後の <div class="paragraph ... img_txt">
    headings = soup.find_all("h2", class_="btk-title")
    print(f"  見出し {len(headings)} 件")

    members = []
    for h in headings:
        title_text = h.get_text(" ", strip=True)
        role, name, furigana = parse_title(title_text)
        if not name:
            continue

        # 次のparagraph divを探す
        body_div = h.find_next("div", class_="paragraph")
        if body_div is None:
            continue

        # テキスト本文 (brを改行化)
        for br in body_div.find_all("br"):
            br.replace_with("\n")
        body_text = body_div.get_text("\n", strip=False)

        parsed = parse_body(body_text)

        # 議席番号: タイトルに無い場合は本文の数値を使用
        seat_raw = parsed["seat_number_text"]
        if not seat_raw:
            continue
        seat_number = int(zenkaku_digits_to_ascii(seat_raw))

        # 写真
        photo_url = ""
        img = body_div.find("img")
        if img and img.get("src"):
            src = img["src"]
            remote = src if src.startswith("http") else BASE_URL + src
            photo_url = download_photo(remote, seat_number)
            time.sleep(0.3)

        # 役職（議長/副議長）があれば委員会リスト冒頭に追加
        committees = list(parsed["committees"])
        if role and role not in committees:
            committees = [role] + committees

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": "",
            "committees": committees,
            "terms": parsed["terms"],
            "occupation": parsed["occupation"],
            "photo_url": photo_url,
        }
        print(f"  [{seat_number:2d}] {name} ({furigana}) - {len(committees)}件の所属")
        members.append(member)

    # 議席番号順にソート
    members.sort(key=lambda m: m["seat_number"])

    if not members:
        print("  議員情報が抽出できませんでした")
        return

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\n取得議員数: {len(members)}名 -> {out_path}")


if __name__ == "__main__":
    scrape_members()
