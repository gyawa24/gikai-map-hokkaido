"""
月形町議会 議員名簿スクレイパー
出力: data/tsukigata/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.tsukigata.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/page/1599.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "tsukigata"
SITE_DIR = REPO_ROOT / "site" / "data" / "tsukigata"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "tsukigata"
for d in (OUTPUT_DIR, SITE_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

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


FURIGANA_RE = re.compile(r"^[ぁ-んー\s]+$")
SEAT_RE = re.compile(r"^\d+$")
NAME_FURIGANA_RE = re.compile(r"^(?P<name>[^\s（(]+(?:\s+[^\s（(]+)*)\s*[（(]\s*(?P<furi>[ぁ-んー\s]+?)\s*[）)]\s*$")
COMMITTEE_SPLIT_RE = re.compile(
    r".+?(?:委員会(?:副?委員長|委員)|組合議会議員|議会議員|議長|副議長|監査委員)"
)


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def split_name_furigana(raw: str) -> tuple[str, str]:
    """『西山 富夫 （にしやま とみお）』のような表記を氏名/ふりがなに分離する。"""
    raw = normalize(raw)
    m = NAME_FURIGANA_RE.match(raw)
    if m:
        return normalize(m.group("name")), normalize(m.group("furi"))
    return raw, ""


def split_committees(raw: str) -> list[str]:
    """スペース区切りで連結された役職文字列を個別の役職に分割する。

    月形町の役職欄は「議長 南空知ふるさと市町村圏組合議会議員」のようにスペース区切り。
    役職名自体に空白は含まれないため、単純に空白で分割する。
    """
    raw = normalize(raw)
    if not raw:
        return []
    items = [t.strip() for t in re.split(r"\s+", raw) if t.strip()]
    return items


def parse_members(soup: BeautifulSoup):
    """HTML のテーブルから議員情報を動的に抽出する。"""
    members = []
    tables = soup.find_all("table")
    print(f"  テーブル {len(tables)} 件")

    for t_idx, table in enumerate(tables):
        rows = table.find_all("tr")
        if not rows:
            continue

        # ヘッダー行を解析して列インデックスを特定
        header_cells = rows[0].find_all(["th", "td"])
        headers = [normalize(c.get_text()) for c in header_cells]
        print(f"  [table{t_idx}] headers={headers}")

        def find_col(patterns):
            for i, h in enumerate(headers):
                for p in patterns:
                    if p in h:
                        return i
            return None

        col_seat = find_col(["議席"])
        col_name = find_col(["氏名", "名前"])
        col_furigana = find_col(["ふりがな", "フリガナ", "よみ"])
        col_party = find_col(["党派", "政党", "会派"])
        col_role = find_col(["役職", "主な役職", "役員", "所属"])

        if col_name is None:
            continue

        for row in rows[1:]:
            cells = row.find_all(["td", "th"])
            if len(cells) < 2:
                continue
            values = [normalize(c.get_text()) for c in cells]

            name = values[col_name] if col_name is not None and col_name < len(values) else ""
            if not name or len(name) < 2:
                continue

            seat_raw = values[col_seat] if col_seat is not None and col_seat < len(values) else ""
            try:
                seat_number = int(re.sub(r"\D", "", seat_raw)) if seat_raw else len(members) + 1
            except ValueError:
                seat_number = len(members) + 1

            furigana = values[col_furigana] if col_furigana is not None and col_furigana < len(values) else ""
            party = values[col_party] if col_party is not None and col_party < len(values) else ""
            role = values[col_role] if col_role is not None and col_role < len(values) else ""

            # 氏名セルに「氏名 （ふりがな）」が同居している場合は分離
            if not furigana:
                name, furigana = split_name_furigana(name)

            # 役職からスペース区切りで委員会を抽出
            committees = split_committees(role)

            member = {
                "seat_number": seat_number,
                "name": name,
                "furigana": furigana,
                "party": party,
                "faction": party,  # 月形町は全員無所属・会派なしのため party を流用
                "committees": committees,
                "photo_url": "",
            }
            members.append(member)

        if members:
            break  # 最初に議員情報が取れたテーブルのみを採用

    return members


def scrape_members():
    print("月形町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    members = parse_members(soup)
    if not members:
        print("  [WARN] 議員データを抽出できませんでした")
        return None

    # 写真が本文中にあれば拾う（議員ごとに紐付かない場合があるので無理はしない）
    # 今回はテーブル内に <img> が紐付いているか確認
    tables = soup.find_all("table")
    if tables:
        rows = tables[0].find_all("tr")[1:]
        for member, row in zip(members, rows):
            img = row.find("img")
            if not img or not img.get("src"):
                continue
            src = img["src"]
            remote_url = src if src.startswith("http") else BASE_URL + src
            ext = remote_url.split(".")[-1].split("?")[0].lower()
            if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
                ext = "jpg"
            fname = f"seat_{member['seat_number']}.{ext}"
            try:
                img_resp = requests.get(remote_url, headers=HEADERS, timeout=10)
                img_resp.raise_for_status()
                (PHOTO_DIR / fname).write_bytes(img_resp.content)
                member["photo_url"] = f"/members/tsukigata/{fname}"
                time.sleep(0.3)
            except Exception as e:
                print(f"  [WARN] 写真取得失敗 {remote_url}: {e}")

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員情報をHTMLから抽出できませんでした")
        return

    payload = {
        "source_url": MEMBERS_URL,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "count": len(members),
        "members": members,
    }

    for out_dir in (OUTPUT_DIR, SITE_DIR):
        out_path = out_dir / "members.json"
        out_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き込み: {out_path}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
