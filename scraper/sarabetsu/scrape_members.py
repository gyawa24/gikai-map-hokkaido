"""
更別村議会 議員名簿スクレイパー
出力: data/sarabetsu/members.json

構造: 各議員は
  <h4>N番　　氏名（ふりがな）</h4>
  <div class="paragraph ... img_txt">
    <a href="写真URL"><img ...></a>
    <div class="txt col-11">当選回数... / 党派... / 職業... / 所属委員会等...</div>
  </div>
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.sarabetsu.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/giinmeibo/"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "sarabetsu"
SITE_DATA_DIR = ROOT / "site" / "data" / "sarabetsu"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "sarabetsu"

for d in (OUTPUT_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def http_get(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


HEAD_RE = re.compile(r"^\s*([０-９0-9]+)番\s*(.+?)\s*（\s*(.+?)\s*）\s*$")


def normalize_digits(s: str) -> str:
    return s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))


def clean_spaces(s: str) -> str:
    # 全角・半角スペースを整理
    return re.sub(r"[\s　]+", " ", s).strip()


def parse_header(h4_text: str) -> tuple[int, str, str] | None:
    text = h4_text.replace("\u3000", " ").strip()
    text = re.sub(r"\s+", " ", text)
    # 例: "1番  太田 綱基（おおた つなき）"
    m = HEAD_RE.match(text)
    if not m:
        return None
    seat = int(normalize_digits(m.group(1)))
    name = m.group(2).replace(" ", "").replace("\u3000", "")
    furigana = clean_spaces(m.group(3))
    return seat, name, furigana


def parse_txt_block(txt_div) -> dict:
    """txt col-11 内の情報を構造化"""
    # <br>ごとに行を分ける
    for br in txt_div.find_all("br"):
        br.replace_with("\n")
    raw = txt_div.get_text("\n")
    lines = [clean_spaces(ln) for ln in raw.splitlines()]
    lines = [ln for ln in lines if ln]

    info = {
        "elected_count": "",
        "party": "",
        "occupation": "",
        "committees": [],
        "role": "",
    }

    current_field = None
    for ln in lines:
        # "当選回数 ：3回" など全角コロンも含む
        norm = ln.replace("：", ":").replace(" ", "")
        if norm.startswith("当選回数"):
            info["elected_count"] = norm.split(":", 1)[1] if ":" in norm else ""
            current_field = "elected_count"
        elif norm.startswith("党派") or norm.startswith("党 派"):
            info["party"] = norm.split(":", 1)[1] if ":" in norm else ""
            current_field = "party"
        elif norm.startswith("職業") or norm.startswith("職 業"):
            info["occupation"] = norm.split(":", 1)[1] if ":" in norm else ""
            current_field = "occupation"
        elif norm.startswith("所属委員会") or norm.startswith("所属委員"):
            val = norm.split(":", 1)[1] if ":" in norm else ""
            if val:
                info["committees"].append(val)
            current_field = "committees"
        elif norm.startswith("【") or "特記事項" in norm:
            current_field = None
        else:
            # 継続行（委員会の2行目以降など）
            if current_field == "committees" and norm:
                info["committees"].append(norm)

    # 所属委員会の中から役職（議長・副議長・議会運営委員長等）を抽出
    role_keywords = ["議長", "副議長"]
    cleaned_committees: list[str] = []
    for c in info["committees"]:
        c_stripped = c.strip()
        if not c_stripped:
            continue
        matched_role = None
        for kw in role_keywords:
            if c_stripped == kw:
                matched_role = kw
                break
        if matched_role:
            # 議長・副議長のみの行は committees ではなく role に
            if not info["role"]:
                info["role"] = matched_role
            continue
        cleaned_committees.append(c_stripped)
    info["committees"] = cleaned_committees

    return info


def extract_members(soup: BeautifulSoup) -> list[dict]:
    article = soup.find("article", id="article") or soup
    members: list[dict] = []

    # h4 の並びを起点に、その次の img_txt ブロックをペアリング
    headers = article.find_all("h4")
    for h4 in headers:
        text = h4.get_text(" ", strip=True)
        parsed = parse_header(text)
        if not parsed:
            continue
        seat, name, furigana = parsed

        # h4 の親 paragraph の次に来る img_txt ブロックを探す
        parent = h4.find_parent(class_="paragraph")
        if parent is None:
            continue
        txt_div = None
        img_url = None

        sibling = parent.find_next_sibling()
        # height2 などの空ブロックを飛ばして img_txt を探す
        while sibling is not None:
            classes = sibling.get("class", []) if hasattr(sibling, "get") else []
            if "img_txt" in classes:
                txt_div = sibling.find("div", class_="txt")
                a = sibling.find("a", href=True)
                if a and a.get("href"):
                    img_url = urljoin(BASE_URL, a["href"])
                else:
                    img_tag = sibling.find("img", src=True)
                    if img_tag:
                        img_url = urljoin(BASE_URL, img_tag["src"])
                break
            # 次の h4 に達したら諦める
            if sibling.find("h4"):
                break
            sibling = sibling.find_next_sibling()

        info = parse_txt_block(txt_div) if txt_div else {
            "elected_count": "", "party": "", "occupation": "",
            "committees": [], "role": "",
        }

        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": info["party"],
            "faction": "",
            "committees": info["committees"],
            "role": info["role"],
            "occupation": info["occupation"],
            "elected_count": info["elected_count"],
            "photo_url": "",
            "_remote_photo": img_url or "",
        })

    members.sort(key=lambda m: m["seat_number"])
    return members


def download_photos(members: list[dict]) -> None:
    for m in members:
        url = m.pop("_remote_photo", "")
        if not url:
            continue
        ext = url.rsplit(".", 1)[-1].split("?")[0].lower() or "jpg"
        if ext == "jpeg":
            ext = "jpg"
        if ext not in ("jpg", "png", "gif", "webp"):
            ext = "jpg"
        fname = f"seat_{m['seat_number']}.{ext}"
        resp = http_get(url)
        if resp is None:
            continue
        (PHOTO_DIR / fname).write_bytes(resp.content)
        m["photo_url"] = f"/members/sarabetsu/{fname}"
        time.sleep(0.3)


def main() -> None:
    print("更別村議会 議員名簿を収集中...")
    resp = http_get(MEMBERS_URL)
    if resp is None:
        print("  [ERROR] 議員名簿ページ取得失敗")
        return
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    members = extract_members(soup)
    if not members:
        print("  [ERROR] 議員情報を抽出できませんでした")
        return

    download_photos(members)

    payload = json.dumps(members, ensure_ascii=False, indent=2)
    (OUTPUT_DIR / "members.json").write_text(payload, encoding="utf-8")
    (SITE_DATA_DIR / "members.json").write_text(payload, encoding="utf-8")

    print(f"  [OK] {len(members)} 名抽出")
    for m in members:
        print(
            f"    {m['seat_number']}番 {m['name']} ({m['furigana']}) "
            f"{m['party']} 委員会={m['committees']} 役職={m['role']}"
        )


if __name__ == "__main__":
    main()
