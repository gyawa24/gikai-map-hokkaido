"""
鹿追町議会 議員名簿スクレイパー
出力: data/shikaoi/members.json, site/data/shikaoi/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.shikaoi.lg.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/meibo/"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "shikaoi"
SITE_DATA_DIR = ROOT / "site" / "data" / "shikaoi"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "shikaoi"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

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


def norm_space(s: str) -> str:
    # 全角/半角空白を半角1つに正規化し、前後空白を除去
    return re.sub(r"[\s\u3000]+", " ", s or "").strip()


def parse_seat_and_name(h4_text: str) -> tuple[int | None, str | None]:
    # 例: "1番　佐々木　康人" / "6番　欠番"
    t = norm_space(h4_text)
    m = re.match(r"^(\d+)番\s*(.+)$", t)
    if not m:
        return None, None
    seat = int(m.group(1))
    name = m.group(2).strip()
    if "欠番" in name or "欠員" in name:
        return seat, None
    # 氏と名の間の空白を1つに
    name = re.sub(r"\s+", "　", name)
    return seat, name


def parse_member_table(table) -> dict:
    """tableから氏名(ふりがな)、党派、委員会を抽出"""
    data = {"furigana": "", "party": "", "committees": [], "title": ""}
    for tr in table.find_all("tr"):
        th = tr.find("th")
        td = tr.find("td")
        if not th or not td:
            continue
        label = norm_space(th.get_text(" ", strip=True))
        # td は <br> 区切りなので改行に置換してから取得
        for br in td.find_all("br"):
            br.replace_with("\n")
        value = td.get_text("\n", strip=True)

        if "氏名" in label:
            # 例: "1番　佐々木　康人\n（ささき　やすと）"
            m = re.search(r"[（(]([^）)]+)[）)]", value)
            if m:
                data["furigana"] = norm_space(m.group(1)).replace(" ", "　")
            # 議長などの肩書きが含まれる場合
            if "議長" in value and "副議長" not in value:
                data["title"] = "議長"
            elif "副議長" in value:
                data["title"] = "副議長"
        elif "党派" in label or "所属政党" in label:
            # "無所属・当選1回" → "無所属"
            party = value.split("・")[0].strip()
            # 改行入りの場合もケア
            party = party.split("\n")[0].strip()
            data["party"] = party
        elif "委員" in label or "所属" in label:
            committees = [norm_space(x) for x in value.split("\n") if norm_space(x)]
            data["committees"] = committees
    return data


def extract_title_from_context(article, h4) -> str:
    """h4やその周辺テキストから議長/副議長情報を拾う（見出しに書かれているケース用）"""
    t = norm_space(h4.get_text(" ", strip=True))
    if "議長" in t and "副議長" not in t:
        return "議長"
    if "副議長" in t:
        return "副議長"
    return ""


def download_photo(src: str, seat: int) -> str:
    remote_url = src if src.startswith("http") else BASE_URL + src
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=20)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/shikaoi/{fname}"
    except Exception as e:
        print(f"  [WARN] photo download failed {remote_url} -> {e}")
        return ""


def scrape_members():
    print("鹿追町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    article = soup.find("article", id="article") or soup.find("main")
    if article is None:
        print("  article 要素が見つかりません")
        return []

    members = []
    # 各議員は h4 "N番 氏名" で始まる
    for h4 in article.find_all("h4"):
        seat, name = parse_seat_and_name(h4.get_text(" ", strip=True))
        if seat is None:
            continue
        if name is None:
            # 欠番
            print(f"  [{seat}番] 欠番（スキップ）")
            continue

        # 同じ h4 の後、次の h4 までの範囲を対象に img / table を探す
        photo_src = ""
        table = None
        sib = h4.parent  # h4 はラップ div の中
        # 後続の兄弟 div を走査
        cur = sib.find_next_sibling()
        while cur is not None:
            # 次の議員見出しに到達したら停止
            if cur.find("h4"):
                break
            if cur.find("img") and not photo_src:
                img = cur.find("img")
                if img.get("src"):
                    photo_src = img["src"]
            if cur.find("table") and table is None:
                table = cur.find("table")
            cur = cur.find_next_sibling()

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        }

        if table is not None:
            parsed = parse_member_table(table)
            member["furigana"] = parsed["furigana"]
            member["party"] = parsed["party"]
            member["committees"] = parsed["committees"]
            if parsed["title"]:
                member["title"] = parsed["title"]

        title_from_h = extract_title_from_context(article, h4)
        if title_from_h and not member.get("title"):
            member["title"] = title_from_h

        if photo_src:
            photo_url = download_photo(photo_src, seat)
            if photo_url:
                member["photo_url"] = photo_url
            time.sleep(0.3)

        members.append(member)
        print(
            f"  [{seat}番] {member['name']} ({member['furigana']}) "
            f"政党={member['party']} 委員会={len(member['committees'])}件 "
            f"写真={'有' if member['photo_url'] else '無'}"
        )

    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データを1件も抽出できませんでした")
        return

    out = {
        "municipality": "shikaoi",
        "source_url": MEMBERS_URL,
        "members": members,
    }
    (DATA_DIR / "members.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (SITE_DATA_DIR / "members.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n取得議員数: {len(members)}名")
    print(f"出力: {DATA_DIR / 'members.json'}")
    print(f"出力: {SITE_DATA_DIR / 'members.json'}")


if __name__ == "__main__":
    main()
