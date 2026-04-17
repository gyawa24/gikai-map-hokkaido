"""
札幌市議会 議員名簿スクレイパー
出力: site/data/sapporo/members.json
写真: site/public/members/sapporo/seat_N.<ext>
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.sapporo.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/meibo/meibo-50on.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "site" / "data" / "sapporo"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "sapporo"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 選挙区（札幌市は10区）
DISTRICTS = [
    "中央区", "北区", "東区", "白石区", "厚別区",
    "豊平区", "清田区", "南区", "西区", "手稲区",
]


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def parse_cell_district_faction(td) -> tuple[str, str]:
    """
    「選出区・会派（期）」セルから選挙区と会派を抽出。
    構造は <br> 区切りで [選挙区] / [会派] / [（N期）]。
    HTMLに多重ネストされた <strong> が入るので、行単位でテキスト化してから判定する。
    """
    # <br> を改行に置換してテキスト化
    raw = td.decode_contents()
    raw = re.sub(r"<br\s*/?>", "\n", raw, flags=re.I)
    text = BeautifulSoup(raw, "html.parser").get_text("\n")
    lines = [re.sub(r"\s+", " ", ln.replace("\u3000", " ")).strip() for ln in text.split("\n")]
    lines = [ln for ln in lines if ln]

    district = ""
    faction = ""
    for ln in lines:
        # 選挙区
        if not district:
            for d in DISTRICTS:
                if d in ln:
                    district = d
                    # 選挙区と会派が同じ行にある場合に備え、残りを抽出
                    rest = ln.replace(d, "").strip()
                    if rest and not re.match(r"^[（(]\d+期[)）]$", rest):
                        faction = rest
                    break
            if district:
                continue
        # 期数行はスキップ
        if re.match(r"^[（(]\d+期[)）]$", ln):
            continue
        # 期数表記が混ざった行（例: "自民党（1期）"）は期を除去
        ln_clean = re.sub(r"[（(]\d+期[)）]", "", ln).strip()
        if not ln_clean:
            continue
        # 会派行
        if not faction:
            faction = ln_clean

    return district, faction


def extract_committees(ul) -> list[str]:
    if ul is None:
        return []
    items = []
    for li in ul.find_all("li"):
        t = li.get_text(strip=True)
        if t:
            items.append(t)
    return items


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split(".")[-1].split("?")[0].lower()
    if ext not in {"jpg", "jpeg", "png", "gif"}:
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/sapporo/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗: {remote_url} -> {e}")
        return ""


def scrape_members():
    print("札幌市議会 議員名簿を収集中...")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        print("  ページ取得失敗")
        return

    soup = BeautifulSoup(resp.text, "html.parser")

    members: list[dict] = []
    seat = 0

    # 各 50音 テーブル内の <tr> を順に処理
    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            tds = tr.find_all("td", recursive=False)
            if len(tds) < 4:
                continue

            # 2番目のtdに 顔写真・氏名
            name_td = tds[1]
            img = name_td.find("img")
            # 名前（最初の <p><strong>...</strong></p>）
            p_tags = name_td.find_all("p")
            if not p_tags:
                continue

            # 氏名 = <img> の次の <p> テキスト
            name_raw = ""
            furigana_raw = ""
            for p in p_tags:
                t = p.get_text(strip=True).replace("\u3000", " ")
                if not t:
                    continue
                if t.startswith("(") or t.startswith("（"):
                    furigana_raw = t.strip("()（）").strip()
                else:
                    if not name_raw:
                        name_raw = t

            if not name_raw:
                continue

            # ヘッダー行除外（"顔写真・氏名" などのセル）
            if "氏名" in name_raw or "顔写真" in name_raw:
                continue

            name = re.sub(r"\s+", " ", name_raw).strip()
            furigana = re.sub(r"\s+", " ", furigana_raw).strip()

            district, faction = parse_cell_district_faction(tds[2])

            committees = extract_committees(tds[3].find("ul"))

            seat += 1

            photo_url = ""
            if img and img.get("src"):
                src = img["src"]
                remote = src if src.startswith("http") else BASE_URL + src
                photo_url = download_photo(remote, seat)
                time.sleep(0.2)

            member = {
                "seat_number": seat,
                "name": name,
                "furigana": furigana,
                "party": faction,  # 会派＝政党 として同値を入れる（札幌市議会サイトは会派表記）
                "faction": faction,
                "district": district,
                "committees": committees,
                "photo_url": photo_url,
            }
            members.append(member)
            print(f"  [{seat:02d}] {name} ({furigana}) / {district} / {faction}")

    if not members:
        print("  議員データが抽出できませんでした")
        return

    out_path = OUTPUT_DIR / "members.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump({"members": members}, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(members)} 名を {out_path} に保存")


if __name__ == "__main__":
    scrape_members()
