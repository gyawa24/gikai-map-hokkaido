"""
猿払村議会 議員名簿スクレイパー
出力: data/sarufutsu/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.vill.sarufutsu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/hotnews/detail/00004176.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "sarufutsu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "sarufutsu"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch_html(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize_text(text: str) -> str:
    """全角・半角スペース、nbspを単一スペースにし、両端を整える。"""
    text = text.replace("\u00a0", " ").replace("\u3000", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_name(text: str) -> str:
    """氏名から空白を全て除去（漢字氏名のみとなる）。"""
    text = text.replace("\u00a0", "").replace("\u3000", "").replace(" ", "")
    return text.strip()


# 議席番号を含む行を識別する正規表現
SEAT_RE = re.compile(r"議席番号\s*([０-９0-9]+)\s*番")
# 当選回数の前の(無所属)等から会派/政党を抽出
PARTY_RE = re.compile(r"[（(]([^（）()]+)[）)]\s*当選回数")
# 役職【...】
ROLE_RE = re.compile(r"【([^】]+)】")
# 委員会行（行頭■）
COMMITTEE_RE = re.compile(r"■\s*([^（(\n]+?)\s*[（(]([^）)]+)[）)]")


def zenkaku_digit_to_int(s: str) -> int:
    table = str.maketrans("０１２３４５６７８九", "0123456789")
    s = s.translate(table)
    s = s.replace("九", "9")
    return int(re.sub(r"\D", "", s))


def parse_member_cell(td) -> dict | None:
    """議員情報セル（<td>）から各フィールドを抽出する。"""
    # <br>を改行に置換してテキスト化
    for br in td.find_all("br"):
        br.replace_with("\n")
    raw_text = td.get_text("\n")
    # nbsp等は名前抽出用と一般用で扱いを分ける
    lines = [normalize_text(l) for l in raw_text.split("\n")]
    lines = [l for l in lines if l]

    if not lines:
        return None

    # 議席番号
    seat = None
    for line in lines:
        m = SEAT_RE.search(line)
        if m:
            seat = zenkaku_digit_to_int(m.group(1))
            break
    if seat is None:
        return None

    # 氏名: <strong>タグ内テキストを優先
    strong = td.find("strong")
    name = ""
    if strong:
        name = normalize_name(strong.get_text())
    if not name:
        # フォールバック: 議席番号の次行
        for i, line in enumerate(lines):
            if SEAT_RE.search(line) and i + 1 < len(lines):
                name = normalize_name(lines[i + 1])
                break

    # 会派
    party = ""
    full_text = " ".join(lines)
    m = PARTY_RE.search(full_text)
    if m:
        party = m.group(1).strip()

    # 役職（議長・副議長・監査委員等）
    roles = []
    for line in lines:
        for m in ROLE_RE.finditer(line):
            roles.append(m.group(1).strip())

    # 委員会
    committees = []
    for line in lines:
        m = COMMITTEE_RE.search(line)
        if m:
            committee_name = normalize_text(m.group(1))
            committee_role = normalize_text(m.group(2))
            committees.append(f"{committee_name}（{committee_role}）")

    # 役職を会派欄に補助情報として追加
    faction = party
    if roles:
        faction = (party + " / " if party else "") + "・".join(roles)

    return {
        "seat_number": seat,
        "name": name,
        "furigana": "",
        "party": party,
        "faction": faction,
        "committees": committees,
        "_photo_src": _find_photo_src(td),
    }


def _find_photo_src(td) -> str:
    """同じ行の写真URLを取得（td.parent = tr 内の最初のimg）。"""
    tr = td.parent
    if tr is None:
        return ""
    img = tr.find("img")
    if img and img.get("src"):
        src = img["src"]
        return src if src.startswith("http") else BASE_URL + src
    return ""


def download_photo(url: str, seat: int) -> str:
    if not url:
        return ""
    ext = url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/sarufutsu/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗 seat={seat}: {e}")
        return ""


def scrape():
    print(f"猿払村議会 議員名簿を収集中: {MEMBERS_URL}")
    soup = fetch_html(MEMBERS_URL)
    if soup is None:
        raise SystemExit("ページ取得失敗")

    members = []
    # 全 <td> から議席番号を含むものを議員セルとして処理
    for td in soup.find_all("td"):
        text = td.get_text(" ", strip=True)
        if "議席番号" not in text:
            continue
        member = parse_member_cell(td)
        if member is None or not member.get("name"):
            continue
        members.append(member)

    # 重複除去 + seat_number順ソート
    seen = set()
    unique = []
    for m in sorted(members, key=lambda x: x["seat_number"]):
        if m["seat_number"] in seen:
            continue
        seen.add(m["seat_number"])
        unique.append(m)
    members = unique

    print(f"  議員 {len(members)} 名を抽出")

    # 写真ダウンロード
    for m in members:
        photo_src = m.pop("_photo_src", "")
        m["photo_url"] = download_photo(photo_src, m["seat_number"])
        time.sleep(0.3)

    # JSON出力
    output_path = OUTPUT_DIR / "members.json"
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)
    print(f"  -> {output_path} ({len(members)}件)")

    return members


if __name__ == "__main__":
    scrape()
