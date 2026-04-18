"""
美幌町議会 議員名簿スクレイパー
出力: data/bihoro/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.bihoro.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/site/gikai/1098.html"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "bihoro"
SITE_DATA_DIR = ROOT / "site" / "data" / "bihoro"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "bihoro"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch_html(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def parse_name_line(text: str) -> tuple[str, str]:
    """『木村　利昭（きむら　としあき）　38歳　2回』-> (name, furigana)"""
    text = text.replace("\u3000", " ").strip()
    m = re.match(r"^([^\(（]+)[（\(]([^）\)]+)[）\)]", text)
    if not m:
        return text.split()[0] if text else "", ""
    name = re.sub(r"\s+", " ", m.group(1)).strip()
    furigana = re.sub(r"\s+", " ", m.group(2)).strip()
    return name, furigana


def parse_committees(text: str) -> tuple[list[str], list[str]]:
    """委員会テキストから (委員会名リスト, 役職リスト) を返す。
    例: '副議長、総務福祉、議会運営' -> (['総務福祉','議会運営'], ['副議長'])
    例: '〇総務福祉' -> (['総務福祉'], []) ※○は副委員長、◎は委員長
    """
    text = text.replace("\u3000", " ").strip()
    parts = re.split(r"[、,\s]+", text)
    committees: list[str] = []
    roles: list[str] = []
    role_keywords = {"議長", "副議長"}
    for raw in parts:
        p = raw.strip()
        if not p:
            continue
        if p in role_keywords:
            roles.append(p)
            continue
        # 先頭の◎○記号を取り除く（委員長/副委員長マーカー）
        cleaned = re.sub(r"^[◎○〇●]\s*", "", p)
        if cleaned:
            committees.append(cleaned)
    return committees, roles


def scrape_members():
    print("美幌町議会 議員名簿を収集中...")
    soup = fetch_html(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    members = []
    h2s = soup.find_all("h2")
    seat_h2s = [h for h in h2s if "議席番号" in h.get_text()]
    print(f"  議席ブロック {len(seat_h2s)} 件発見")

    for h in seat_h2s:
        title = h.get_text(strip=True).replace("\u3000", " ")
        m = re.search(r"議席番号\s*(\d+)", title)
        if not m:
            continue
        seat_number = int(m.group(1))

        # 後続の p（写真）と ol（情報）を集める
        photo_src = None
        info_items: list[str] = []
        sib = h
        for _ in range(8):
            sib = sib.find_next_sibling()
            if sib is None or (sib.name == "h2"):
                break
            if sib.name == "p":
                img = sib.find("img")
                if img and img.get("src"):
                    photo_src = img["src"]
            elif sib.name == "ol":
                for li in sib.find_all("li"):
                    info_items.append(li.get_text(" ", strip=True))

        if not info_items:
            print(f"  [seat {seat_number}] 情報なし — スキップ")
            continue

        name_line = info_items[0] if len(info_items) > 0 else ""
        committee_line = info_items[1] if len(info_items) > 1 else ""
        party_line = info_items[2] if len(info_items) > 2 else ""

        name, furigana = parse_name_line(name_line)
        committees, roles = parse_committees(committee_line)
        party = party_line.strip()

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "、".join(roles) if roles else "",
            "committees": committees,
            "photo_url": "",
        }

        # 写真ダウンロード
        if photo_src:
            remote_url = photo_src if photo_src.startswith("http") else BASE_URL + photo_src
            ext = remote_url.rsplit(".", 1)[-1].split("?")[0].lower() or "jpg"
            if ext not in ("jpg", "jpeg", "png", "gif"):
                ext = "jpg"
            fname = f"seat_{seat_number}.{ext}"
            try:
                ir = requests.get(remote_url, headers=HEADERS, timeout=15)
                ir.raise_for_status()
                (PHOTO_DIR / fname).write_bytes(ir.content)
                member["photo_url"] = f"/members/bihoro/{fname}"
                time.sleep(0.3)
            except Exception as e:
                print(f"  [seat {seat_number}] 写真取得失敗: {e}")

        print(
            f"  [seat {seat_number}] {name} ({furigana}) "
            f"会派={member['faction']} 党派={party} 委員会={committees}"
        )
        members.append(member)

    if not members:
        print("  議員データ取得失敗 — JSON出力スキップ")
        return

    members.sort(key=lambda x: x["seat_number"])
    out_payload = members

    for d in (DATA_DIR, SITE_DATA_DIR):
        out_path = d / "members.json"
        out_path.write_text(
            json.dumps(out_payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  書込: {out_path}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    scrape_members()
