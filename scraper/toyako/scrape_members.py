"""
洞爺湖町議会 議員名簿スクレイパー
出力: data/toyako/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "http://www.town.toyako.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/town_administration/town_council/toc002/"
CHAIR_URL = f"{BASE_URL}/town_administration/town_council/toc001/"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "toyako"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "toyako"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "toyako"
for d in (OUTPUT_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 「会派（無所属）」のような表記を分解する正規表現
FACTION_PARTY_RE = re.compile(r"^(.+?)（(.+?)）$")


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize_text(s: str) -> str:
    # 全角スペース・連続スペースを単一の半角スペースに
    return re.sub(r"[\s\u3000]+", " ", s).strip()


def split_faction_party(value: str) -> tuple[str, str]:
    """
    会派/党派表記から (faction, party) を返す
      "公明党"               -> ("公明党", "公明党")
      "風の会（無所属）"      -> ("風の会", "無所属")
      "日本共産党"            -> ("日本共産党", "日本共産党")
      "幸福実現党"            -> ("幸福実現党", "幸福実現党")
    """
    value = value.strip()
    m = FACTION_PARTY_RE.match(value)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return value, value


def parse_member_block(paragraph, base_seat: int) -> dict | None:
    """
    div.paragraph 1ブロックから議員情報を抽出。画像と本文の両方が必要。
    """
    img_wrap = paragraph.find(class_=re.compile(r"obj_img_(left|right)"))
    txt_wrap = paragraph.find(class_=re.compile(r"obj_txt_(left|right)"))
    if img_wrap is None or txt_wrap is None:
        return None

    bold = txt_wrap.find("b")
    if bold is None:
        return None
    raw_name = normalize_text(bold.get_text(" ", strip=True))
    if not raw_name:
        return None

    # 役職を分離: "板垣 正人（副議長）" -> name="板垣 正人", role="副議長"
    role = ""
    m = re.match(r"^(.+?)（(.+?)）$", raw_name)
    if m:
        name = m.group(1).strip()
        role = m.group(2).strip()
    else:
        name = raw_name

    # 本文テキストを行ごとに分割
    body_parts = []
    for elem in txt_wrap.find("p").stripped_strings:
        body_parts.append(elem)
    # <br/> ベースの分割が取れないので、原文HTMLで br を改行に置き換える
    p_html = str(txt_wrap.find("p"))
    p_text = re.sub(r"<br\s*/?>", "\n", p_html, flags=re.I)
    p_text = BeautifulSoup(p_text, "html.parser").get_text("\n")
    lines = [normalize_text(l) for l in p_text.split("\n") if normalize_text(l)]

    faction = ""
    party = ""
    for line in lines:
        if line.startswith(name):
            continue
        # ラベルが「会派（党派）」または「党派」の両方ありうる
        m_fp = re.match(r"^(?:会派（党派）|党\s*派|会\s*派)\s*(.+)$", line)
        if m_fp:
            faction, party = split_faction_party(m_fp.group(1))
            break

    img_tag = img_wrap.find("img")
    img_src = ""
    if img_tag and img_tag.get("src"):
        img_src = img_tag["src"]

    return {
        "_seat_base": base_seat,
        "_role": role,
        "name": name,
        "furigana": "",
        "party": party,
        "faction": faction,
        "committees": [],
        "_img_src": img_src,
    }


def scrape_chair() -> dict | None:
    """議長は別ページ (toc001) に掲載されているので拾う。"""
    print("洞爺湖町議会 議長情報を収集中...")
    soup = fetch(CHAIR_URL)
    if soup is None:
        return None

    img = soup.find("img", alt=re.compile(r"議長"))
    if img is None:
        return None
    raw_alt = img.get("alt", "")
    # 視覚整形のため全角スペースが1文字ごとに入っている表記を扱う:
    #   "議長　大　西　　智" -> 役職"議長" / 姓"大西" / 名"智"
    # 半角スペースは全角に正規化してから、2つ以上の全角スペースで分割する。
    norm = re.sub(r"\s", "\u3000", raw_alt)
    role_stripped = re.sub(r"^議長\u3000+", "", norm)
    chunks = [c for c in re.split(r"\u3000{2,}", role_stripped) if c]
    if not chunks:
        return None
    # 各チャンク内の単一全角スペースは視覚整形なので削除
    parts = [c.replace("\u3000", "") for c in chunks]
    name = " ".join(parts)

    src = img.get("src", "")
    return {
        "_role": "議長",
        "name": name,
        "furigana": "",
        "party": "",
        "faction": "",
        "committees": [],
        "_img_src": src,
    }


def download_photo(remote_src: str, seat_number: int) -> str:
    if not remote_src:
        return ""
    url = remote_src if remote_src.startswith("http") else BASE_URL + remote_src
    ext = url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif"}:
        ext = "jpg"
    fname = f"seat_{seat_number}.{ext}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        print(f"    photo saved: {fname} ({len(resp.content)} bytes)")
        return f"/members/toyako/{fname}"
    except Exception as e:
        print(f"    [WARN] photo download failed: {url} -> {e}")
        return ""


def main():
    chair = scrape_chair()
    if chair:
        print(f"  議長: {chair['name']}")
    else:
        print("  議長情報が取得できませんでした（処理は続行）")

    print("洞爺湖町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    # 議員紹介ページのチェック - 「議員紹介」というキーワードがあるか
    if "議員" not in soup.get_text():
        print("  ページに議員情報が見当たりません")
        return

    paragraphs = soup.find_all("div", class_=re.compile(r"\bparagraph\b"))
    raw_members = []
    for i, p in enumerate(paragraphs):
        m = parse_member_block(p, i + 1)
        if m is None:
            continue
        raw_members.append(m)

    if not raw_members:
        print("  議員ブロックが抽出できませんでした")
        return

    print(f"  議員ブロック {len(raw_members)} 件抽出")

    # 議長を先頭に追加して連番付与
    ordered = []
    if chair:
        ordered.append(chair)
    ordered.extend(raw_members)

    members = []
    for idx, m in enumerate(ordered, start=1):
        photo_url = download_photo(m.get("_img_src", ""), idx)
        time.sleep(0.3)
        out = {
            "seat_number": idx,
            "name": m["name"],
            "furigana": m.get("furigana", ""),
            "party": m.get("party", ""),
            "faction": m.get("faction", ""),
            "committees": m.get("committees", []),
        }
        if m.get("_role"):
            out["role"] = m["_role"]
        if photo_url:
            out["photo_url"] = photo_url
        members.append(out)

    output_path = OUTPUT_DIR / "members.json"
    output_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    # site/data にも同期
    site_path = SITE_DATA_DIR / "members.json"
    site_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\n  保存: {output_path} ({len(members)} 名)")
    print(f"  保存: {site_path}")


if __name__ == "__main__":
    main()
