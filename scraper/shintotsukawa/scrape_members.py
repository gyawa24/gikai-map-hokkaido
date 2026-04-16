"""
新十津川町議会 議員名簿スクレイパー
出力: data/shintotsukawa/members.json
写真: site/public/members/shintotsukawa/seat_N.jpg
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup, Tag

BASE_URL = "https://www.town.shintotsukawa.lg.jp"
MEMBERS_URL = f"{BASE_URL}/hotnews/detail/00000604.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "shintotsukawa"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "shintotsukawa"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
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


def normalize_ws(text: str) -> str:
    # 全角スペースを半角1個に、連続空白を1個に
    text = text.replace("\u3000", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse_committees(cell: Tag) -> list[str]:
    """役職・所属委員会セルからリストを抽出。
    ◎/〇/○ 記号は（委員長）/（副委員長）へ変換して委員会名に付与する。"""
    # <br/> を改行へ
    raw = cell.get_text("\n", strip=False)
    lines = [normalize_ws(l) for l in raw.split("\n")]
    results = []
    for line in lines:
        if not line:
            continue
        role_suffix = ""
        # ◎ 委員長
        if line.startswith("◎"):
            role_suffix = "（委員長）"
            line = line.lstrip("◎").strip()
        # 〇/○ 副委員長（全角・半角両方）
        elif line.startswith("〇") or line.startswith("○"):
            role_suffix = "（副委員長）"
            line = line.lstrip("〇○").strip()
        line = normalize_ws(line)
        if not line:
            continue
        results.append(line + role_suffix)
    return results


def extract_name_furigana(cell: Tag) -> tuple[str, str]:
    """氏名セルから姓名・ふりがなを抽出。
    構造: <span style='font-size:110%'>氏名</span> + <span style='font-size:80%'>ふりがな</span>"""
    spans = cell.find_all("span")
    name_raw = ""
    furigana_raw = ""
    for sp in spans:
        style = sp.get("style", "")
        text = sp.get_text(strip=True)
        if "110%" in style and not name_raw:
            name_raw = text
        elif "80%" in style and not furigana_raw:
            furigana_raw = text
    # 姓と名の間の全角スペースは1個に揃える
    name = re.sub(r"\s+", " ", name_raw.replace("\u3000", " ")).strip()
    furigana = re.sub(r"\s+", " ", furigana_raw.replace("\u3000", " ")).strip()
    return name, furigana


def download_photo(remote_url: str, seat: int) -> str:
    """写真をローカル保存して公開URLを返す。失敗時は空文字。"""
    try:
        ext = remote_url.split(".")[-1].split("?")[0].lower()
        if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
            ext = "jpg"
        fname = f"seat_{seat}.{ext}"
        resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/shintotsukawa/{fname}"
    except Exception as e:
        print(f"    [WARN] photo download failed: {remote_url} -> {e}")
        return ""


def scrape_members() -> list[dict]:
    print(f"新十津川町議会 議員名簿を収集中... {MEMBERS_URL}")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    # 議員名簿テーブルを特定: ヘッダーに「議席」「氏名」「役職」を含むtable
    target_table = None
    for table in soup.find_all("table"):
        header_text = table.get_text()
        if "議席" in header_text and "氏名" in header_text and "役職" in header_text:
            target_table = table
            break

    if target_table is None:
        print("  [ERROR] 議員一覧テーブルが見つかりません")
        return []

    rows = target_table.find_all("tr")
    members = []

    for row in rows[1:]:  # 1行目はヘッダ
        cells = row.find_all("td")
        if len(cells) < 7:
            continue

        seat_cell, photo_cell, name_cell, count_cell, occ_cell, party_cell, com_cell = cells[:7]
        seat_text = normalize_ws(seat_cell.get_text())
        if not seat_text.isdigit():
            continue
        seat = int(seat_text)

        # 欠員判定
        name_text_full = normalize_ws(name_cell.get_text(" ", strip=True))
        if "欠員" in name_text_full:
            print(f"  [{seat}] 欠員 (スキップ)")
            continue

        name, furigana = extract_name_furigana(name_cell)
        if not name:
            # spanが無いケース: セル先頭テキストを氏名として採用
            name = normalize_ws(name_cell.get_text(" ", strip=True).split(" ")[0])

        party = normalize_ws(party_cell.get_text())
        committees = parse_committees(com_cell)

        # 写真
        photo_url_local = ""
        img = photo_cell.find("img")
        if img and img.get("src"):
            src = img["src"]
            remote = src if src.startswith("http") else BASE_URL + src
            photo_url_local = download_photo(remote, seat)
            time.sleep(0.3)

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": committees,
        }
        if photo_url_local:
            member["photo_url"] = photo_url_local

        members.append(member)
        print(f"  [{seat}] {name} ({furigana}) / {party} / 委員会: {committees}")

    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データが抽出できませんでした")
        return
    output_path = OUTPUT_DIR / "members.json"
    output_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\n取得議員数: {len(members)}名")
    print(f"出力: {output_path}")


if __name__ == "__main__":
    main()
