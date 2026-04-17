"""
白老町議会 議員名簿スクレイパー
出力: data/shiraoi/members.json + site/data/shiraoi/members.json
写真: site/public/members/shiraoi/seat_N.jpg
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.shiraoi.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/docs/page2013072300044.html"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "shiraoi"
SITE_DATA_DIR = ROOT / "site" / "data" / "shiraoi"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "shiraoi"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

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


def parse_seat_and_name(caption_text: str, photo_url: str) -> tuple[int | None, str, str]:
    """captionから議席番号・氏名・役職を抽出。番号が無い場合は写真ファイル名から推定。"""
    text = re.sub(r"\s+", " ", caption_text).strip()

    position = ""
    if "議長" in text and "副議長" not in text:
        position = "議長"
    elif "副議長" in text:
        position = "副議長"

    seat: int | None = None
    m = re.search(r"議席番号\s*(\d+)\s*番", text)
    if m:
        seat = int(m.group(1))

    # 氏名抽出: "議席番号 N番" / "議長" / "副議長" を除去した残り
    name = text
    name = re.sub(r"議席番号\s*\d+\s*番", "", name)
    name = re.sub(r"副議長|議長", "", name)
    name = re.sub(r"\s+", "", name).strip()

    # 議長・副議長は議席番号が caption に無いので写真ファイル名から取る
    if seat is None and photo_url:
        fm = re.search(r"/(\d{1,2})\._+\.jpg", photo_url)
        if fm:
            seat = int(fm.group(1))

    return seat, name, position


def parse_faction_party(text: str) -> tuple[str, str]:
    """会派・政党フィールド「ひかり・無所属」「公明党」「無会派・日本共産党」等を分解。"""
    s = text.strip()
    s = re.sub(r"^.*?[：:]", "", s).strip()  # 「会派・政党 ：」を除去
    parts = re.split(r"[・/／]", s)
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) >= 2:
        return parts[0], parts[1]
    if len(parts) == 1:
        # 単独表記は政党のみとみなす（例: 公明党）
        return "", parts[0]
    return "", ""


def extract_member_from_table(table) -> dict | None:
    caption = table.find("caption")
    if not caption:
        return None

    img = table.find("img")
    photo_url_path = img.get("src", "") if img else ""

    seat, name, position = parse_seat_and_name(caption.get_text(" ", strip=True), photo_url_path)
    if not name:
        return None

    # 会派・政党の抽出（<p>単位で探す。<td>を含めると全テキストを拾うため不可）
    faction = ""
    party = ""
    for p in table.find_all("p"):
        t = p.get_text(" ", strip=True)
        if "会派" in t and "政党" in t and ("：" in t or ":" in t):
            faction, party = parse_faction_party(t)
            break

    member = {
        "seat_number": seat,
        "name": name,
        "furigana": "",
        "party": party,
        "faction": faction,
        "committees": [],
    }
    if position:
        member["position"] = position

    # 写真ダウンロード
    if photo_url_path and seat is not None:
        photo_url = photo_url_path if photo_url_path.startswith("http") else BASE_URL + photo_url_path
        ext = photo_url.split(".")[-1].split("?")[0].lower() or "jpg"
        if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
            ext = "jpg"
        fname = f"seat_{seat}.{ext}"
        try:
            img_resp = requests.get(photo_url, headers=HEADERS, timeout=15)
            img_resp.raise_for_status()
            (PHOTO_DIR / fname).write_bytes(img_resp.content)
            member["photo_url"] = f"/members/shiraoi/{fname}"
            time.sleep(0.3)
        except Exception as e:
            print(f"  [WARN] 写真取得失敗 {photo_url} -> {e}")

    return member


def main():
    print("白老町議会 議員名簿を収集中...")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        print("ページ取得失敗")
        return

    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    members: list[dict] = []
    for table in soup.find_all("table"):
        caption = table.find("caption")
        if not caption:
            continue
        cap_text = caption.get_text(" ", strip=True)
        if not (re.search(r"議席番号", cap_text) or "議長" in cap_text):
            continue
        m = extract_member_from_table(table)
        if m:
            members.append(m)
            print(f"  [{m.get('seat_number')}] {m['name']} 会派={m['faction']} 政党={m['party']} {m.get('position', '')}")

    if not members:
        print("議員データを抽出できませんでした")
        return

    members.sort(key=lambda x: (x.get("seat_number") is None, x.get("seat_number") or 0))

    out = {
        "city": "shiraoi",
        "city_name": "白老町",
        "source_url": MEMBERS_URL,
        "members": members,
    }

    for path in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  書き出し: {path}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
