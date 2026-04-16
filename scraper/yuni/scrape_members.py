"""
由仁町議会 議員名簿スクレイパー
出力: data/yuni/members.json, site/data/yuni/members.json

由仁町公式サイトの「議会議員名簿」ページ
(https://www.town.yuni.lg.jp/chosei/gikai/giin-meibo)
は議員名簿が JPG 画像のみで掲載されており、HTML から議員名を取り出せない。
そのため「委員会構成」ページの HTML テーブルを動的にパースして
議員名と委員会・役職情報を抽出する。

再実行すれば常に最新データが取れるよう、構造化データのハードコードはしない。
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.yuni.lg.jp"
COMMITTEES_URL = f"{BASE_URL}/chosei/gikai/iinkai-kosei"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "yuni"
RAW_OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "yuni"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
RAW_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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


def normalize_name(s: str) -> str:
    """全角スペース・連続空白を半角スペース1個に正規化、前後空白除去。"""
    s = s.replace("\u3000", " ").replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def is_personal_name(s: str) -> bool:
    """日本人氏名らしき形式かチェック（記号・短い語・長すぎる文字列を除外）。"""
    if not s:
        return False
    bare = re.sub(r"\s", "", s)
    if len(bare) < 2 or len(bare) > 8:
        return False
    return bool(re.fullmatch(r"[一-龥々ヶぁ-んァ-ヴー]+", bare))


def split_names(cell_text: str) -> list[str]:
    """テーブルセル内のカンマ・読点区切りを分解して氏名リストを返す。"""
    parts = re.split(r"[、,，]", cell_text)
    return [normalize_name(p) for p in parts if normalize_name(p)]


def extract_committee_name(heading_text: str) -> str:
    """見出しテキストから委員会名を取り出す。

    【...】 がある場合はその中身を採用、無ければ全文から
    （...）の任期情報や「任期N年」表記を取り除いて返す。
    """
    text = heading_text
    # 括弧内の任期情報を除去
    text = re.sub(r"[（(].*?[）)]", "", text)
    # 「任期2年」「任期4年」等の補足表記を除去
    text = re.sub(r"任期\s*\d+\s*年", "", text)
    # 【...】 で囲まれていれば中身を優先採用
    m = re.search(r"[\[【](.+?)[\]】]", text)
    if m:
        text = m.group(1)
    text = re.sub(r"\s+", "", text)
    return text.strip()


# 委員会名にならない見出し（カテゴリ見出し）を除外する
SECTION_HEADINGS = {"常任委員会", "そのほかの委員会等", "そのほかの委員会", "委員会"}


def scrape_members():
    print("由仁町議会 議員名簿を委員会構成ページから収集中...")
    print(f"  URL: {COMMITTEES_URL}")
    soup = fetch(COMMITTEES_URL)
    if soup is None:
        print("  取得不可: ページ取得失敗")
        return False

    # 出現順を保つため dict (Python 3.7+ で挿入順保持)
    members: dict[str, dict] = {}

    current_committee = None
    seen_tables: set[int] = set()
    # ページ本文内の見出しと表を順に走査する
    for el in soup.find_all(["h2", "h3", "h4", "figure", "table"]):
        if el.name in ("h2", "h3", "h4"):
            committee = extract_committee_name(el.get_text())
            if committee and committee not in SECTION_HEADINGS:
                current_committee = committee
            continue

        table = el if el.name == "table" else el.find("table")
        if not table or not current_committee:
            continue
        # figure と table の二重走査による重複を防ぐ
        if id(table) in seen_tables:
            continue
        seen_tables.add(id(table))

        for row in table.find_all("tr"):
            th = row.find("th")
            td = row.find("td")
            if not th or not td:
                continue
            role_raw = normalize_name(th.get_text())
            role = re.sub(r"[●○・\s]", "", role_raw)
            for name in split_names(td.get_text()):
                if not is_personal_name(name):
                    continue
                rec = members.setdefault(name, {
                    "committees": [],
                    "roles": [],
                })
                if current_committee not in rec["committees"]:
                    rec["committees"].append(current_committee)
                if role and role not in ("委員", "幹事"):
                    rec["roles"].append(f"{current_committee}{role}")

    if not members:
        print("  取得不可: 議員データを抽出できませんでした")
        return False

    print(f"  抽出した議員: {len(members)} 名")

    # 出現順 = 総務産業常任委員会の掲載順（委員長・副委員長・委員）。
    # 議席番号は公式サイトに掲載が無いため、出現順を仮の seat_number とする。
    member_list = []
    for i, (name, rec) in enumerate(members.items(), start=1):
        member_list.append({
            "seat_number": i,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": rec["committees"],
        })
        roles = "・".join(rec["roles"]) if rec["roles"] else "委員"
        print(f"    [{i}] {name}  ({roles})")

    payload = json.dumps(member_list, ensure_ascii=False, indent=2)
    (OUTPUT_DIR / "members.json").write_text(payload, encoding="utf-8")
    (RAW_OUTPUT_DIR / "members.json").write_text(payload, encoding="utf-8")
    print(f"  -> {OUTPUT_DIR / 'members.json'}")
    print(f"  -> {RAW_OUTPUT_DIR / 'members.json'}")
    return True


if __name__ == "__main__":
    scrape_members()
