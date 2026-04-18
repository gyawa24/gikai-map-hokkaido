"""
標茶町議会 議員名簿スクレイパー
出力: data/shibecha/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://town.shibecha.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/giin.html"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "shibecha"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "shibecha"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "shibecha"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 政党として認識するキーワード（これ以外の先頭行は faction として扱う）
PARTY_KEYWORDS = [
    "自由民主党", "自民党",
    "立憲民主党", "立民",
    "日本共産党", "共産党",
    "公明党",
    "国民民主党",
    "日本維新の会", "維新",
    "れいわ新選組",
    "社会民主党", "社民党",
    "無所属",
]


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def split_br_lines(cell) -> list[str]:
    """td セル内の <br> で区切られた各行テキストを返す"""
    # 改行を <br> に寄せてから get_text で分割
    for br in cell.find_all("br"):
        br.replace_with("\n")
    raw = cell.get_text("\n", strip=False)
    lines = [re.sub(r"\s+", " ", line).strip() for line in raw.split("\n")]
    return [ln for ln in lines if ln]


def normalize_name(raw: str) -> str:
    """氏名の全角スペース・連続空白を半角スペース1個に正規化"""
    return re.sub(r"\s+", " ", raw.replace("\u3000", " ")).strip()


def classify_party_and_committees(lines: list[str]) -> tuple[str, list[str]]:
    """所属政党セルの各行から、政党名と委員会リストを分離"""
    if not lines:
        return "", []
    first = lines[0]
    party = ""
    committees = []
    if any(kw in first for kw in PARTY_KEYWORDS):
        party = first
        committees = lines[1:]
    else:
        committees = lines[:]
    return party, committees


def download_photo(url: str, seat: int) -> str:
    ext = url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif"}:
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/shibecha/{fname}"
    except Exception as e:
        print(f"    [WARN] photo download failed: {url} -> {e}")
        return ""


def scrape_members() -> list[dict]:
    print("標茶町議会 議員名簿を収集中...")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    table = soup.find("table")
    if table is None:
        print("  [ERROR] テーブルが見つかりません")
        return []

    rows = table.find_all("tr")
    if len(rows) < 2:
        print("  [ERROR] 議員行が見つかりません")
        return []

    # ヘッダー列を確認（期待: 議席番号/氏名/性別/生年月日/所属政党 所属委員会等/写真）
    header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
    print(f"  ヘッダー: {header_cells}")

    members = []
    for row in rows[1:]:
        cells = row.find_all(["th", "td"])
        if len(cells) < 5:
            continue

        seat_text = cells[0].get_text(strip=True)
        try:
            seat = int(re.sub(r"\D", "", seat_text))
        except ValueError:
            continue

        name_lines = split_br_lines(cells[1])
        if len(name_lines) < 1:
            continue
        name = normalize_name(name_lines[0])
        furigana = normalize_name(name_lines[1]) if len(name_lines) >= 2 else ""

        party_lines = split_br_lines(cells[4])
        party, committees = classify_party_and_committees(party_lines)

        # 写真
        photo_url = ""
        img = cells[5].find("img") if len(cells) >= 6 else None
        if img and img.get("src"):
            src = img["src"]
            remote = src if src.startswith("http") else f"{BASE_URL}/gikai/" + src.lstrip("./")
            # 相対パス "images/xxx.JPG" は gikai 配下
            if not src.startswith("http") and not src.startswith("/"):
                remote = f"{BASE_URL}/gikai/{src}"
            photo_url = download_photo(remote, seat)
            time.sleep(0.3)

        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": committees,
            "photo_url": photo_url,
        })
        print(f"  [{seat}] {name} ({furigana}) - {party} / {committees}")

    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員情報が抽出できませんでした")
        return

    members.sort(key=lambda m: m["seat_number"])

    out = {
        "source_url": MEMBERS_URL,
        "count": len(members),
        "members": members,
    }
    for d in (DATA_DIR, SITE_DATA_DIR):
        (d / "members.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    print(f"\n取得議員数: {len(members)}名")
    print(f"出力: {DATA_DIR/'members.json'}")
    print(f"出力: {SITE_DATA_DIR/'members.json'}")


if __name__ == "__main__":
    main()
