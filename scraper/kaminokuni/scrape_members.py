"""
上ノ国町議会 議員名簿スクレイパー
出力: site/data/kaminokuni/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.kaminokuni.lg.jp"
MEMBERS_URL = f"{BASE_URL}/hotnews/detail/00000522.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "site" / "data" / "kaminokuni"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "kaminokuni"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize_name(s: str) -> str:
    """全角空白・前後空白を除去した氏名"""
    return re.sub(r"[\s\u3000]+", "", s or "").strip()


def parse_member_row(cells: list) -> dict | None:
    """
    7セル想定: [役職, 氏名(年齢), 写真, 職業, 当選回数, 所属政党, 議席番号]
    """
    if len(cells) < 7:
        return None

    role_text = cells[0].get_text(strip=True)
    name_cell = cells[1]
    photo_cell = cells[2]
    job_text = cells[3].get_text(strip=True)
    terms_text = cells[4].get_text(strip=True)
    party_text = cells[5].get_text(strip=True)
    seat_text = cells[6].get_text(strip=True)

    # 「氏名(年齢)」から氏名と年齢を分離
    raw = name_cell.get_text(strip=True)
    m = re.match(r"^(.+?)\s*[\(（](\d+)[\)）]\s*$", raw)
    if m:
        name = normalize_name(m.group(1))
        age_str = m.group(2)
    else:
        name = normalize_name(raw)
        age_str = ""

    if not name or not re.search(r"[一-龥]", name):
        return None

    # 議席番号（全角→半角）
    seat_clean = seat_text.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    seat_clean = re.sub(r"\D", "", seat_clean)
    seat_number = int(seat_clean) if seat_clean else 0

    # 写真URL
    photo_url = ""
    img = photo_cell.find("img")
    if img and img.get("src"):
        src = img["src"]
        photo_url = src if src.startswith("http") else BASE_URL + src

    # 会派（「無」は無所属とする）
    faction = ""
    party = ""
    p = party_text.strip()
    if p and p != "無":
        # 政党名がそのまま会派欄に書かれているケース
        party = p
        faction = p
    elif p == "無":
        faction = "無所属"

    return {
        "seat_number": seat_number,
        "name": name,
        "furigana": "",
        "party": party,
        "faction": faction,
        "committees": [],
        "role": role_text or "",
        "job": job_text,
        "terms": terms_text,
        "age": age_str,
        "_photo_remote": photo_url,
    }


def parse_committees(soup: BeautifulSoup) -> dict[str, list[dict]]:
    """
    各 h2(pagetitle_a3) の直後の table を委員会として収集。
    return: {議員名: [{name: 委員会名, role: 役職}, ...]}
    """
    result: dict[str, list[dict]] = {}
    headings = soup.find_all("h2", class_="pagetitle_a3")

    committee_keywords = ("委員会", "監査委員")

    for h in headings:
        title = h.get_text(strip=True)
        if not any(k in title for k in committee_keywords):
            continue
        table = h.find_next("table")
        if not table:
            continue

        # 各行 [役職, 氏名]
        rows = table.find_all("tr")
        for tr in rows:
            tds = tr.find_all("td")
            if len(tds) < 2:
                continue
            role = tds[0].get_text(strip=True)
            name = normalize_name(tds[1].get_text(strip=True))
            # ヘッダー行のスキップ
            if role in ("役職名",) or name in ("氏名", "氏　名", ""):
                continue
            if not re.search(r"[一-龥]", name):
                continue
            result.setdefault(name, []).append({"name": title, "role": role})

    return result


def download_photo(remote_url: str, seat_number: int) -> str:
    if not remote_url:
        return ""
    try:
        ext = remote_url.split(".")[-1].split("?")[0].lower()
        if ext not in ("jpg", "jpeg", "png", "gif"):
            ext = "jpg"
        fname = f"seat_{seat_number}.{ext}"
        resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/kaminokuni/{fname}"
    except Exception as e:
        print(f"    [WARN] photo {remote_url} -> {e}")
        return ""


def scrape_members():
    print(f"上ノ国町議会 議員名簿を収集中... ({MEMBERS_URL})")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        print("  ページ取得失敗")
        return

    resp.encoding = resp.apparent_encoding or "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")

    # 議員一覧テーブル: ヘッダー行に「議席番号」を含むテーブルを探す
    main_table = None
    for table in soup.find_all("table"):
        header_text = table.get_text()
        if "議席番号" in header_text and "役職名" in header_text:
            main_table = table
            break

    if main_table is None:
        print("  [ERROR] 議員一覧テーブルが見つかりません")
        return

    members: list[dict] = []
    for tr in main_table.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 7:
            continue
        # ヘッダー行スキップ（「議席番号」を含むなら見出し）
        joined = "".join(td.get_text(strip=True) for td in tds)
        if "議席番号" in joined and "氏" in joined:
            continue
        m = parse_member_row(tds)
        if m:
            members.append(m)

    if not members:
        print("  [ERROR] 議員データを抽出できませんでした")
        return

    print(f"  議員 {len(members)} 名抽出")

    # 委員会情報の収集
    committee_map = parse_committees(soup)
    print(f"  委員会割当 {len(committee_map)} 名分")

    # 写真DL & 委員会マージ
    for m in members:
        m["committees"] = committee_map.get(m["name"], [])
        remote = m.pop("_photo_remote", "")
        m["photo_url"] = download_photo(remote, m["seat_number"])
        time.sleep(0.3)

    # 議席番号順にソート
    members.sort(key=lambda x: x["seat_number"])

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  -> {out_path} ({len(members)} 名)")


if __name__ == "__main__":
    scrape_members()
