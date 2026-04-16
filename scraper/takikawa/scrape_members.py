"""
滝川市議会 議員名簿スクレイパー
出力: data/takikawa/members.json
写真: site/public/members/takikawa/seat_N.{ext}
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.takikawa.lg.jp"
INDEX_URL = f"{BASE_URL}/page/2859.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "takikawa"
SITE_OUTPUT_DIR = REPO_ROOT / "site" / "data" / "takikawa"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "takikawa"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
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


def collect_member_links(soup: BeautifulSoup) -> list[tuple[str, str]]:
    """一覧ページから (URL, リンクテキスト) を重複除去しつつ順序保持で取得"""
    seen: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        # 議員個別ページは /page/NNNN.html 形式。index (2859) は除外
        m = re.match(r"^/page/(\d+)\.html$", href)
        if not m:
            continue
        page_id = m.group(1)
        if page_id == "2859":
            continue
        # 議員個別ページは 2854〜2870 の範囲内にある（index 2859 含む）
        pid = int(page_id)
        if pid < 2854 or pid > 2870:
            continue
        text = a.get_text(strip=True)
        url = BASE_URL + href
        # 同一URLで複数リンク（氏の異体字で分割されているケース）があるため
        # 既存を上書きせず、先頭のリンクテキストを優先しつつ、より長い方を保持
        if url not in seen:
            seen[url] = text
        else:
            # 同じURLで分割リンクの場合、両者を連結
            prev = seen[url]
            if text and text not in prev:
                seen[url] = prev + text
    return list(seen.items())


NAME_FURIGANA_RE = re.compile(r"^(.+?)[（(]([ぁ-んー\s　]+)[）)]")


def parse_detail(soup: BeautifulSoup) -> dict:
    """個別ページから 氏名/ふりがな/役職/会派/政党/委員会/当選回数/写真 を抽出"""
    info: dict = {
        "name": "",
        "furigana": "",
        "role": "",
        "faction": "",
        "party": "",
        "committees": [],
        "terms": "",
        "photo_src": "",
    }

    h1 = soup.find("h1")
    if h1:
        raw = h1.get_text(" ", strip=True)
        # 例: "山本　正信（やまもと　まさのぶ）"
        m = NAME_FURIGANA_RE.search(raw)
        if m:
            info["name"] = re.sub(r"\s+", " ", m.group(1)).strip()
            info["furigana"] = re.sub(r"\s+", " ", m.group(2)).strip()
        else:
            info["name"] = raw

    # body内の役職（【議長】【副議長】等）は本文の <p> に記載
    main = soup.find(id="main_body") or soup
    body_text = main.get_text(" ", strip=True)
    role_match = re.search(r"【([^】]+)】", body_text)
    if role_match:
        info["role"] = role_match.group(1).strip()

    # 写真
    img = main.find("img", alt=True)
    if img and img.get("src"):
        src = img["src"]
        # ヘッダーのロゴ等を除外（uploaded画像のみ採用）
        if "/uploaded/" in src:
            info["photo_src"] = src

    # 所属会派等一覧表
    table = main.find("table")
    if table:
        committees: list[str] = []
        current_key = ""
        for tr in table.find_all("tr"):
            th = tr.find("th")
            td = tr.find("td")
            if th is not None:
                current_key = th.get_text(strip=True)
            if td is None:
                continue
            value = td.get_text(" ", strip=True)
            if not value:
                continue
            if "所属会派" in current_key or "活動名" in current_key:
                # 例: "市民ネットワーク（立憲民主党）"
                fm = re.match(r"^(.+?)[（(](.+?)[）)]\s*$", value)
                if fm:
                    info["faction"] = fm.group(1).strip()
                    info["party"] = fm.group(2).strip()
                else:
                    info["faction"] = value
            elif "常任委員会" in current_key or "委員会" in current_key:
                # 複数の td が連続する行もあるので個別に取り込む
                for cell in tr.find_all("td"):
                    c = cell.get_text(" ", strip=True)
                    if c and c not in committees:
                        committees.append(c)
            elif "当選回数" in current_key:
                info["terms"] = value
        if committees:
            info["committees"] = committees

    return info


def download_photo(remote_src: str, seat: int) -> str:
    if not remote_src:
        return ""
    url = remote_src if remote_src.startswith("http") else BASE_URL + remote_src
    ext = url.split(".")[-1].split("?")[0].lower()
    if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=20)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/takikawa/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗 {url} -> {e}")
        return ""


def main() -> None:
    print("滝川市議会 議員名簿を収集中...")
    index = fetch(INDEX_URL)
    if index is None:
        print("一覧ページ取得失敗")
        return

    links = collect_member_links(index)
    print(f"  議員個別ページ {len(links)} 件発見")
    if not links:
        print("  取得不可: 議員リンクが見つかりません")
        return

    members: list[dict] = []
    for i, (url, link_text) in enumerate(links, start=1):
        print(f"  [{i}/{len(links)}] {link_text} -> {url}")
        detail = fetch(url)
        time.sleep(0.6)
        if detail is None:
            continue
        info = parse_detail(detail)
        if not info["name"]:
            # h1 が無いケースの保険として、リンクテキストを使う
            info["name"] = link_text

        photo_url = download_photo(info["photo_src"], i)
        # 全角スペースを半角スペースに揃える（表記ゆれ吸収）
        def norm(s: str) -> str:
            return re.sub(r"[\s　]+", " ", s).strip()

        members.append({
            "seat_number": i,
            "name": norm(info["name"]),
            "furigana": norm(info["furigana"]),
            "party": info["party"],
            "faction": info["faction"],
            "committees": info["committees"],
            "role": info["role"],
            "terms": info["terms"],
            "photo_url": photo_url,
            "source_url": url,
        })

    if not members:
        print("  取得不可: 有効な議員情報を抽出できませんでした")
        return

    payload = {
        "municipality": "takikawa",
        "source": INDEX_URL,
        "count": len(members),
        "members": members,
    }
    out_path = OUTPUT_DIR / "members.json"
    site_out_path = SITE_OUTPUT_DIR / "members.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    with site_out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"\n  取得議員数: {len(members)}名")
    print(f"  出力: {out_path}")
    print(f"  出力: {site_out_path}")


if __name__ == "__main__":
    main()
