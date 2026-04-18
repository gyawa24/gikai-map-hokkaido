"""
訓子府町議会 議員名簿スクレイパー
出力: data/kunneppu/members.json, site/data/kunneppu/members.json

HTML構造: `〔議席番号 N 〕<strong>氏名</strong>（ふりがな）<img>` のあとに
`<ul><li>党派：…</li><li>当選回数：…</li><li>所属委員会：…</li></ul>`
が続くが、タグが分断され、議席間で <li> が跨っている箇所がある。
そのため、HTMLタグを除いたプレーンテキストで議席ブロックに分割してパースする。
写真URLだけは HTML から別途抽出する。
"""

import json
import re
import time
from pathlib import Path

import requests

BASE_URL = "https://www.town.kunneppu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/giinnosyokai.html"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "kunneppu"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "kunneppu"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "kunneppu"

for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 議席ヘッダの正規表現（全角/半角スペース・&nbsp;・HTMLエンティティに寛容）
SEAT_HEADER_RE = re.compile(
    r"〔\s*議席番号\s*(\d+)\s*〕\s*"
    r"([^（(\n]+?)\s*"  # 氏名（空白や中黒を含み得る。次の（まで）
    r"[（(]\s*([^）)]+?)\s*[）)]",
)


def fetch(url: str) -> str | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return resp.text
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def html_to_text(html: str) -> str:
    """HTMLタグを除き、改行・スペース・エンティティを扱いやすい形に正規化。"""
    s = html
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</(p|div|li|ul|ol|h\d)\s*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("&nbsp;", " ")
    s = re.sub(r"&amp;", "&", s)
    s = s.replace("\u3000", " ")  # 全角スペース -> 半角
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{2,}", "\n", s)
    return s


def squash(s: str) -> str:
    return re.sub(r"\s+", "", s)


def parse_committees(text: str) -> list[str]:
    raw = text.strip()
    raw = re.sub(r"^[:：]\s*", "", raw)
    parts = re.split(r"[、,\n]", raw)
    out = []
    for p in parts:
        p = p.strip().strip(" 　")
        if not p:
            continue
        if p.startswith("※"):
            continue
        out.append(p)
    return out


def download_photo(remote_url: str, seat_number: int) -> str:
    ext = remote_url.rsplit(".", 1)[-1].split("?")[0].lower()
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat_number}.{ext}"
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/kunneppu/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗 {remote_url} -> {e}")
        return ""


def find_img_src_for_seat(html: str, seat: int) -> str | None:
    """議席番号 N の直後に現れる <img src="..."> を返す。"""
    # 議席番号マーカー探索（&nbsp; や全角スペースを許容）
    pattern = rf"議席番号\s*{seat}\s*〕"
    m = re.search(pattern, html)
    if not m:
        return None
    tail = html[m.end():]
    # 最大 800 文字以内にある最初の <img>
    img_m = re.search(r'<img[^>]+src="([^"]+)"', tail[:1500])
    if img_m:
        return img_m.group(1)
    return None


def scrape_members():
    print("訓子府町議会 議員名簿を収集中...")
    html = fetch(MEMBERS_URL)
    if html is None:
        print("  ページ取得失敗")
        return

    # 議員紹介セクションの開始位置を絞る（誤検出防止）
    start_idx = html.find("訓子府町議会議員の紹介")
    if start_idx < 0:
        start_idx = 0
    # 末尾は「議員の政治倫理」など以降を切る（見つからなければそのまま）
    end_markers = ["議員の政治倫理", "議員報酬"]
    end_idx = len(html)
    for mk in end_markers:
        idx = html.find(mk, start_idx + 1)
        if idx > 0 and idx < end_idx:
            end_idx = idx
    section_html = html[start_idx:end_idx]

    text = html_to_text(section_html)

    # 議席ヘッダの出現位置で分割
    headers = list(SEAT_HEADER_RE.finditer(text))
    if not headers:
        print("  [ERROR] 議席ヘッダが検出できませんでした")
        return

    print(f"  議席ヘッダ {len(headers)} 件検出")

    members = []
    for i, h in enumerate(headers):
        seat = int(h.group(1))
        name_raw = h.group(2)
        furigana_raw = h.group(3)
        name = squash(name_raw)
        furigana = re.sub(r"\s+", " ", furigana_raw).strip()

        start = h.end()
        end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
        block = text[start:end]

        party = ""
        party_m = re.search(r"党\s*派\s*[:：]\s*([^\n、,]+)", block)
        if party_m:
            party = squash(party_m.group(1))

        committees: list[str] = []
        com_m = re.search(
            r"所\s*属\s*委\s*員\s*会\s*[:：]\s*(.+?)(?:\n|当選回数|党派|$)",
            block,
            re.S,
        )
        if com_m:
            committees = parse_committees(com_m.group(1))

        # 写真URL（原HTMLから抽出）
        photo_url = ""
        src = find_img_src_for_seat(section_html, seat)
        if src:
            remote = src if src.startswith("http") else BASE_URL + src
            photo_url = download_photo(remote, seat)
            time.sleep(0.3)

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": committees,
            "photo_url": photo_url,
        }
        members.append(member)
        print(
            f"  [{seat}] {name} ({furigana}) / 党派={party!r} / "
            f"委員会={committees} / 写真={'あり' if photo_url else 'なし'}"
        )

    members.sort(key=lambda x: x["seat_number"])

    for out_dir in (DATA_DIR, SITE_DATA_DIR):
        out_path = out_dir / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {out_path}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    scrape_members()
