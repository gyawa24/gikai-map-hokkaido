"""
仁木町議会 議員名簿スクレイパー
出力: data/niki/members.json
写真: site/public/members/niki/seat_{n}.{ext}
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.niki.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/section/gikai/irv97600000004ny.html"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "niki"
SITE_DATA_DIR = ROOT / "site" / "data" / "niki"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "niki"

for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

HEAD_RE = re.compile(r"^\s*(\d+)\s*[\.．]\s*(.+?)\s*[（(]\s*([ぁ-んー\s　]+)\s*[)）]")
NAME_CLEAN_RE = re.compile(r"[（(].*?[)）]|[A-Za-z]+")


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def extract_roles(soup: BeautifulSoup, known_names: list[str]) -> dict[str, str]:
    """ページ本文から「議長/副議長 + 氏名」を抽出。既知の議員名と突き合わせる。"""
    text = soup.get_text("\n")
    text = re.sub(r"\s+", "", text)
    roles: dict[str, str] = {}
    normalized_names = [(n, n.replace(" ", "").replace("　", "")) for n in known_names]
    # 副議長を先に処理（「議長」を含むため）
    for role in ("副議長", "議長"):
        for m in re.finditer(role, text):
            after = text[m.end(): m.end() + 8]
            for original, flat in normalized_names:
                if after.startswith(flat) and original not in roles:
                    roles[original] = role
                    break
    return roles


def parse_member_table(txt_part) -> dict[str, str]:
    """txtPart div 内の table から {ラベル: 値} を抽出。"""
    out: dict[str, str] = {}
    for tr in txt_part.find_all("tr"):
        th = tr.find("th")
        td = tr.find("td")
        if th and td:
            out[th.get_text(strip=True)] = td.get_text(" ", strip=True)
    return out


def download_photo(img_url: str, seat: int) -> str:
    ext = img_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(img_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/niki/{fname}"
    except Exception as e:
        print(f"    [PHOTO ERROR] {img_url} -> {e}")
        return ""


def scrape_members() -> list[dict]:
    print("仁木町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        return []

    members: list[dict] = []
    raw_entries: list[tuple[int, str, str, str, str]] = []  # seat, name, furigana, party, photo

    for h3 in soup.find_all("h3"):
        heading = h3.get_text(strip=True)
        m = HEAD_RE.match(heading)
        if not m:
            continue
        seat = int(m.group(1))

        # 後続ノードから写真と詳細テーブルを探す
        img_url = ""
        detail: dict[str, str] = {}
        for sib in h3.find_next_siblings():
            if sib.name == "h3":
                break
            if sib.name != "div":
                continue
            classes = sib.get("class") or []
            if "iFigure" in classes:
                img = sib.find("img")
                if img and img.get("src"):
                    src = img["src"]
                    img_url = src if src.startswith("http") else (
                        f"{BASE_URL}/section/gikai/{src}" if not src.startswith("/") else BASE_URL + src
                    )
            elif "txtPart" in classes:
                detail = parse_member_table(sib)

        name_raw = detail.get("氏名", "")
        # "前田 春奈(まえだ はるな)Haruna Maeda" → 氏名とふりがなを分離
        name = NAME_CLEAN_RE.sub("", name_raw).strip()
        furigana = ""
        fmatch = re.search(r"[（(]([ぁ-んー\s　]+)[)）]", name_raw)
        if fmatch:
            furigana = re.sub(r"[\s　]+", " ", fmatch.group(1)).strip()

        if not name:
            # フォールバック: 見出しから取得
            name = m.group(2).strip()
            furigana = furigana or re.sub(r"[\s　]+", " ", m.group(3)).strip()

        party = detail.get("党派", "").strip()

        photo_url = download_photo(img_url, seat) if img_url else ""
        time.sleep(0.3)

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",  # 公式サイトに会派欄は無い。議長/副議長はこの後に設定。
            "committees": [],
        }
        if photo_url:
            member["photo_url"] = photo_url

        members.append(member)

    # 役職（議長/副議長）を付与
    names = [m["name"] for m in members]
    roles = extract_roles(soup, names)
    for m in members:
        role = roles.get(m["name"])
        if role:
            m["faction"] = role

    members.sort(key=lambda x: x["seat_number"])

    for m in members:
        print(
            f"  [{m['seat_number']}] {m['name']} ({m['furigana']}) / "
            f"{m['party']} / {m['faction'] or '-'}"
        )
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員情報を抽出できませんでした")
        return

    for out_dir in (DATA_DIR, SITE_DATA_DIR):
        out_path = out_dir / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {out_path}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
