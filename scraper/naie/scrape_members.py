"""
奈井江町議会 議員名簿スクレイパー
出力: data/naie/members.json, site/data/naie/members.json
"""

import json
import re
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.naie.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/g_meibo/"

REPO_ROOT = Path(__file__).parent.parent.parent
OUT_DATA = REPO_ROOT / "data" / "naie"
OUT_SITE = REPO_ROOT / "site" / "data" / "naie"
OUT_DATA.mkdir(parents=True, exist_ok=True)
OUT_SITE.mkdir(parents=True, exist_ok=True)

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


def norm_name(s: str) -> str:
    # 全角/半角スペース・NBSPを除去して姓名を連結
    s = s.replace("\u3000", " ").replace("\xa0", " ")
    s = re.sub(r"\s+", "", s).strip()
    return s


def norm_text(s: str) -> str:
    s = s.replace("\u3000", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def parse_member_table(table) -> list[dict]:
    """議員名簿テーブル（職名/氏名/当選回数/所属党派）をパース"""
    rows = table.find_all("tr")
    members = []
    seat = 0
    for tr in rows:
        cells = tr.find_all("td")
        if len(cells) < 4:
            continue
        role_raw = norm_text(cells[0].get_text())
        name_raw = norm_name(cells[1].get_text())
        terms_raw = norm_text(cells[2].get_text())
        party_raw = norm_text(cells[3].get_text())

        # ヘッダ行 (職名 氏名 当選回数 所属党派) をスキップ
        if name_raw in ("氏名", "") or role_raw == "職名":
            continue

        seat += 1
        # 役職は議長・副議長・議会選出監査委員など、「議員」以外の記載
        role = "" if role_raw in ("", "議員", "　") else role_raw
        terms = ""
        m = re.match(r"^\d+$", terms_raw)
        if m:
            terms = f"{terms_raw}回"
        members.append({
            "seat_number": seat,
            "name": name_raw,
            "furigana": "",
            "party": party_raw if party_raw else "",
            "faction": "",
            "committees": [],
            "role": role,
            "terms": terms,
            "photo_url": "",
        })
    return members


def parse_committee_table(table) -> list[tuple[str, str]]:
    """委員会テーブル (職名/氏名) から (name, role) のリストを返す"""
    rows = table.find_all("tr")
    result = []
    for tr in rows:
        cells = tr.find_all("td")
        if len(cells) < 2:
            continue
        role_raw = norm_text(cells[0].get_text())
        name_raw = norm_name(cells[1].get_text())
        if name_raw in ("氏名", "") or role_raw == "職名":
            continue
        # ditto mark (") は前行と同じ → 委員扱い
        if role_raw in ('"', "″", "〃"):
            role = "委員"
        else:
            role = role_raw or "委員"
        result.append((name_raw, role))
    return result


def scrape_members():
    print(f"奈井江町議会 議員名簿を収集中... {MEMBERS_URL}")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    tables = soup.find_all("table", class_="color1")
    if not tables:
        print("  議員テーブルが見つかりません")
        return None

    # 最初のテーブルが議員名簿
    members = parse_member_table(tables[0])
    if not members:
        print("  議員行が抽出できませんでした")
        return None
    print(f"  議員 {len(members)} 名を抽出")

    # 後続テーブルが委員会（最後の「一部事務組合」は除外）
    # 判定: ヘッダに「職名」と「氏名」があれば委員会テーブル
    committee_name_map: dict[str, list[str]] = {}
    for t in tables[1:]:
        # 直前の h4 を委員会名とする
        header = t.find_previous(["h4"])
        if not header:
            continue
        cname = norm_text(header.get_text())
        if "一部事務組合" in cname:
            continue
        if not cname:
            continue
        # このテーブルが (職名, 氏名) の2列構成か確認
        first_row = t.find("tr")
        if not first_row or len(first_row.find_all("td")) != 2:
            continue
        entries = parse_committee_table(t)
        for name, role in entries:
            label = cname
            if role and role not in ("委員", ""):
                label = f"{cname}{role}"
            committee_name_map.setdefault(name, []).append(label)

    for m in members:
        m["committees"] = committee_name_map.get(m["name"], [])

    output = {
        "source_url": MEMBERS_URL,
        "fetched_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "count": len(members),
        "members": members,
    }

    for out in (OUT_DATA, OUT_SITE):
        path = out / "members.json"
        path.write_text(
            json.dumps(output, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  書き出し: {path}")

    return members


if __name__ == "__main__":
    result = scrape_members()
    if result:
        print(f"\n取得議員数: {len(result)}名")
        for m in result:
            parts = [f"#{m['seat_number']}", m["name"]]
            if m["role"]:
                parts.append(f"({m['role']})")
            if m["party"]:
                parts.append(f"[{m['party']}]")
            if m["committees"]:
                parts.append("/".join(m["committees"]))
            print("  " + " ".join(parts))
    else:
        print("\n取得不可")
