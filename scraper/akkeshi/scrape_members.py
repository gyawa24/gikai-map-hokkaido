"""
厚岸町議会 議員名簿スクレイパー
出力: data/akkeshi/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.akkeshi-town.jp"
MEMBERS_URL = f"{BASE_URL}/chogikai/member/"
INTRODUCE_URL = f"{BASE_URL}/chogikai/introduce/"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "akkeshi"
SITE_DATA_DIR = ROOT / "site" / "data" / "akkeshi"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "akkeshi"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

COMMITTEE_KEY_MAP = {
    "総務産業常任委員会": "総務産業常任委員会",
    "厚生文教常任委員会": "厚生文教常任委員会",
    "広報常任委員会": "広報常任委員会",
    "議会運営委員会": "議会運営委員会",
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


def norm_name(s: str) -> str:
    # 空白（半角・全角）を削除して比較用キーに
    return re.sub(r"[\s\u3000]+", "", s or "")


def parse_member_table(soup: BeautifulSoup) -> list[dict]:
    """議員名簿テーブル（議席番号/氏名/党派/当選回数/職業）をパース"""
    members: list[dict] = []
    for table in soup.find_all("table"):
        head = table.find("thead")
        if not head:
            continue
        head_text = re.sub(r"[\s\u3000]+", "", head.get_text("", strip=True))
        if "議席" not in head_text or "党派" not in head_text:
            continue
        for tr in table.find("tbody").find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 5:
                continue
            seat_txt = tds[0].get_text(strip=True)
            if not seat_txt.isdigit():
                continue
            seat = int(seat_txt)
            name = re.sub(r"[\s\u3000]+", " ", tds[1].get_text(strip=True)).strip()
            party = tds[2].get_text(strip=True)
            terms = tds[3].get_text(strip=True)
            occupation = tds[4].get_text(strip=True)
            members.append({
                "seat_number": seat,
                "name": name,
                "furigana": "",
                "party": party,
                "faction": party,  # 厚岸町は会派＝党派表記のためparty値で代用
                "committees": [],
                "terms": terms,
                "occupation": occupation,
                "photo_url": "",
            })
        if members:
            break
    return members


def parse_committees(soup: BeautifulSoup) -> dict[str, list[tuple[str, str]]]:
    """委員会ごとの (役職, 氏名) リストを抽出"""
    result: dict[str, list[tuple[str, str]]] = {}
    for h4 in soup.find_all("h4"):
        title = re.sub(r"\s*\(\d+\)\s*$", "", h4.get_text(strip=True))
        if title not in COMMITTEE_KEY_MAP:
            continue
        # h4 の次のtableを探す（同じ親divの後ろのsibling div内）
        parent = h4.find_parent("div")
        if not parent:
            continue
        table = None
        for sib in parent.find_next_siblings("div"):
            t = sib.find("table")
            if t:
                table = t
                break
        if not table:
            continue
        entries: list[tuple[str, str]] = []
        for tr in table.find_all("tr"):
            th = tr.find("th")
            td = tr.find("td")
            if not th or not td:
                continue
            role = th.get_text(strip=True).replace("\u00a0", "").strip()
            name = re.sub(r"[\s\u3000]+", " ", td.get_text(strip=True)).strip()
            if name:
                entries.append((role, name))
        if entries:
            result[COMMITTEE_KEY_MAP[title]] = entries
    return result


def apply_committees(members: list[dict], committees: dict[str, list[tuple[str, str]]]):
    name_to_member = {norm_name(m["name"]): m for m in members}
    for com_name, entries in committees.items():
        for role, name in entries:
            m = name_to_member.get(norm_name(name))
            if not m:
                print(f"  [WARN] 委員会メンバー未照合: {com_name} {role} {name}")
                continue
            if role in ("委員長", "副委員長"):
                label = f"{com_name}（{role}）"
            else:
                label = com_name
            if label not in m["committees"]:
                m["committees"].append(label)


def parse_photos(soup: BeautifulSoup) -> dict[str, str]:
    """議員紹介ページから 氏名キー -> 画像相対URL を抽出"""
    mapping: dict[str, str] = {}
    # 各議員ブロック: <strong>議長 大野 利春</strong> など strong の近傍に img がある
    for strong in soup.find_all("strong"):
        text = strong.get_text(" ", strip=True)
        # "議長 大野 利春" / "副議長 竹田 敏夫" / "室﨑 正之" など
        # 敬称などを除去して苗字＋名前のみを残す
        cleaned = re.sub(r"^(議長|副議長)\s*", "", text)
        cleaned = re.sub(r"[\s\u3000]+", "", cleaned)
        if not cleaned:
            continue
        # 同じ親divからimgを探す
        parent = strong.find_parent("div")
        if not parent:
            continue
        img = parent.find("img")
        if not img:
            # 隣接divのimgも探す
            for sib in parent.find_previous_siblings("div"):
                img = sib.find("img")
                if img:
                    break
        if img and img.get("src"):
            mapping[cleaned] = img["src"]
    return mapping


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext.upper() == "JPG":
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/akkeshi/{fname}"
    except Exception as e:
        print(f"  [WARN] 画像取得失敗 {remote_url}: {e}")
        return ""


def main():
    print("厚岸町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("取得不可: 議員名簿ページ取得失敗")
        return

    members = parse_member_table(soup)
    if not members:
        print("取得不可: 議員テーブルを抽出できませんでした")
        return

    print(f"  議員 {len(members)} 名を抽出")

    committees = parse_committees(soup)
    print(f"  委員会 {len(committees)} 種別を抽出")
    apply_committees(members, committees)

    # 写真
    intro = fetch(INTRODUCE_URL)
    if intro is not None:
        photo_map = parse_photos(intro)
        print(f"  写真マッピング {len(photo_map)} 件")
        for m in members:
            key = norm_name(m["name"])
            src = photo_map.get(key)
            if not src:
                continue
            remote = src if src.startswith("http") else BASE_URL + src
            local = download_photo(remote, m["seat_number"])
            time.sleep(0.3)
            if local:
                m["photo_url"] = local

    # JSON出力用に内部フィールドを整形（仕様外フィールドは残す: 後方互換）
    out = []
    for m in members:
        out.append({
            "seat_number": m["seat_number"],
            "name": m["name"],
            "furigana": m["furigana"],
            "party": m["party"],
            "faction": m["faction"],
            "committees": m["committees"],
            "terms": m["terms"],
            "occupation": m["occupation"],
            "photo_url": m["photo_url"],
        })

    payload = json.dumps(out, ensure_ascii=False, indent=2)
    (DATA_DIR / "members.json").write_text(payload, encoding="utf-8")
    (SITE_DATA_DIR / "members.json").write_text(payload, encoding="utf-8")

    print(f"取得議員数: {len(out)}名")
    print(f"  -> {DATA_DIR / 'members.json'}")
    print(f"  -> {SITE_DATA_DIR / 'members.json'}")


if __name__ == "__main__":
    main()
