"""
木古内町議会 議員名簿スクレイパー
出力: data/kikonai/members.json / site/data/kikonai/members.json

公式サイトの議員名簿ページ（HTML）を毎回取得して動的にパースする。
議員名・会派・委員会等を一切ハードコードしない。

HTMLが未閉鎖の<br>/<img>を多用しているため、BeautifulSoup(html.parser)で
tree構造を使うと以降の兄弟がimg配下に入れ子化される。そのため本スクレイパーは
article内のテキストと<img>の順序のみを根拠に抽出する。
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.kikonai.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/meibo.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "kikonai"
SITE_OUTPUT_DIR = ROOT / "site" / "data" / "kikonai"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "kikonai"
for d in (OUTPUT_DIR, SITE_OUTPUT_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

SEAT_SPLIT_RE = re.compile(r"議席番号\s*(\d+)")
NAME_RE = re.compile(r"^(.+?)[（(]\s*(.+?)\s*[)）]\s*$")


def fetch_html(url: str) -> BeautifulSoup:
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return BeautifulSoup(resp.text, "html.parser")


def normalize_name(s: str) -> str:
    return re.sub(r"[\s　]+", "", s or "").strip()


def download_photo(src: str, seat: int) -> str:
    if not src:
        return ""
    url = src if src.startswith("http") else BASE_URL + src
    ext = url.split(".")[-1].split("?")[0].lower()
    if ext not in ("jpg", "jpeg", "png", "gif"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/kikonai/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗 {url}: {e}")
        return ""


def parse_block_text(seat: int, text: str, photo_src: str) -> dict | None:
    """1議員ブロックのテキスト（議席番号N以降、次の議席番号の直前まで）を解析"""
    # 行ごとに分割
    lines = [ln.strip() for ln in re.split(r"[\n\r]+", text) if ln.strip()]
    if not lines:
        return None

    # 氏名行: 最初の ( or （ を含む行
    name = ""
    furigana = ""
    name_idx = -1
    for i, ln in enumerate(lines):
        m = NAME_RE.match(ln)
        if m:
            name = normalize_name(m.group(1))
            furigana = m.group(2).strip()
            name_idx = i
            break

    if not name:
        return None

    party = ""
    roles: list[str] = []
    committees: list[str] = []

    # 名前行以降を走査。■で始まる行が属性行、それ以外は直前委員会行の継続とみなす
    rest = lines[name_idx + 1 :]
    # フッター領域（お問い合わせ等）以降は切り捨てる
    cutoff = len(rest)
    for i, ln in enumerate(rest):
        if "お問い合わせ" in ln or ln.startswith("議会事務局"):
            cutoff = i
            break
    rest = rest[:cutoff]
    last_was_committee = False
    for ln in rest:
        if ln.startswith("■"):
            content = ln.lstrip("■").strip()
            last_was_committee = False
            if content.startswith("党派"):
                party = re.sub(r"^党派[\s　]*", "", content).strip()
            elif content.startswith("年齢") or content.startswith("当選回数"):
                pass
            elif content in ("議長", "副議長"):
                roles.append(content)
                # 議長/副議長の次の行に所属委員会が列挙されるため継続対象とする
                last_was_committee = True
            else:
                # 委員会・役職行
                committees.append(content)
                last_was_committee = True
        else:
            if last_was_committee:
                committees.append(ln)

    photo_url = download_photo(photo_src, seat) if photo_src else ""

    return {
        "seat_number": seat,
        "name": name,
        "furigana": furigana,
        "party": party,
        "faction": "",
        "committees": committees,
        "roles": roles,
        "photo_url": photo_url,
    }


def parse_members(soup: BeautifulSoup) -> list[dict]:
    article = soup.find(id="article")
    if article is None:
        return []

    # article内テキスト（改行保持）
    article_text = article.get_text("\n", strip=False)

    # 議員ブロックに分割
    # 正規表現で (議席番号N, 開始位置) を列挙
    markers = [
        (int(m.group(1)), m.start(), m.end())
        for m in SEAT_SPLIT_RE.finditer(article_text)
    ]
    if not markers:
        return []

    # 各議員の img src を順序通りに取得
    imgs = article.find_all("img")
    photo_srcs = [img.get("src", "") for img in imgs]

    members: list[dict] = []
    for i, (seat, _start, end) in enumerate(markers):
        next_start = markers[i + 1][1] if i + 1 < len(markers) else len(article_text)
        block_text = article_text[end:next_start]
        photo = photo_srcs[i] if i < len(photo_srcs) else ""
        member = parse_block_text(seat, block_text, photo)
        if member:
            members.append(member)

    members.sort(key=lambda m: m["seat_number"])
    return members


def main() -> None:
    print("木古内町議会 議員名簿を収集中...")
    print(f"  URL: {MEMBERS_URL}")
    soup = fetch_html(MEMBERS_URL)
    members = parse_members(soup)

    if not members:
        print("  [ERROR] 議員データを抽出できませんでした")
        return

    payload = {
        "source_url": MEMBERS_URL,
        "members": members,
    }
    for p in (OUTPUT_DIR / "members.json", SITE_OUTPUT_DIR / "members.json"):
        p.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  保存: {p}")

    for m in members:
        print(
            f"    [{m['seat_number']}] {m['name']}（{m['furigana']}）"
            f" 党派={m['party']} 役職={m['roles']}"
            f" 委員会={m['committees']}"
        )

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
