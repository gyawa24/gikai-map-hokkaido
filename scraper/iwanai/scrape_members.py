"""
岩内町議会 議員名簿スクレイパー
出力: data/iwanai/members.json, site/data/iwanai/members.json
公式ページからHTMLを取得し、テーブル構造を動的に解析する。
ハードコーディング禁止。
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.iwanai.hokkaido.jp"
MEMBERS_URL = (
    "https://www.town.iwanai.hokkaido.jp/"
    "%e7%94%ba%e6%94%bf%e6%83%85%e5%a0%b1/"
    "%e5%b2%a9%e5%86%85%e7%94%ba%e8%ad%b0%e4%bc%9a/"
    "%e8%ad%b0%e5%93%a1%e5%90%8d%e7%b0%bf/"
)

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "iwanai"
SITE_DATA_DIR = ROOT / "site" / "data" / "iwanai"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "iwanai"
for p in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    p.mkdir(parents=True, exist_ok=True)

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


def parse_committees(text: str) -> tuple[list[str], list[str]]:
    """委員会欄のテキストから委員会名・役職を抽出。
    例: "副議長、社会文教" / "社会文教（委員長）、議会運営"
    """
    if not text:
        return [], []
    parts = re.split(r"[、,・／/\n]+", text)
    committees: list[str] = []
    roles: list[str] = []
    kana_kanji_re = re.compile(r"[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]")
    for raw in parts:
        p = raw.strip()
        if not p:
            continue
        # 議長・副議長は単体の役職として登場することがある
        if p in ("議長", "副議長"):
            roles.append(p)
            continue
        # "委員会名（委員長）" のような形式を分解
        m = re.match(r"^(.+?)[（(](.+?)[）)]\s*$", p)
        if m:
            name = m.group(1).strip()
            role = m.group(2).strip()
            if name and kana_kanji_re.search(name):
                committees.append(name)
            if name and role and kana_kanji_re.search(name):
                roles.append(f"{name}{role}")
        else:
            # パース欠損片（例: "長）"）を捨てる:
            # - 日本語文字を含まない
            # - 閉じ括弧のみ存在して開き括弧と対応しない
            has_open = bool(re.search(r"[（(]", p))
            has_close = bool(re.search(r"[）)]", p))
            if not kana_kanji_re.search(p):
                continue
            if has_close and not has_open:
                continue
            committees.append(p)
    return committees, roles


def clean_name(text: str) -> str:
    # 全角スペースを半角に寄せ、前後の空白と役職注記を落とす
    t = text.replace("\u3000", " ").strip()
    # 末尾に「（議長）」などが付くケースへの保険
    t = re.sub(r"[（(].*?[）)]\s*$", "", t).strip()
    return t


HIRAGANA_RE = re.compile(r"^[\u3040-\u309fー\s]+$")
KANJI_RE = re.compile(r"[\u4e00-\u9fff]")
ROMAJI_PAREN_RE = re.compile(r"^[（(][A-Za-z\s]+[）)]$")


def parse_name_cell(cell) -> tuple[str, str]:
    """名前セルから (漢字氏名, ふりがな) を抽出。
    形式: <p label-id="名前">ふりがな<br>漢字名<br>(Romaji)</p>
    画像altがあればそれを漢字氏名の優先情報として使用。
    """
    # <br> を区切りにテキストを取得
    for br in cell.find_all("br"):
        br.replace_with("\n")
    raw = cell.get_text("\n", strip=True)
    lines = [l.strip() for l in raw.split("\n") if l.strip()]

    furigana = ""
    name = ""
    for line in lines:
        if ROMAJI_PAREN_RE.match(line):
            continue
        if HIRAGANA_RE.match(line) and not furigana:
            furigana = line.replace("\u3000", " ").strip()
        elif KANJI_RE.search(line) and not name:
            name = clean_name(line)

    return name, furigana


def parse_table(soup: BeautifulSoup) -> list[dict]:
    members: list[dict] = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue

        # ヘッダ解析
        header_cells = rows[0].find_all(["th", "td"])
        headers_text = [c.get_text(strip=True) for c in header_cells]
        if not headers_text:
            continue

        # 議席・氏名列の判定
        def find_idx(keywords: list[str]) -> int:
            for i, h in enumerate(headers_text):
                for k in keywords:
                    if k in h:
                        return i
            return -1

        seat_idx = find_idx(["議席"])
        name_idx = find_idx(["氏名", "議員名", "名前"])
        furigana_idx = find_idx(["ふりがな", "フリガナ", "よみ"])
        faction_idx = find_idx(["会派", "所属"])
        committee_idx = find_idx(["委員会", "役職", "所属委員"])

        if name_idx < 0 or seat_idx < 0:
            continue

        for tr in rows[1:]:
            cells = tr.find_all(["td", "th"])
            if len(cells) <= max(seat_idx, name_idx):
                continue
            seat_raw = cells[seat_idx].get_text(strip=True)
            name_cell = cells[name_idx]
            name_text, cell_furigana = parse_name_cell(name_cell)

            # 画像 alt 属性から漢字氏名の裏取り
            alt_name = ""
            img_tag = tr.find("img", alt=True)
            if img_tag:
                alt_name = clean_name(img_tag["alt"])
            if alt_name and (not name_text or len(alt_name) <= len(name_text)):
                name_text = alt_name

            if not name_text or name_text in ("氏名", "議員名"):
                continue

            try:
                seat_number = int(re.sub(r"\D", "", seat_raw) or "0")
            except ValueError:
                seat_number = 0
            if seat_number == 0:
                continue

            furigana = ""
            if furigana_idx >= 0 and len(cells) > furigana_idx:
                furigana = cells[furigana_idx].get_text(" ", strip=True)
            if not furigana:
                furigana = cell_furigana
            furigana = furigana.replace("\u3000", " ").strip()

            faction = ""
            if faction_idx >= 0 and len(cells) > faction_idx:
                faction = cells[faction_idx].get_text(strip=True)

            committees: list[str] = []
            roles: list[str] = []
            if committee_idx >= 0 and len(cells) > committee_idx:
                committees, roles = parse_committees(
                    cells[committee_idx].get_text("\n", strip=True)
                )

            # 画像URL（行内に <img> があれば採用）
            photo_url_remote = ""
            img = tr.find("img")
            if img and img.get("src"):
                photo_url_remote = urljoin(BASE_URL, img["src"])

            members.append({
                "seat_number": seat_number,
                "name": name_text,
                "furigana": furigana,
                "party": "",
                "faction": faction,
                "committees": committees,
                "roles": roles,
                "_photo_remote": photo_url_remote,
            })

        if members:
            break  # 最初に見つかった議員テーブルを採用

    return members


def download_photos(members: list[dict]) -> None:
    for m in members:
        remote = m.pop("_photo_remote", "")
        if not remote:
            m["photo_url"] = ""
            continue
        seat = m["seat_number"]
        ext = remote.split("?")[0].split(".")[-1].lower() or "jpg"
        if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
            ext = "jpg"
        fname = f"seat_{seat}.{ext}"
        try:
            r = requests.get(remote, headers=HEADERS, timeout=15)
            r.raise_for_status()
            (PHOTO_DIR / fname).write_bytes(r.content)
            m["photo_url"] = f"/members/iwanai/{fname}"
            print(f"  [photo] seat {seat}: {remote} -> {fname}")
        except Exception as e:
            print(f"  [photo ERROR] seat {seat}: {e}")
            m["photo_url"] = ""
        time.sleep(0.3)


def main() -> int:
    print(f"岩内町議会 議員名簿を収集中...\n  {MEMBERS_URL}")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("取得不可: ページ取得失敗")
        return 1

    members = parse_table(soup)
    if not members:
        print("取得不可: テーブル構造から議員データを抽出できませんでした")
        return 2

    print(f"  抽出議員数: {len(members)} 名")
    download_photos(members)

    members.sort(key=lambda m: m["seat_number"])

    for out_dir in (DATA_DIR, SITE_DATA_DIR):
        (out_dir / "members.json").write_text(
            json.dumps(members, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き込み: {out_dir / 'members.json'}")

    print(f"完了: 取得議員数 {len(members)} 名")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
