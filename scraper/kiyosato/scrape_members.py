"""
清里町議会 議員名簿スクレイパー
出力: data/kiyosato/members.json
写真: site/public/members/kiyosato/seat_N.jpg
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.kiyosato.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/administration/?content=358"
COMMITTEE_URL = f"{BASE_URL}/administration/?content=361"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "kiyosato"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR = ROOT / "site" / "data" / "kiyosato"
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "kiyosato"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

SEAT_PAT = re.compile(r"議席番号\s*(\d+)[\s　]*(.+)")
CHAIR_PAT = re.compile(r"^(議長|副議長)[\s　]+(.+)")
PARTY_PAT = re.compile(r"党派[\s　：:]+(\S+)")


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def norm_name(raw: str) -> str:
    # "畠山 出" / "畠山　出" → "畠山 出"（半角スペース区切りに統一）
    return re.sub(r"[\s　]+", " ", raw).strip()


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif"}:
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/kiyosato/{fname}"
    except Exception as e:
        print(f"  [WARN] photo download failed: {remote_url} -> {e}")
        return ""


def parse_committees() -> dict[str, list[str]]:
    """委員会別名簿ページから 氏名 → 委員会リスト のマップを構築"""
    soup = fetch(COMMITTEE_URL)
    if soup is None:
        return {}
    main = soup.find("main")
    if main is None:
        return {}

    mapping: dict[str, list[str]] = {}
    current_committee: str | None = None
    # 委員会名は head_block または index_block（「常任委員会」「特別委員会」はセクション見出しなので除外）
    # 委員名簿は table_block に入っている
    SECTION_LABELS = {"常任委員会", "特別委員会"}
    for block in main.select(".cassette-item"):
        classes = block.get("class", [])
        text = block.get_text("\n", strip=True).strip()
        if "head_block" in classes or "index_block" in classes:
            if text.endswith("委員会") and text not in SECTION_LABELS:
                current_committee = text
        elif "table_block" in classes and current_committee:
            for name in extract_names_from_block(text):
                mapping.setdefault(norm_name(name), []).append(current_committee)
    return mapping


def extract_names_from_block(text: str) -> list[str]:
    """委員会ブロックのテキストから氏名のみを抽出"""
    names: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        # ラベル行スキップ
        if line in {"定数", "委員長", "副委員長", "委員", "特別委員会", "常任委員会"}:
            continue
        if line.endswith("委員会"):
            continue
        if re.fullmatch(r"\d+", line):
            continue
        if line.startswith("（") or line.startswith("("):
            continue
        # 氏名らしき行のみ（日本語2文字以上・数字を含まない）
        if re.search(r"[一-龥]", line) and not re.search(r"\d", line):
            names.append(line)
    return names


def scrape_members():
    print("清里町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return False
    main = soup.find("main")
    if main is None:
        print("  main要素が見つかりません")
        return False

    committees_map = parse_committees()
    print(f"  委員会マップ: {len(committees_map)} 名分")

    # head_block と直後の text_block をペアで処理
    blocks = main.select(".cassette-item")
    members_by_seat: dict[int, dict] = {}
    chair_names: dict[str, str] = {}  # 議長/副議長 → 氏名

    for i, block in enumerate(blocks):
        classes = block.get("class", [])
        if "head_block" not in classes:
            continue
        heading = block.get_text(" ", strip=True)
        heading = norm_name(heading)

        # 議長 / 副議長 行（議席番号なし）
        m_chair = CHAIR_PAT.match(heading)
        if m_chair and "議席番号" not in heading:
            chair_names[m_chair.group(1)] = norm_name(m_chair.group(2))
            continue

        m_seat = SEAT_PAT.search(heading)
        if not m_seat:
            continue
        seat = int(m_seat.group(1))
        name = norm_name(m_seat.group(2))

        # 直後の text_block を取得
        detail_text = ""
        photo_src = ""
        for j in range(i + 1, min(i + 4, len(blocks))):
            nxt = blocks[j]
            nxt_classes = nxt.get("class", [])
            if "head_block" in nxt_classes:
                break
            if "text_block" in nxt_classes:
                detail_text = nxt.get_text("\n", strip=True)
                img = nxt.find("img")
                if img and img.get("src"):
                    src = img["src"]
                    if src.startswith("http"):
                        photo_src = src
                    else:
                        # ../../assets/... → 絶対URL
                        photo_src = requests.compat.urljoin(MEMBERS_URL, src)
                break

        party = ""
        m_party = PARTY_PAT.search(detail_text)
        if m_party:
            party = m_party.group(1).strip()

        photo_url = ""
        if photo_src:
            photo_url = download_photo(photo_src, seat)
            time.sleep(0.3)

        members_by_seat[seat] = {
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": "",
            "committees": committees_map.get(name, []),
            "photo_url": photo_url,
        }

    # 議長/副議長を faction として付与（役職表示）
    for role, rname in chair_names.items():
        for m in members_by_seat.values():
            if m["name"] == rname:
                m["faction"] = role

    members = [members_by_seat[k] for k in sorted(members_by_seat.keys())]

    if not members:
        print("  議員データが抽出できませんでした")
        return False

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    site_path = SITE_DATA_DIR / "members.json"
    site_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"  書き出し: {out_path}")
    print(f"  書き出し: {site_path}")
    print(f"取得議員数: {len(members)}名")
    for m in members:
        print(
            f"    席{m['seat_number']:>2} {m['name']} "
            f"党派={m['party'] or '-'} 役職={m['faction'] or '-'} "
            f"委員会={','.join(m['committees']) or '-'}"
        )
    return True


if __name__ == "__main__":
    ok = scrape_members()
    raise SystemExit(0 if ok else 1)
