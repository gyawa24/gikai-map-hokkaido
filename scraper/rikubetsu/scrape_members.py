"""
陸別町議会 議員名簿スクレイパー
出力: data/rikubetsu/members.json および site/data/rikubetsu/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.rikubetsu.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/giin_syoukai/"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIRS = [
    REPO_ROOT / "data" / "rikubetsu",
    REPO_ROOT / "site" / "data" / "rikubetsu",
]
for d in OUTPUT_DIRS:
    d.mkdir(parents=True, exist_ok=True)

PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "rikubetsu"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def fetch_bytes(url: str) -> bytes | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize_committees(text: str) -> list[str]:
    """委員会セルから委員会名のリストを取り出す。議長/副議長表記は除外。"""
    if not text:
        return []
    # 全角・半角の各種区切りで分割
    parts = re.split(r"[、,，/／・\s]+", text)
    out: list[str] = []
    for p in parts:
        p = p.strip().strip("（）()")
        if not p:
            continue
        # 「議長」「副議長」は役職であり委員会ではないので除外
        if p in ("議長", "副議長"):
            continue
        # よくある略称を正規化
        if p == "議運":
            p = "議会運営委員会"
        elif p == "総務":
            p = "総務常任委員会"
        elif p == "産業":
            p = "産業常任委員会"
        else:
            # 末尾に「委員会」が無ければ補わない（不確かなため原文のまま）
            pass
        if p not in out:
            out.append(p)
    return out


def parse_int(s: str) -> int | None:
    if not s:
        return None
    # 全角数字を半角に変換
    normalized = s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    m = re.search(r"\d+", normalized)
    return int(m.group()) if m else None


def normalize_text(s: str) -> str:
    """全角スペースを除去して半角スペースに正規化。"""
    if not s:
        return ""
    return re.sub(r"\s+", "", s.replace("\u3000", ""))


def extract_role(text: str) -> str:
    if not text:
        return ""
    if "副議長" in text:
        return "副議長"
    if "議長" in text:
        return "議長"
    return ""


def scrape_members():
    print("陸別町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    # 議員一覧テーブルを探す（議席・氏名・委員会・党派・当選回数 等のヘッダ）
    target_table = None
    for table in soup.find_all("table"):
        header_text = table.get_text(" ", strip=True)
        if ("議席" in header_text or "氏名" in header_text) and (
            "党派" in header_text or "会派" in header_text or "委員会" in header_text
        ):
            target_table = table
            break

    if target_table is None:
        print("  議員一覧テーブルが見つかりません")
        return None

    # ヘッダ列を解析してインデックスを決める
    rows = target_table.find_all("tr")
    if not rows:
        print("  テーブル行がありません")
        return None

    header_cells_raw = [c.get_text(" ", strip=True) for c in rows[0].find_all(["th", "td"])]
    header_cells = [normalize_text(h) for h in header_cells_raw]
    print(f"  ヘッダ: {header_cells_raw}")

    def col_idx(*keywords: str) -> int | None:
        for i, h in enumerate(header_cells):
            for kw in keywords:
                if kw in h:
                    return i
        return None

    idx_seat = col_idx("議席")
    idx_name = col_idx("氏名", "名前")
    idx_committee = col_idx("委員会", "所属")
    idx_party = col_idx("党派", "会派")
    idx_terms = col_idx("当選")
    idx_role = col_idx("役職")

    members: list[dict] = []
    for row in rows[1:]:
        cells = row.find_all(["td", "th"])
        if not cells:
            continue
        texts = [c.get_text(" ", strip=True) for c in cells]
        # 空行スキップ
        if all(not t for t in texts):
            continue

        seat = parse_int(texts[idx_seat]) if idx_seat is not None and idx_seat < len(texts) else None
        name_raw = texts[idx_name] if idx_name is not None and idx_name < len(texts) else ""
        committee_raw = texts[idx_committee] if idx_committee is not None and idx_committee < len(texts) else ""
        party = texts[idx_party] if idx_party is not None and idx_party < len(texts) else ""
        terms = parse_int(texts[idx_terms]) if idx_terms is not None and idx_terms < len(texts) else None
        role_text = texts[idx_role] if idx_role is not None and idx_role < len(texts) else ""

        # 氏名セルから役職注記を分離（例: "久保広幸（議長）"）
        role = extract_role(name_raw) or extract_role(committee_raw) or extract_role(role_text)
        name = re.sub(r"[（(](議長|副議長)[）)]", "", name_raw).strip()
        # 全角スペースを半角スペースに正規化（姓名間のスペース）
        name = re.sub(r"[\u3000\s]+", " ", name).strip()
        # 委員会セルからも役職表記を取り除く
        committee_clean = re.sub(r"[（(](議長|副議長)[）)]", "", committee_raw).strip()

        if not name:
            continue
        # 「氏名」ヘッダ行や「欠番」をスキップ
        compact = normalize_text(name)
        if compact in ("氏名", "名前", "欠番", "欠席"):
            continue

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": party.strip(),
            "faction": "",
            "committees": normalize_committees(committee_clean),
            "terms": terms,
            "role": role,
            "photo_url": "",
            "source_url": MEMBERS_URL,
        }

        # 写真の取得（行内に img があれば）
        img = row.find("img")
        if img and img.get("src") and seat is not None:
            src = img["src"]
            remote_url = src if src.startswith("http") else BASE_URL + src
            ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
            if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
                ext = "jpg"
            fname = f"seat_{seat}.{ext}"
            data = fetch_bytes(remote_url)
            if data:
                (PHOTO_DIR / fname).write_bytes(data)
                member["photo_url"] = f"/members/rikubetsu/{fname}"
                time.sleep(0.3)

        members.append(member)
        print(
            f"  [{seat}] {name}  party={member['party']}  "
            f"committees={member['committees']}  role={role}  terms={terms}"
        )

    if not members:
        print("  議員データを抽出できませんでした")
        return None

    # 議席番号でソート（None は末尾）
    members.sort(key=lambda m: (m["seat_number"] is None, m["seat_number"] or 0))

    payload = {
        "municipality": "rikubetsu",
        "source_url": MEMBERS_URL,
        "count": len(members),
        "members": members,
    }

    for d in OUTPUT_DIRS:
        out_path = d / "members.json"
        out_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {out_path}")

    return members


if __name__ == "__main__":
    result = scrape_members()
    if result:
        print(f"取得議員数: {len(result)}名")
    else:
        print("取得不可")
