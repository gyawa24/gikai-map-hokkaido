"""
上士幌町議会 議員名簿スクレイパー
出力: data/kamishihoro/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.kamishihoro.jp"
MEMBERS_URL = f"{BASE_URL}/page/00000152"
ROOT = Path(__file__).parent.parent.parent
OUTPUT_PATHS = [
    ROOT / "data" / "kamishihoro" / "members.json",
    ROOT / "site" / "data" / "kamishihoro" / "members.json",
]
for p in OUTPUT_PATHS:
    p.parent.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
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


def normalize_name(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\u3000", " ").strip())


def nospace(name: str) -> str:
    return re.sub(r"\s+", "", name)


def parse_main_table(table) -> list[dict]:
    members = []
    rows = table.find_all("tr")
    header_idx = None
    for i, r in enumerate(rows):
        cells = [c.get_text(strip=True) for c in r.find_all(["td", "th"])]
        if "議席番号" in "".join(cells):
            header_idx = i
            break
    if header_idx is None:
        return members

    header_cells = [c.get_text(strip=True) for c in rows[header_idx].find_all(["td", "th"])]
    col = {name: idx for idx, name in enumerate(header_cells)}

    for r in rows[header_idx + 1:]:
        cells = [c.get_text(" ", strip=True) for c in r.find_all(["td", "th"])]
        if len(cells) < len(header_cells):
            continue
        seat_raw = cells[col.get("議席番号", 0)]
        try:
            seat = int(re.sub(r"\D", "", seat_raw))
        except ValueError:
            continue
        name = normalize_name(cells[col.get("氏名", 1)])
        committees_raw = cells[col.get("所属委員会", 2)]
        party = normalize_name(cells[col.get("党派", 3)]) if "党派" in col else ""
        committees = [c for c in re.split(r"[\s,、]+", committees_raw) if c]
        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": "",
            "committees": committees,
            "photo_url": "",
        })
    return members


def parse_role_tables(tables) -> tuple[dict[str, str], dict[tuple[str, str], str]]:
    """
    すべての役職テーブルを解析:
      - chair_roles: {氏名(スペース除去): '議長'/'副議長'}
      - committee_roles: {(委員会名, 氏名スペース除去): '委員長'/'副委員長'/'委員'}
    委員会名ヘッダを持たないテーブルは無視。
    """
    chair_roles: dict[str, str] = {}
    committee_roles: dict[tuple[str, str], str] = {}

    for t in tables:
        rows = t.find_all("tr")
        current_committee: str | None = None
        # テーブル自体に委員会名ヘッダがない場合、直前の見出し/divから推定
        first_cells_flat = ""
        if rows:
            first_cells_flat = "".join(
                c.get_text(strip=True) for c in rows[0].find_all(["td", "th"])
            )
        if "委員会" not in first_cells_flat:
            prev = t.find_previous(["h2", "h3", "h4", "h5", "div", "p"])
            # 最初の「委員会」という語を含む簡潔な見出しを探す（最大10個前まで）
            hops = 0
            while prev is not None and hops < 10:
                txt = prev.get_text(" ", strip=True)
                if (
                    "委員会" in txt
                    and len(txt) < 40
                    and "役職" not in txt
                ):
                    current_committee = txt
                    break
                prev = prev.find_previous(["h2", "h3", "h4", "h5", "div", "p"])
                hops += 1

        for r in rows:
            cells = [c.get_text(" ", strip=True) for c in r.find_all(["td", "th"])]
            if len(cells) == 1 and "委員会" in cells[0]:
                current_committee = cells[0]
                continue
            if len(cells) >= 2:
                role = cells[0]
                name = normalize_name(cells[1])
                if not name:
                    continue
                if role in ("議長", "副議長"):
                    chair_roles[nospace(name)] = role
                elif role in ("委員長", "副委員長", "委員") and current_committee:
                    committee_roles[(current_committee, nospace(name))] = role
    return chair_roles, committee_roles


def scrape_members():
    print("上士幌町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    tables = soup.find_all("table")
    if not tables:
        print("  テーブルが見つかりません")
        return

    main_table = None
    for t in tables:
        rows = t.find_all("tr")
        for r in rows[:2]:
            cells = [c.get_text(strip=True) for c in r.find_all(["td", "th"])]
            if "議席番号" in "".join(cells) and "氏名" in "".join(cells):
                main_table = t
                break
        if main_table:
            break

    if main_table is None:
        print("  議員一覧テーブルが見つかりません")
        return

    members = parse_main_table(main_table)
    if not members:
        print("  議員情報の抽出に失敗しました")
        return

    chair_roles, committee_roles = parse_role_tables(tables)

    for m in members:
        key = nospace(m["name"])
        if key in chair_roles:
            m["faction"] = chair_roles[key]
        # 委員会に役職（委員長・副委員長）を注記
        annotated = []
        for c in m["committees"]:
            role = committee_roles.get((c, key))
            if role in ("委員長", "副委員長"):
                annotated.append(f"{c}（{role}）")
            else:
                annotated.append(c)
        m["committees"] = annotated

    members.sort(key=lambda x: x["seat_number"])

    for p in OUTPUT_PATHS:
        p.write_text(json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  保存: {p}")

    print(f"取得議員数: {len(members)}名")
    for m in members:
        print(f"  [{m['seat_number']}] {m['name']} / {m['party']} / {m['faction']} / {m['committees']}")


if __name__ == "__main__":
    scrape_members()
