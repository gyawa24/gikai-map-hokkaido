"""
安平町議会 議員名簿スクレイパー
出力: data/abira/members.json (および site/data/abira/members.json)
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.abira.lg.jp"
MEMBERS_URL = f"{BASE_URL}/gyosei/gikai-meibo"

REPO_ROOT = Path(__file__).parent.parent.parent
OUT_DIRS = [REPO_ROOT / "data" / "abira", REPO_ROOT / "site" / "data" / "abira"]
for d in OUT_DIRS:
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def normalize(s: str) -> str:
    """全角スペース・通常スペース除去で氏名を正規化（マッチング用）"""
    return re.sub(r"[\s\u3000]+", "", s or "")


def display_name(s: str) -> str:
    """表示用文字列: 全角スペース等を単一半角スペースに"""
    return re.sub(r"[\s\u3000]+", " ", s or "").strip()


def kanji_name(s: str) -> str:
    """漢字氏名: ソースは字間に全角スペースを入れた整形なので全て除去する"""
    return re.sub(r"[\s\u3000]+", "", s or "")


def normalize_party(p: str) -> str:
    p = (p or "").strip()
    if p == "無":
        return "無所属"
    return p


def fetch(url: str) -> BeautifulSoup:
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return BeautifulSoup(resp.text, "html.parser")


def parse_members_table(table) -> list[dict]:
    """
    議員名簿テーブルを解析。
    パターン: 6セル行 (議席, ふりがな, 〒, '', 党派, 当選回数) +
              4セル行 (氏名漢字, 住所, 連絡先, '')
    """
    rows = table.find_all("tr")
    members: list[dict] = []
    pending: dict | None = None  # 1行目で生成、2行目で氏名漢字を追加

    extra_seat_counter = 0  # 「議長」「副議長」のように番号がない行用
    max_numeric_seat = 0

    # まず最大議席番号を取得
    for r in rows:
        cells = [c.get_text(strip=True) for c in r.find_all(["td", "th"])]
        if len(cells) >= 6 and cells[0].isdigit():
            max_numeric_seat = max(max_numeric_seat, int(cells[0]))

    for r in rows:
        cells = [c.get_text(strip=True) for c in r.find_all(["td", "th"])]
        if len(cells) >= 6 and cells[0] not in ("議席", ""):
            # 1行目開始
            seat_raw = cells[0]
            furigana_raw = cells[1]
            party = cells[4]
            role = ""
            if seat_raw.isdigit():
                seat_number = int(seat_raw)
            else:
                role = kanji_name(seat_raw)
                extra_seat_counter += 1
                seat_number = max_numeric_seat + extra_seat_counter

            pending = {
                "seat_number": seat_number,
                "name": "",  # 次の行で埋める
                "furigana": display_name(furigana_raw),
                "party": normalize_party(party),
                "faction": "",
                "committees": [],
            }
            if role:
                pending["role"] = role
        elif pending is not None and len(cells) >= 1 and cells[0]:
            # 2行目: 氏名漢字
            pending["name"] = kanji_name(cells[0])
            members.append(pending)
            pending = None
    return members


def parse_committees(table, members: list[dict]) -> None:
    """
    委員会テーブルを解析し各議員のcommittees/factionを更新。
    ◎ = 委員長, ○ = 副委員長
    """
    rows = table.find_all("tr")
    by_norm = {normalize(m["name"]): m for m in members}

    current_committee: str | None = None
    target_committees = {
        "総務常任委員会",
        "経済常任委員会",
        "議会運営委員会",
        "議会広報特別委員会",
        "議会改革調査特別委員会",
    }

    for r in rows:
        cells = [c.get_text(strip=True) for c in r.find_all(["td", "th"])]
        if not cells:
            continue
        # 先頭セルの全角空白を除去して委員会名判定
        first = re.sub(r"[\s\u3000]+", "", cells[0])

        # 「上記以外の、議長を除く9名の議員」 → 議会改革調査特別委員会の継続
        if "上記以外" in first and current_committee == "議会改革調査特別委員会":
            for m in members:
                if m.get("role") == "議長":
                    continue
                # すでに同委員会（委員長/副委員長付きを含む）が登録済みならスキップ
                if any(c.startswith(current_committee) for c in m["committees"]):
                    continue
                m["committees"].append(current_committee)
            continue

        if first in target_committees:
            current_committee = first
            name_cells = cells[1:]
        elif current_committee and first == "":
            # 継続行
            name_cells = cells[1:]
        else:
            # 新しい行（委員会以外、たとえば 議長, 副議長, 監査委員...）
            current_committee = None
            continue

        for nc in name_cells:
            if not nc:
                continue
            chair_mark = ""
            name_part = nc
            if nc.startswith("◎"):
                chair_mark = "（委員長）"
                name_part = nc[1:]
            elif nc.startswith("○"):
                chair_mark = "（副委員長）"
                name_part = nc[1:]
            key = normalize(name_part)
            m = by_norm.get(key)
            if not m:
                continue
            label = current_committee + chair_mark if chair_mark else current_committee
            if label not in m["committees"]:
                m["committees"].append(label)


def main() -> None:
    print(f"安平町議会 議員名簿を取得: {MEMBERS_URL}")
    soup = fetch(MEMBERS_URL)
    tables = soup.find_all("table")
    if len(tables) < 1:
        raise RuntimeError("議員名簿テーブルが見つかりません")

    members = parse_members_table(tables[0])
    if not members:
        raise RuntimeError("議員データを抽出できませんでした")

    print(f"  議員 {len(members)} 名抽出")

    if len(tables) >= 3:
        parse_committees(tables[2], members)

    members.sort(key=lambda m: m["seat_number"])

    payload = json.dumps(members, ensure_ascii=False, indent=2)
    for d in OUT_DIRS:
        out = d / "members.json"
        out.write_text(payload + "\n", encoding="utf-8")
        print(f"  書き込み: {out.relative_to(REPO_ROOT)}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
