"""
砂川市議会 議員名簿スクレイパー
出力: site/data/sunagawa/members.json
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.sunagawa.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/shisei/shigikai/giinitiranreiwa1.html"

ROOT = Path(__file__).parent.parent.parent
OUT_SITE = ROOT / "site" / "data" / "sunagawa"
OUT_DATA = ROOT / "data" / "sunagawa"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "sunagawa"
OUT_SITE.mkdir(parents=True, exist_ok=True)
OUT_DATA.mkdir(parents=True, exist_ok=True)
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> requests.Response:
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return resp


def cell_text(td) -> str:
    return td.get_text("\n", strip=True)


def is_instruction_cell(text: str) -> bool:
    return "ふりがな" in text and "所属委員会" in text


def parse_members(html: str):
    soup = BeautifulSoup(html, "html.parser")
    # 議員一覧ページには主たるテーブルが1つ
    table = soup.find("table", attrs={"summary": re.compile("議員一覧")})
    if table is None:
        table = soup.find("table")
    if table is None:
        raise RuntimeError("議員一覧テーブルが見つかりません")

    rows = table.find_all("tr")

    members = []
    seat_number = 0
    i = 0
    while i < len(rows):
        tr = rows[i]
        tds = tr.find_all("td")
        # 見出し行（議長/副議長、議員）はスキップ
        text = tr.get_text(strip=True)
        if not tds:
            i += 1
            continue
        if text in ("議長副議長", "議員") or text.strip() == "議員":
            i += 1
            continue
        # 画像のある行を「ブロックの先頭」と判定
        imgs = tr.find_all("img")
        if not imgs:
            i += 1
            continue

        # 以降5行が1ブロック
        block = rows[i : i + 5]
        if len(block) < 5:
            break

        # ブロック先頭行: 左右最大2名の [写真, 氏名] × 2
        head_tds = block[0].find_all("td")
        name_tds = [td for td in head_tds if not td.find("img")]
        photo_srcs = [img.get("src", "") for img in block[0].find_all("img")]

        # 後続4行: ふりがな / 会派 / 委員会 / 当選回数
        def row_cells(row):
            return [cell_text(td) for td in row.find_all("td")]

        furigana = row_cells(block[1])
        faction = row_cells(block[2])
        committees = row_cells(block[3])
        # elections = row_cells(block[4])  # 当選回数は保存対象外

        for idx, td in enumerate(name_tds):
            name = cell_text(td)
            if not name or is_instruction_cell(name):
                continue
            if len(name) < 2:
                continue

            seat_number += 1

            fac = faction[idx] if idx < len(faction) else ""
            com_raw = committees[idx] if idx < len(committees) else ""
            com_list = [c.strip() for c in com_raw.split("\n") if c.strip()]

            member = {
                "seat_number": seat_number,
                "name": name,
                "furigana": furigana[idx].replace("\n", "") if idx < len(furigana) else "",
                "party": "",
                "faction": fac.replace("\n", ""),
                "committees": com_list,
                "photo_url": "",
            }

            if idx < len(photo_srcs) and photo_srcs[idx]:
                remote = urljoin(MEMBERS_URL, photo_srcs[idx])
                ext = remote.rsplit(".", 1)[-1].split("?")[0] or "jpg"
                fname = f"seat_{seat_number}.{ext}"
                try:
                    img_resp = requests.get(remote, headers=HEADERS, timeout=15)
                    img_resp.raise_for_status()
                    (PHOTO_DIR / fname).write_bytes(img_resp.content)
                    member["photo_url"] = f"/members/sunagawa/{fname}"
                    print(f"    写真保存: {fname}")
                except Exception as e:
                    print(f"    [WARN] 写真取得失敗 {remote} -> {e}")
                time.sleep(0.3)

            members.append(member)

        i += 5

    return members


def main():
    print("砂川市議会 議員名簿を収集中...")
    resp = fetch(MEMBERS_URL)
    members = parse_members(resp.text)

    if not members:
        print("取得不可: HTMLをパースしたが議員データが空でした")
        return

    payload = {
        "source_url": MEMBERS_URL,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "members": members,
    }

    (OUT_SITE / "members.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT_DATA / "members.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"取得議員数: {len(members)}名")
    for m in members:
        print(f"  [{m['seat_number']}] {m['name']} ({m['furigana']}) / {m['faction']} / {'・'.join(m['committees'])}")


if __name__ == "__main__":
    main()
