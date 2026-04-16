"""
妹背牛町議会 議員名簿スクレイパー
出力: data/moseushi/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.moseushi.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/aramashi/soshiki_kousei.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "moseushi"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "moseushi"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "moseushi"
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

KANJI_TO_INT = {"１": 1, "２": 2, "３": 3, "４": 4, "５": 5,
                "６": 6, "７": 7, "８": 8, "９": 9}


def normalize_name(s: str) -> str:
    """氏名中の空白（全角・半角・nbsp）を除去して比較用キーにする。"""
    return re.sub(r"[\s\u3000\xa0]+", "", s or "")


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def parse_seat(raw: str) -> int | None:
    raw = raw.strip()
    if raw in KANJI_TO_INT:
        return KANJI_TO_INT[raw]
    try:
        return int(raw)
    except ValueError:
        return None


def parse_members_table(soup: BeautifulSoup) -> list[dict]:
    """議員名簿テーブルから (seat, name, furigana) を抽出。"""
    members: list[dict] = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
        if "議席" not in header_cells or "氏名" not in header_cells:
            continue
        for row in rows[1:]:
            cells = [c.get_text(" ", strip=True) for c in row.find_all(["th", "td"])]
            if len(cells) < 2:
                continue
            seat = parse_seat(cells[0])
            name = cells[1].strip()
            furigana = cells[2].strip() if len(cells) > 2 else ""
            if seat is None or not name:
                continue
            members.append({
                "seat_number": seat,
                "name": name,
                "furigana": furigana,
                "party": "",
                "faction": "",
                "committees": [],
            })
        break
    return members


def parse_committees(soup: BeautifulSoup) -> dict[str, list[tuple[str, str]]]:
    """委員会名 -> [(役職, 氏名), ...]"""
    result: dict[str, list[tuple[str, str]]] = {}
    for h in soup.find_all(["h2", "h3"]):
        title = h.get_text(" ", strip=True)
        if "委員会" not in title:
            continue
        # "議会運営委員会 任期：..." から「... 委員会」部分だけ取り出す
        m = re.match(r"(.+?委員会)", title)
        if not m:
            continue
        committee_name = m.group(1).strip()
        # 次の ul を探す
        sib = h.next_sibling
        target_ul = None
        while sib is not None:
            if getattr(sib, "name", None) == "ul":
                target_ul = sib
                break
            if getattr(sib, "name", None) in ("h2", "h3"):
                break
            sib = sib.next_sibling
        if target_ul is None:
            continue
        entries: list[tuple[str, str]] = []
        for li in target_ul.find_all("li"):
            text = li.get_text(" ", strip=True)
            # 「委員長」「副委員長」「委員」「議長」「副議長」は半角空白・全角空白・nbspを
            # 混在させた表記で書かれているため、いったん空白を全部潰してから
            # 先頭の役職キーワードを剥がし、残りを氏名とする。
            compact = re.sub(r"[\s\xa0\u3000]+", "", text)
            role_match = re.match(
                r"(副委員長|委員長|副議長|議長|監査委員\(議選\)|監査委員|委員)",
                compact,
            )
            if not role_match:
                continue
            role = role_match.group(1)
            name = compact[role_match.end():]
            if name:
                entries.append((role, name))
        if entries:
            result[committee_name] = entries
    return result


def scrape_members():
    print("妹背牛町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  取得不可: ページ取得失敗")
        return False

    members = parse_members_table(soup)
    if not members:
        print("  取得不可: 議員名簿テーブルが見つからない")
        return False

    committees = parse_committees(soup)

    name_index = {normalize_name(m["name"]): m for m in members}

    for committee_name, entries in committees.items():
        for role, name in entries:
            m = name_index.get(normalize_name(name))
            if m is None:
                print(f"  [WARN] 委員会で未知の氏名: {committee_name} {role} {name}")
                continue
            label = committee_name
            if role in ("委員長", "副委員長"):
                label = f"{committee_name}（{role}）"
            m["committees"].append(label)

    members.sort(key=lambda x: x["seat_number"])

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    # site/data にも同期
    site_out = SITE_DATA_DIR / "members.json"
    site_out.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"  取得議員数: {len(members)}名")
    print(f"  出力: {out_path}")
    print(f"  同期: {site_out}")
    return True


if __name__ == "__main__":
    ok = scrape_members()
    if not ok:
        raise SystemExit(1)
