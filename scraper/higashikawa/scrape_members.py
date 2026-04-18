"""
東川町議会 議員名簿スクレイパー
出力: site/data/higashikawa/members.json

公式サイト: https://higashikawa-town.jp/portal/machi/panel/90
  （https://town.higashikawa.hokkaido.jp/administration/town-assembly/directories.php から301リダイレクト）

HTML構造:
- 議員ブロック: <div class="boxChild"> 内に
    <img src="/storage/files/images/2023giin{seat}%20{roman}.jpg">
    と "役職 氏名 生年月 当選N回 党派 会派名" のテキスト
- 委員会: <table> で「役職 / 議員名」の2列。直前見出しに委員会名
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import unquote

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://higashikawa-town.jp"
MEMBERS_URL = f"{BASE_URL}/portal/machi/panel/90"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "higashikawa"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "higashikawa"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

IMG_SEAT_PATTERN = re.compile(r"2023giin(\d+)")
MEMBER_TEXT_PATTERN = re.compile(
    r"(議長|副議長|議員)\s*"
    r"([^\s　]+(?:[\s　][^\s　]+)?)\s*"
    r".*?当選[\s　]*([一二三四五六七八九十０-９0-9]+)回"
    r".*?党派[\s　]*([^\s　]+)",
    re.DOTALL,
)


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] fetch {url}: {e}")
        return None


def normalize_name(raw: str) -> str:
    # 姓名の間は半角スペース1つに統一し、前後空白を除去
    return re.sub(r"[\s　]+", " ", raw).strip()


def parse_members(soup: BeautifulSoup) -> list[dict]:
    members: list[dict] = []
    imgs = soup.find_all("img", src=IMG_SEAT_PATTERN)
    for img in imgs:
        src = img.get("src", "")
        m_seat = IMG_SEAT_PATTERN.search(src)
        if not m_seat:
            continue
        seat_number = int(m_seat.group(1))

        # 議員ブロックを取得（画像と氏名・党派等が同じ boxChild 内にまとまっている）
        container = img
        block = None
        for _ in range(8):
            container = container.parent
            if container is None:
                break
            txt = container.get_text(" ", strip=True)
            if "当選" in txt and "党派" in txt and len(txt) < 400:
                block = container
                break
        if block is None:
            print(f"  [WARN] seat {seat_number}: 情報ブロックを特定できず")
            continue

        block_text = block.get_text(" ", strip=True)
        m = MEMBER_TEXT_PATTERN.search(block_text)
        if not m:
            print(f"  [WARN] seat {seat_number}: テキストパース失敗 -> {block_text}")
            continue
        name_raw = m.group(2)
        party = m.group(4).strip()
        name = normalize_name(name_raw)

        # 写真ダウンロード
        photo_url = ""
        remote_src = src if src.startswith("http") else BASE_URL + src
        remote_url = unquote(remote_src)
        ext = Path(remote_url.split("?")[0]).suffix.lstrip(".").lower() or "jpg"
        fname = f"seat_{seat_number}.{ext}"
        try:
            img_resp = requests.get(remote_src, headers=HEADERS, timeout=15)
            img_resp.raise_for_status()
            (PHOTO_DIR / fname).write_bytes(img_resp.content)
            photo_url = f"/members/higashikawa/{fname}"
        except Exception as e:
            print(f"  [WARN] seat {seat_number} 写真取得失敗: {e}")

        members.append(
            {
                "seat_number": seat_number,
                "name": name,
                "furigana": "",
                "party": party,
                "faction": "",
                "committees": [],
                "photo_url": photo_url,
            }
        )
        time.sleep(0.3)

    members.sort(key=lambda x: x["seat_number"])
    return members


def parse_committees(soup: BeautifulSoup) -> list[tuple[str, dict[str, str]]]:
    """委員会ごとに {氏名正規化: 役職} を返す。役職は '委員長' '副委員長' '委員'。"""
    result = []
    for table in soup.find_all("table"):
        el = table
        committee_name: str | None = None
        for _ in range(20):
            el = el.find_previous()
            if el is None:
                break
            txt = el.get_text(strip=True) if hasattr(el, "get_text") else ""
            if txt and "委員会" in txt and len(txt) < 40:
                committee_name = txt
                break
        if not committee_name:
            continue

        role_by_name: dict[str, str] = {}
        for tr in table.find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
            if len(cells) != 2:
                continue
            role, people = cells[0], cells[1]
            if role == "役職":
                continue
            # 1セルに複数氏名が入るケース: 姓名の間は全角空白、氏名の区切りは半角空白/改行/タブ
            # したがって全角空白は分割に使わず、ASCII系空白のみで分割する
            for person in re.split(r"[ \t\r\n]+", people):
                if not person:
                    continue
                name = normalize_name(person)
                if name and len(name) >= 2:
                    role_by_name[name] = role
        if role_by_name:
            result.append((committee_name, role_by_name))
    return result


def attach_committees(members: list[dict], committees: list[tuple[str, dict[str, str]]]) -> None:
    for m in members:
        name = m["name"]
        name_compact = name.replace(" ", "")
        belongs: list[str] = []
        for committee_name, role_by_name in committees:
            role = role_by_name.get(name)
            if role is None:
                # 姓名の間の空白数が違うケースを救済（例: "今　　　綾" vs "今 綾"）
                for n2, r2 in role_by_name.items():
                    if n2.replace(" ", "") == name_compact:
                        role = r2
                        break
            if role is None:
                continue
            label = committee_name
            if role == "委員長":
                label = f"{committee_name}委員長"
            elif role == "副委員長":
                label = f"{committee_name}副委員長"
            belongs.append(label)
        m["committees"] = belongs


def main() -> None:
    print("東川町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return
    members = parse_members(soup)
    if not members:
        print("  議員情報を抽出できませんでした（members.json は作成しません）")
        return
    committees = parse_committees(soup)
    attach_committees(members, committees)

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"  取得議員数: {len(members)} 名")
    print(f"  出力: {out_path}")


if __name__ == "__main__":
    main()
