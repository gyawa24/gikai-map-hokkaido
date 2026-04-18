"""
美深町議会 議員名簿スクレイパー
出力:
  - data/bifuka/members.json
  - site/data/bifuka/members.json
  - site/public/members/bifuka/seat_N.jpg

公式サイト: https://www.town.bifuka.hokkaido.jp/cms/section/gikai/qlmcaj0000004uny.html

HTML構造:
- 各議員ブロック: <section id="sN">
    - <h3> に "議席番号X番　氏名（ふりがな）"
    - <div class="txtPart"> に "<br/>" 区切りで各種情報
        当選回数：1回
        党派：無所属
        所属：総務住民常任委員会
              議会広報特別委員会
        役職：監査委員
              議会広報特別委員会委員長
    - 写真: <img src="...gikai/qlmcaj0000004uny-img/xxx.jpg">
- 欠員席は h3 に "欠員" のみ、txtPart 無し
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.bifuka.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/cms/section/gikai/qlmcaj0000004uny.html"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_OUT_DIR = REPO_ROOT / "data" / "bifuka"
SITE_OUT_DIR = REPO_ROOT / "site" / "data" / "bifuka"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "bifuka"
for d in (DATA_OUT_DIR, SITE_OUT_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# h3 例: "議席番号1番　木下 広悠（きのした こうゆう）" / "議席番号5番　欠員"
H3_PATTERN = re.compile(
    r"議席番号\s*(\d+)\s*番\s*[　 ]*"
    r"(?:(欠員)|([^（(]+)\s*[（(]\s*([^）)]+?)\s*[）)])"
)


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] fetch {url}: {e}")
        return None


def normalize_spaces(s: str) -> str:
    return re.sub(r"[\s\u3000\xa0]+", " ", s).strip()


def parse_txt_part(txt_part) -> dict:
    """
    <div class="txtPart"> 内のテキストを <br/> 区切りで取り、
    "key：value" 行と継続行（キー無し）から { key: [values] } を返す。
    """
    # <br/> を改行に置換
    for br in txt_part.find_all("br"):
        br.replace_with("\n")
    raw = txt_part.get_text("\n")
    # 行ごとに正規化
    lines = []
    for line in raw.split("\n"):
        cleaned = normalize_spaces(line)
        if cleaned:
            lines.append(cleaned)

    grouped: dict[str, list[str]] = {}
    current_key: str | None = None
    for line in lines:
        # 全角・半角コロン両対応
        m = re.match(r"^([^：:]{1,10})[：:]\s*(.*)$", line)
        if m:
            current_key = m.group(1).strip()
            value = m.group(2).strip()
            grouped.setdefault(current_key, [])
            if value:
                grouped[current_key].append(value)
        else:
            if current_key is not None:
                grouped[current_key].append(line)
    return grouped


def build_committees(belongs: list[str], roles: list[str]) -> list[str]:
    """
    所属 (belongs) の各委員会について、役職 (roles) 内に同名の委員会を含む
    エントリがあれば '〜委員長' 等のラベルにし、無ければ委員会名のみで返す。
    議長/副議長/監査委員 など委員会以外の役職は委員会には含めない。
    """
    result: list[str] = []
    for committee in belongs:
        label = committee
        for role in roles:
            if role.startswith(committee) and role != committee:
                label = role
                break
        result.append(label)
    return result


def download_photo(img_src: str, seat_number: int) -> str:
    if not img_src:
        return ""
    remote = img_src if img_src.startswith("http") else BASE_URL + img_src
    ext = Path(remote.split("?")[0]).suffix.lstrip(".").lower() or "jpg"
    fname = f"seat_{seat_number}.{ext}"
    try:
        resp = requests.get(remote, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/bifuka/{fname}"
    except Exception as e:
        print(f"  [WARN] seat {seat_number} 写真取得失敗: {e}")
        return ""


def parse_members(soup: BeautifulSoup) -> list[dict]:
    members: list[dict] = []
    sections = soup.find_all("section", id=re.compile(r"^s\d+$"))
    for section in sections:
        h3 = section.find("h3")
        if not h3:
            continue
        h3_text = normalize_spaces(h3.get_text(" ", strip=True))
        m = H3_PATTERN.search(h3_text)
        if not m:
            print(f"  [WARN] h3 解析失敗: {h3_text}")
            continue
        seat_number = int(m.group(1))
        if m.group(2):  # 欠員
            print(f"  議席 {seat_number}: 欠員（スキップ）")
            continue
        name = normalize_spaces(m.group(3))
        furigana = normalize_spaces(m.group(4))

        txt_part = section.find("div", class_="txtPart")
        party = ""
        committees: list[str] = []
        if txt_part:
            grouped = parse_txt_part(txt_part)
            party = (grouped.get("党派") or [""])[0]
            belongs = grouped.get("所属", [])
            roles = grouped.get("役職", [])
            committees = build_committees(belongs, roles)

        photo_url = ""
        img = section.find("img")
        if img and img.get("src"):
            photo_url = download_photo(img["src"], seat_number)
            time.sleep(0.3)

        members.append(
            {
                "seat_number": seat_number,
                "name": name,
                "furigana": furigana,
                "party": party,
                "faction": "",
                "committees": committees,
                "photo_url": photo_url,
            }
        )

    members.sort(key=lambda x: x["seat_number"])
    return members


def main() -> None:
    print("美深町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return
    members = parse_members(soup)
    if not members:
        print("  議員情報を抽出できませんでした（members.json は作成しません）")
        return

    payload = json.dumps(members, ensure_ascii=False, indent=2) + "\n"
    for out_dir in (DATA_OUT_DIR, SITE_OUT_DIR):
        out_path = out_dir / "members.json"
        out_path.write_text(payload, encoding="utf-8")
        print(f"  出力: {out_path}")
    print(f"  取得議員数: {len(members)} 名")


if __name__ == "__main__":
    main()
