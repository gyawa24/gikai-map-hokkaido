"""
下川町議会 議員名簿スクレイパー
出力: data/shimokawa/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.shimokawa.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/section/2023/05/post-139.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "shimokawa"
SITE_DATA_DIR = ROOT / "site" / "data" / "shimokawa"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "shimokawa"
for d in (OUTPUT_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

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


def normalize_spaces(s: str) -> str:
    # 全角スペース・通常スペースをまとめて1つにしてから除去
    return re.sub(r"[\s\u3000]+", "", s or "")


def parse_name_and_furigana(strong_text: str):
    """'　　桜　木　　　誠　（さくらぎ　まこと）' のような文字列から氏名・ふりがなを抽出"""
    text = strong_text.replace("\xa0", " ")
    m = re.search(r"（([^）]+)）", text)
    furigana = ""
    if m:
        furigana = normalize_spaces(m.group(1))
        text = text[: m.start()]
    name = normalize_spaces(text)
    return name, furigana


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.rsplit(".", 1)[-1].split("?")[0].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/shimokawa/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗: {remote_url} -> {e}")
        return ""


def scrape_members():
    print("下川町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    # 下川町のHTMLは一部タグが閉じ忘れで議員divがネストしてしまうため、
    # ドキュメント順に img → <strong>氏名</strong> → 議席番号/期数/役職 の順で出現する
    # パターンを利用して走査する。
    # まずは <p><strong>氏名（ふりがな）</strong></p> をアンカーに、直前の img と
    # 直後の議席番号・役職 <p> を拾う。
    strongs = soup.find_all("strong")
    # 氏名パターン（ふりがな括弧つき）にマッチするものだけ残す
    name_strongs = [
        s for s in strongs
        if re.search(r"（[ぁ-んー\s\u3000]+）", s.get_text(" ", strip=True))
    ]
    print(f"  氏名 strong ブロック {len(name_strongs)} 件")

    # すべての要素をドキュメント順に並べ、各 strong の位置でスライスして
    # その strong 直前の最後の img と、その strong から次の strong までの間の <p> を取る
    all_nodes = list(soup.descendants)

    def node_index(node) -> int:
        for idx, n in enumerate(all_nodes):
            if n is node:
                return idx
        return -1

    strong_indices = [(s, node_index(s)) for s in name_strongs]
    strong_indices.sort(key=lambda x: x[1])

    members = []
    for i, (strong, idx) in enumerate(strong_indices):
        next_idx = strong_indices[i + 1][1] if i + 1 < len(strong_indices) else len(all_nodes)

        name, furigana = parse_name_and_furigana(strong.get_text(" ", strip=True))
        if not name or "欠番" in name:
            continue

        # 直前で最も近い <img>
        img = None
        for n in reversed(all_nodes[:idx]):
            if getattr(n, "name", None) == "img":
                img = n
                break

        # 直後〜次 strong までの <p> テキストから議席番号・役職を拾う
        seat = None
        roles = []
        for n in all_nodes[idx:next_idx]:
            if getattr(n, "name", None) != "p":
                continue
            t = n.get_text(" ", strip=True).replace("\xa0", " ")
            t_clean = normalize_spaces(t)
            if not t_clean:
                continue
            m_seat = re.search(r"議席番号[:：]\s*(\d+)", t_clean)
            if m_seat and seat is None:
                seat = int(m_seat.group(1))
                continue
            m_role = re.search(r"役職[:：](.+)", t_clean)
            if m_role:
                role_val = m_role.group(1).strip()
                if role_val:
                    roles.append(role_val)
                continue
            # 役職の折り返し行（委員会名が単独で入っているケース）
            if roles and re.search(r"委員|議長|会長", t_clean) and not re.search(r"期数|議席番号|氏名", t_clean):
                roles.append(t_clean)

        if seat is None:
            continue

        # 役職文字列を委員会・faction に分ける: ここでは全て committees に入れる
        # 「議長」「副議長」「議会運営委員長」等を committees として扱う
        committees = []
        for r in roles:
            # 分割要素（・や／や改行）で分けておく
            parts = re.split(r"[・／/、，,]", r)
            for p in parts:
                p = p.strip()
                if p:
                    committees.append(p)

        photo_url = ""
        if img and img.get("src"):
            src = img["src"]
            remote = src if src.startswith("http") else BASE_URL + src
            # 人物アイコン（プレースホルダ）はスキップ
            if "人物" not in remote and "%E4%BA%BA%E7%89%A9" not in remote:
                photo_url = download_photo(remote, seat)
                time.sleep(0.3)

        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": "",
            "committees": committees,
            "photo_url": photo_url,
        })
        print(f"  [{seat}] {name} ({furigana}) 役職: {committees}")

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員情報を抽出できませんでした")
        return

    for target in (OUTPUT_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        target.write_text(
            json.dumps(members, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {target}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
