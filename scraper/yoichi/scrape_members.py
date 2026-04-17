"""
余市町議会 議員名簿スクレイパー
出力:
  data/yoichi/members.json
  site/data/yoichi/members.json
  site/public/members/yoichi/seat_N.jpg (写真)

公式ソース: https://www.town.yoichi.hokkaido.jp/gikai/gikaikosei/giinsyokai.html
議員氏名・会派等はすべて上記 HTML から動的取得する（ハードコード禁止）。
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.yoichi.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/gikaikosei/giinsyokai.html"

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "yoichi"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "yoichi"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "yoichi"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def strip_ws(text: str) -> str:
    return re.sub(r"[\s\u3000]+", "", text or "")


def clean_name_from_font(font_tag) -> str:
    """<font>内の氏名テキストを整形。<br>で区切られている場合は半角スペースで結合。"""
    raw = font_tag.get_text("\n")
    parts = [strip_ws(line) for line in raw.split("\n")]
    parts = [p for p in parts if p]
    if len(parts) > 1:
        return " ".join(parts)
    return parts[0] if parts else ""


HIRAGANA_RE = re.compile(r"^[\u3040-\u309F\s\u3000]+$")


def parse_pr_name(cell) -> dict:
    """pr-name セルから氏名・ふりがな・会派内役職を抽出。"""
    font_tag = cell.find("font", attrs={"size": "+1"})
    name = clean_name_from_font(font_tag) if font_tag else ""

    role = ""
    furigana = ""
    for s in cell.stripped_strings:
        s_clean = strip_ws(s)
        if not s_clean:
            continue
        if font_tag and s in font_tag.stripped_strings:
            continue
        if HIRAGANA_RE.match(s):
            if not furigana:
                furigana = s_clean
        else:
            if not role:
                role = s_clean
    return {"role": role, "name": name, "furigana": furigana}


POSITION_WORDS = {"議長", "副議長", "監査委員"}


def parse_info(p_tag) -> dict:
    """MsoNormal段落から議席番号と委員会/役職を抽出。"""
    text = p_tag.get_text("\n", strip=True)
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    seat = None
    committees = []
    for line in lines:
        m = re.match(r"議席番号\s*(\d+)", line)
        if m:
            seat = int(m.group(1))
            continue
        if "委員会" in line or line in POSITION_WORDS:
            committees.append(line)
    return {"seat_number": seat, "committees": committees}


def fetch_image(url: str, dest: Path) -> bool:
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        dest.write_bytes(r.content)
        return True
    except Exception as e:
        print(f"  [IMG ERROR] {url} -> {e}")
        return False


def scrape() -> int:
    print("余市町議会 議員名簿を収集中...")
    resp = requests.get(MEMBERS_URL, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding or "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")

    ordered_names: list[dict] = []
    ordered_infos: list[dict] = []
    ordered_images: list[str] = []

    current_faction = ""
    for elem in soup.descendants:
        name = getattr(elem, "name", None)
        if name is None:
            continue
        if name == "h3":
            m = re.search(r"【([^】]+)】", elem.get_text())
            if m:
                current_faction = strip_ws(m.group(1))
        elif name == "td" and "pr-name" in (elem.get("class") or []):
            parsed = parse_pr_name(elem)
            parsed["faction"] = current_faction
            ordered_names.append(parsed)
        elif name == "p" and "MsoNormal" in (elem.get("class") or []):
            if "議席番号" in elem.get_text():
                ordered_infos.append(parse_info(elem))
        elif name == "img":
            src = elem.get("src", "") or ""
            if re.search(r"giin", src, re.I):
                ordered_images.append(src)

    if not ordered_names:
        print("  [ERROR] 議員情報を抽出できませんでした")
        return 0

    if len(ordered_names) != len(ordered_infos):
        print(f"  [WARN] name={len(ordered_names)} info={len(ordered_infos)} 個数不一致")

    members = []
    for i, nm in enumerate(ordered_names):
        info = ordered_infos[i] if i < len(ordered_infos) else {}
        img_src = ordered_images[i] if i < len(ordered_images) else ""
        seat = info.get("seat_number")
        if seat is None:
            print(f"  [WARN] {nm['name']} の議席番号が取得できず、順序番号を使用")
            seat = i + 1

        photo_url = ""
        if img_src:
            img_url = urljoin(MEMBERS_URL, img_src)
            ext = (img_url.rsplit(".", 1)[-1].split("?")[0] or "jpg").lower()
            if ext not in {"jpg", "jpeg", "png", "gif"}:
                ext = "jpg"
            fname = f"seat_{seat}.{ext}"
            if fetch_image(img_url, PHOTO_DIR / fname):
                photo_url = f"/members/yoichi/{fname}"
            time.sleep(0.2)

        # 公明党は会派名=党名。それ以外は党名不明のため空。
        party = "公明党" if nm["faction"] == "公明党" else ""
        # 地域会派。無所属・会派不所属は空文字に正規化。
        faction = nm["faction"]
        if "所属しない" in faction or faction in {"無所属"}:
            faction = ""

        members.append({
            "seat_number": seat,
            "name": nm["name"],
            "furigana": nm["furigana"],
            "party": party,
            "faction": faction,
            "committees": info.get("committees", []),
            "photo_url": photo_url,
        })

    members.sort(key=lambda m: m["seat_number"])

    output = {"members": members}
    for path in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  書き込み: {path}")

    return len(members)


if __name__ == "__main__":
    n = scrape()
    if n > 0:
        print(f"取得議員数: {n}名")
    else:
        print("取得不可: 議員情報を抽出できませんでした")
