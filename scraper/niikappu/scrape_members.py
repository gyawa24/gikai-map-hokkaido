"""
新冠町議会 議員名簿スクレイパー
出力: site/data/niikappu/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.niikappu.jp"
MEMBERS_URL = f"{BASE_URL}/gyose/gikai/gin.html"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "niikappu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "niikappu"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 全角数字 → 半角数字
ZEN_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def fetch_bytes(url: str) -> bytes | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        print(f"  [ERROR] image fetch {url} -> {e}")
        return None


def parse_seat(cell_text: str) -> int | None:
    """"１" や "10 " → 1 / 10。議席番号が抽出できなければ None。"""
    t = cell_text.translate(ZEN_DIGITS)
    m = re.search(r"\d+", t)
    return int(m.group()) if m else None


def parse_name_furigana(h5_text: str) -> tuple[str, str]:
    """
    "酒井 益幸（さかい ますゆき）" / "氏家 良美（うじいえ よしみ）"
    → ("酒井 益幸", "さかい ますゆき")
    """
    # NBSP など特殊空白を通常スペースに
    text = h5_text.replace("\u00a0", " ").replace("\u3000", " ").strip()
    m = re.match(r"^(.+?)\s*[（(]\s*([^）)]+?)\s*[）)]\s*$", text)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return text, ""


def parse_info_paragraphs(td) -> dict:
    """
    <td>内の<p>群から 党派・役職リスト を抽出する。
    役職は「役　職」行以降を末尾まで拾う。
    """
    paragraphs = []
    for p in td.find_all("p"):
        t = p.get_text("", strip=True).replace("\u00a0", " ").replace("\xa0", " ")
        # 全角スペースを半角スペースに寄せてから圧縮
        t = re.sub(r"[ \u3000]+", " ", t).strip()
        if t:
            paragraphs.append(t)

    info = {"party": "", "roles": []}
    in_roles = False
    for t in paragraphs:
        # "党　派　　公明党" / "党派 公明党" どちらにも対応
        m_party = re.match(r"^党\s*派\s+(.+)$", t)
        m_role = re.match(r"^役\s*職\s+(.+)$", t)
        if m_party:
            info["party"] = m_party.group(1).strip()
            continue
        if m_role:
            in_roles = True
            first = m_role.group(1).strip()
            # "議　長" のような全角スペース入り役職も寄せる
            first = re.sub(r"\s+", "", first)
            if first:
                info["roles"].append(first)
            continue
        if in_roles:
            # 役職ブロック以降の行（年齢・住所など他項目が混ざらない設計）
            cleaned = re.sub(r"\s+", "", t)
            if cleaned:
                info["roles"].append(cleaned)

    return info


def split_committees_and_faction(roles: list[str]) -> tuple[list[str], str]:
    """
    役職リストを committees にそのまま格納する。議長・副議長のような議会内肩書も
    情報として残す（議長の氏家氏のように、役職欄に議長のみ記載されるケースで
    committees が空になるのを避ける）。会派は HTML に明示がないため空文字で返す。
    """
    return list(roles), ""


def scrape_members() -> bool:
    print("新冠町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return False

    # 議員詳細は「議席番号・写真・議員紹介」ヘッダを持つテーブル
    target_table = None
    for t in soup.find_all("table"):
        headers_text = " ".join(
            c.get_text(strip=True) for c in t.find_all("th")
        )
        if "議席番号" in headers_text and "議員紹介" in headers_text:
            target_table = t
            break

    if target_table is None:
        print("  議員詳細テーブルが見つかりません")
        return False

    members: list[dict] = []
    rows = target_table.find_all("tr")
    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 3:
            continue

        seat_cell, photo_cell, info_cell = cells[0], cells[1], cells[2]
        seat = parse_seat(seat_cell.get_text(strip=True))
        if seat is None:
            continue

        h5 = info_cell.find("h5")
        if h5 is None:
            continue
        name, furigana = parse_name_furigana(h5.get_text(" ", strip=True))
        if not name:
            continue
        # 氏名に含まれる空白（"酒井 益幸"）はそのまま残す。
        # "氏家 良美" の NBSP 由来スペースも 1 つに正規化。
        name = re.sub(r"\s+", " ", name)
        furigana = re.sub(r"\s+", " ", furigana)

        info = parse_info_paragraphs(info_cell)
        committees, faction = split_committees_and_faction(info["roles"])

        # 写真
        photo_url = ""
        img = photo_cell.find("img")
        if img and img.get("src"):
            src = img["src"]
            remote = src if src.startswith("http") else f"{BASE_URL}/gyose/gikai/{src}"
            ext = remote.rsplit(".", 1)[-1].split("?")[0].lower() or "jpg"
            # 拡張子は小文字 jpg に統一（seat_N.jpg）
            ext = "jpg" if ext in {"jpeg", "jpg", "JPG", "JPEG"} else ext.lower()
            fname = f"seat_{seat}.{ext}"
            data = fetch_bytes(remote)
            if data:
                (PHOTO_DIR / fname).write_bytes(data)
                photo_url = f"/members/niikappu/{fname}"

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": info["party"],
            "faction": faction,
            "committees": committees,
        }
        if photo_url:
            member["photo_url"] = photo_url

        members.append(member)
        print(
            f"  [{seat:>2}] {name} ({furigana}) / 党派: {info['party']} "
            f"/ 役職: {committees}"
        )

    if not members:
        print("  議員データが抽出できませんでした")
        return False

    members.sort(key=lambda m: m["seat_number"])

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n取得議員数: {len(members)}名")
    print(f"出力: {output_path}")
    return True


if __name__ == "__main__":
    ok = scrape_members()
    exit(0 if ok else 1)
