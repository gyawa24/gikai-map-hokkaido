"""
釧路市議会 議員名簿スクレイパー
出力: data/kushiro/members.json

ページ構造:
  <h3>3　齋藤　賢之（さいとう　たかゆき）（60）当1</h3>
  <img src="...03_saitou.jpg" ...>
  <p>【自民市政クラブ】</p>
  <p>委員会情報...</p>
  ...次の <h3> まで
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup, NavigableString

BASE_URL = "https://www.city.kushiro.lg.jp"
MEMBERS_URL = f"{BASE_URL}/shigikai/shigikaikara/1002833.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "kushiro"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "kushiro"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 会派→政党マッピング
FACTION_TO_PARTY = {
    "自民市政クラブ": "自由民主党",
    "公明党議員団": "公明党",
    "日本共産党議員団": "日本共産党",
    "創志会": "",
    "市民連合議員団": "",
    "無所属": "無所属",
}


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def resolve_photo_url(src: str) -> str:
    """相対パスを絶対URLに変換"""
    if src.startswith("http"):
        return src
    if src.startswith("/"):
        return BASE_URL + src
    # ../../_res/... → BASE_URL/_res/...
    cleaned = re.sub(r"^(\.\./)+", "", src)
    return BASE_URL + "/" + cleaned


def download_photo(remote_url: str, seat: int) -> str:
    """写真をダウンロードしてローカルパスを返す"""
    ext = remote_url.split(".")[-1].split("?")[0] or "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        img_resp = requests.get(remote_url, headers=HEADERS, timeout=10)
        img_resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(img_resp.content)
        return f"/members/kushiro/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗 seat {seat}: {e}")
        return ""


def collect_siblings_until_next_h3(h3_element):
    """h3 の次の兄弟要素を、次の h3 が来るまで収集する"""
    siblings = []
    for sib in h3_element.next_siblings:
        if sib.name in ("h3", "h4") if hasattr(sib, "name") else False:
            break
        siblings.append(sib)
    return siblings


def scrape_members():
    print("釧路市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    # メインコンテンツを特定
    content = (
        soup.find("div", id="contents")
        or soup.find("div", id="main")
        or soup.find("main")
        or soup.find("article")
        or soup.body
    )

    # 議員見出し（h3）を収集: "N　氏名（ふりがな）..." 形式
    seat_h3_pattern = re.compile(r"^(\d+)\s*[\u3000　\s]\s*(.+)")
    h3_list = content.find_all(["h3", "h4"]) if content else []

    member_headings = []
    for h in h3_list:
        text = h.get_text(strip=True)
        m = seat_h3_pattern.match(text)
        if m:
            seat_num = int(m.group(1))
            rest = m.group(2)  # 氏名＋ふりがな＋年齢＋当選回数 全て含む
            member_headings.append((seat_num, rest, h))

    print(f"  {len(member_headings)} 名分の見出しを検出")

    members = []

    for seat_num, rest, h3 in member_headings:
        # ---- 氏名パース ----
        # rest: "齋藤　賢之（さいとう　たかゆき）（60）当1"
        # まず（）内をすべて抽出
        parens = re.findall(r"[（(]([^）)]+)[）)]", rest)
        # ふりがなを探す: ひらがなが主体
        furigana = ""
        for p in parens:
            if re.search(r"[ぁ-ん]{2,}", p):
                furigana = re.sub(r"[\u3000\s]+", " ", p).strip()
                break

        # 氏名: 最初の（）より前の部分 / 当N・年齢・数字を除去
        name_raw = re.split(r"[（(]", rest)[0].strip()
        name_raw = re.sub(r"当\d+", "", name_raw).strip()
        name_raw = re.sub(r"\d+", "", name_raw).strip()
        name = re.sub(r"[\u3000\s]+", " ", name_raw).strip()

        member = {
            "seat_number": seat_num,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        }

        # ---- h3 の後続要素を収集 ----
        siblings = collect_siblings_until_next_h3(h3)

        full_section_text = ""
        photo_url_found = ""

        for sib in siblings:
            if isinstance(sib, NavigableString):
                full_section_text += str(sib) + "\n"
                continue

            sib_text = sib.get_text("\n")
            full_section_text += sib_text + "\n"

            # 写真
            if not photo_url_found:
                imgs = sib.find_all("img") if hasattr(sib, "find_all") else []
                for img in imgs:
                    src = img.get("src", "")
                    if src and re.search(r"\d{2}_\w+\.(jpg|jpeg|png)", src, re.I):
                        remote_url = resolve_photo_url(src)
                        print(f"  [{seat_num}] 写真取得: {remote_url}")
                        local = download_photo(remote_url, seat_num)
                        if local:
                            photo_url_found = local
                        time.sleep(0.3)
                        break

        member["photo_url"] = photo_url_found

        # ---- 会派抽出 ----
        faction_m = re.search(r"[【\[〔]([^】\]〕]+)[】\]〕]", full_section_text)
        if faction_m:
            faction = faction_m.group(1).strip()
            member["faction"] = faction
            member["party"] = FACTION_TO_PARTY.get(faction, "")
        else:
            # 「無所属」の場合タグ無し表記の可能性
            if re.search(r"無所属", full_section_text):
                member["faction"] = "無所属"
                member["party"] = "無所属"

        # ---- 委員会抽出 ----
        committees = []
        for line in full_section_text.split("\n"):
            line = line.strip()
            if re.search(r"常任委員|特別委員|議長|副議長|議会運営委員", line):
                # 行全体が委員会情報の場合
                # 複数委員会が1行に入っている場合は分割
                for part in re.split(r"[、,，・\u3000]", line):
                    part = part.strip()
                    if re.search(r"委員|議長", part) and 3 <= len(part) <= 30:
                        committees.append(part)
        # 重複除去（順序保持）
        seen = set()
        unique_committees = []
        for c in committees:
            if c not in seen:
                seen.add(c)
                unique_committees.append(c)
        member["committees"] = unique_committees

        members.append(member)
        print(f"  [{seat_num}] {name} | 会派: {member['faction']} | ふりがな: {furigana}")

    # seat_number でソート
    members.sort(key=lambda x: x["seat_number"])

    if members:
        out_path = OUTPUT_DIR / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n  -> 保存完了: {out_path} ({len(members)}名)")
    else:
        print("  議員データが取得できませんでした。")
        print(f"  対象URL: {MEMBERS_URL}")


if __name__ == "__main__":
    scrape_members()
