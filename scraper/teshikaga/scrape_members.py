"""
弟子屈町議会 議員名簿スクレイパー
出力: data/teshikaga/members.json および site/data/teshikaga/members.json
写真: site/public/members/teshikaga/seat_N.jpg
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.teshikaga.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/kurashi/soshikiichiran/gikaijimukyoku/1/giinmeibo/907.html"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "teshikaga"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "teshikaga"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "teshikaga"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 公式ページで使われる項目ラベル。本文構造を頼りに抽出するための定数のみで、
# 議員情報そのものはここには書かない。
FIELD_LABELS = {
    "seat": ["議席番号", "議員番号"],
    "name": ["氏名"],
    "birth": ["生年月日"],
    "address": ["住所"],
    "occupation": ["職業"],
    "party": ["党派"],
    "elected": ["当選回数"],
    "committees": ["委員会等"],
}


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or resp.encoding
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def extract_field(block_text: str, labels: list[str]) -> str:
    """ブロック内のテキストから【ラベル】に続く値を取り出す。"""
    for label in labels:
        m = re.search(rf"【{re.escape(label)}】\s*([^\n【]+)", block_text)
        if m:
            return m.group(1).strip()
    return ""


def normalize_party(value: str) -> str:
    # 弟子屈町公式は「党派」に 無所属 / 公明党 等を記載。空文字は維持。
    return value.strip()


def split_committees(value: str) -> list[str]:
    if not value:
        return []
    parts = re.split(r"[・,、／/]", value)
    return [p.strip() for p in parts if p.strip()]


def download_photo(src: str, seat: int) -> str:
    # src は //www.town... のプロトコル相対や /material/... の相対を許容する。
    if src.startswith("//"):
        remote = "https:" + src
    elif src.startswith("http"):
        remote = src
    else:
        remote = BASE_URL + (src if src.startswith("/") else "/" + src)

    ext = remote.rsplit(".", 1)[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote, headers=HEADERS, timeout=20)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/teshikaga/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗 seat={seat} {remote} -> {e}")
        return ""


def scrape_members() -> list[dict]:
    print(f"弟子屈町議会 議員名簿を収集中: {MEMBERS_URL}")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        return []

    soup = BeautifulSoup(resp.text, "html.parser")

    # 本文テキスト全体を改行でつなぎ、議員ブロック単位に分割。
    # 「議席番号」か「議員番号」のどちらかが各ブロックの先頭に来る。
    text = soup.get_text("\n", strip=True)
    # 議員名簿セクション以降だけを対象にする
    anchor = re.search(r"議員名簿[^\n]*\n", text)
    body = text[anchor.end():] if anchor else text

    # ブロック区切りは「【議席番号】」または「【議員番号】」
    block_pattern = re.compile(r"【(?:議席番号|議員番号)】")
    positions = [m.start() for m in block_pattern.finditer(body)]
    if not positions:
        print("  [ERROR] 議員ブロックが見つかりませんでした")
        return []

    positions.append(len(body))
    blocks = [body[positions[i]:positions[i + 1]] for i in range(len(positions) - 1)]

    # 画像は <img src="...group/15/..."> の順序で議席順に並んでいるため、
    # 議席番号 → 画像URL の辞書を作って突き合わせる。
    photo_map: dict[int, str] = {}
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if "group/15" not in src:
            continue
        # ファイル名先頭の数字が議席番号
        m = re.search(r"/(\d+)-", src)
        if m:
            photo_map[int(m.group(1))] = src

    members: list[dict] = []
    for block in blocks:
        seat_str = extract_field(block, FIELD_LABELS["seat"])
        if not seat_str.isdigit():
            continue
        seat = int(seat_str)
        name = extract_field(block, FIELD_LABELS["name"])
        if not name:
            continue

        party = normalize_party(extract_field(block, FIELD_LABELS["party"]))
        committees = split_committees(extract_field(block, FIELD_LABELS["committees"]))

        # 役職抽出（議長・副議長）: 委員会等フィールドに含まれる
        # 会派は弟子屈町の名簿には記載が無いため空のまま。

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": "",
            "committees": committees,
            "photo_url": "",
        }

        src = photo_map.get(seat)
        if src:
            time.sleep(0.3)
            member["photo_url"] = download_photo(src, seat)

        print(f"  [{seat:2d}] {name} / {party} / 委員会{len(committees)}件 / 写真{'有' if member['photo_url'] else '無'}")
        members.append(member)

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員情報を1件も抽出できませんでした")
        return

    payload = members
    for out in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        out.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"書き出し: {out} ({len(members)}件)")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
