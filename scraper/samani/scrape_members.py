"""
様似町議会 議員名簿スクレイパー
出力: site/data/samani/members.json

公式サイト: http://www.samani.jp/profile/index7.html
HTMLに議員一覧と委員会構成が全てテキストで掲載されているため、
requests + BeautifulSoup でパースする。
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "http://www.samani.jp"
MEMBERS_URL = f"{BASE_URL}/profile/index7.html"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "samani"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "samani"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

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
    """氏名の全角・半角スペースを全て除去して比較キーを作る。"""
    return re.sub(r"[\s\u3000]+", "", s)


def clean_cell(s: str) -> str:
    """セル内の前後空白を削除し、氏名内の区切り空白は保持して正規化。"""
    return re.sub(r"\s+", " ", s).strip()


def parse_members_table(soup: BeautifulSoup) -> list[dict]:
    """議席番号順の議員テーブル（党派付き）をパースする。"""
    members = []
    for table in soup.find_all("table", class_="table5"):
        rows = table.find_all("tr")
        if not rows:
            continue
        header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
        # 議員一覧テーブルのヘッダーは「議席・氏名・ふりがな・年齢・住所・当選回数・党派」
        if "議席" not in header_cells or "氏名" not in header_cells or "党派" not in header_cells:
            continue

        idx = {label: i for i, label in enumerate(header_cells)}

        for tr in rows[1:]:
            cells = tr.find_all(["td", "th"])
            if len(cells) < len(header_cells):
                continue
            seat_raw = clean_cell(cells[idx["議席"]].get_text(" ", strip=True))
            try:
                seat = int(re.sub(r"\D", "", seat_raw))
            except ValueError:
                continue
            name = clean_cell(cells[idx["氏名"]].get_text(" ", strip=True))
            furigana = clean_cell(cells[idx["ふりがな"]].get_text(" ", strip=True))
            party = clean_cell(cells[idx["党派"]].get_text(" ", strip=True))
            if not name:
                continue
            members.append({
                "seat_number": seat,
                "name": name,
                "furigana": furigana,
                "party": party,
                "faction": "",
                "committees": [],
            })
        return members
    return members


def parse_committees(soup: BeautifulSoup) -> dict[str, list[tuple[str, str]]]:
    """
    委員会構成セクションから {議員名(空白除去): [(委員会名, 役職), ...]} を作る。

    HTML構造:
      <h4>委員会名：定数X人 現議員数Y人</h4>
      <table>
        <tr>人数/委員長/副委員長/委員</tr>
        <tr><td>N人</td><td>Aさん</td><td>Bさん</td><td>C、D、E</td></tr>
      </table>
    """
    result: dict[str, list[tuple[str, str]]] = {}

    for h4 in soup.find_all("h4"):
        heading = h4.get_text(" ", strip=True)
        # 「委員会」を含む見出しのみ対象
        if "委員会" not in heading:
            continue
        # 見出し末尾の「：定数〜」以降を落として委員会名を取り出す
        committee_name = re.split(r"[：:]", heading)[0].strip()

        # 次に現れる table を取得
        table = h4.find_next("table")
        if table is None:
            continue

        rows = table.find_all("tr")
        if len(rows) < 2:
            continue
        header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
        if "委員長" not in header_cells or "委員" not in header_cells:
            continue

        data_cells = rows[1].find_all(["td", "th"])
        if len(data_cells) < len(header_cells):
            continue
        col = {label: i for i, label in enumerate(header_cells)}

        chair = clean_cell(data_cells[col["委員長"]].get_text(" ", strip=True))
        vice = clean_cell(data_cells[col["副委員長"]].get_text(" ", strip=True)) if "副委員長" in col else ""
        # 「委員」セルは「、」や改行で区切られた複数名
        members_cell = data_cells[col["委員"]]
        for br in members_cell.find_all("br"):
            br.replace_with("\n")
        members_text = members_cell.get_text("\n", strip=True)
        # 「、」または改行で分割
        raw_members = re.split(r"[、,\n]+", members_text)
        ordinary_members = [clean_cell(m) for m in raw_members if clean_cell(m)]

        def add(person: str, role: str):
            key = normalize_name(person)
            if not key:
                return
            result.setdefault(key, []).append((committee_name, role))

        if chair:
            add(chair, "委員長")
        if vice:
            add(vice, "副委員長")
        for m in ordinary_members:
            add(m, "委員")

    return result


def parse_leadership(soup: BeautifulSoup) -> dict[str, str]:
    """議長・副議長・議選監査委員を抽出して {議員名(空白除去): 役職} を返す。"""
    roles: dict[str, str] = {}

    # 議長・副議長は冒頭テーブルから（ラベルに全角スペースが混入することがあるため正規化して比較）
    for table in soup.find_all("table", class_="table4"):
        for tr in table.find_all("tr"):
            th = tr.find("th")
            td = tr.find("td")
            if not th or not td:
                continue
            label_norm = normalize_name(th.get_text(" ", strip=True))
            value = clean_cell(td.get_text(" ", strip=True))
            if label_norm == "議長":
                roles[normalize_name(value)] = "議長"
            elif label_norm == "副議長":
                roles[normalize_name(value)] = "副議長"

    # 議選監査委員は h3 見出しの次の p
    for h3 in soup.find_all("h3"):
        if "議選監査委員" in h3.get_text(strip=True):
            p = h3.find_next("p")
            if p:
                name = clean_cell(p.get_text(" ", strip=True))
                if name:
                    roles[normalize_name(name)] = "議選監査委員"
            break

    return roles


def scrape_members() -> bool:
    print("様似町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return False

    members = parse_members_table(soup)
    if not members:
        print("  議員テーブルが見つかりません")
        return False

    print(f"  議員 {len(members)} 名発見")

    committees_by_name = parse_committees(soup)
    leadership_by_name = parse_leadership(soup)

    for m in members:
        key = normalize_name(m["name"])
        assignments = committees_by_name.get(key, [])
        committee_strs = []
        for name, role in assignments:
            if role == "委員":
                committee_strs.append(name)
            else:
                committee_strs.append(f"{name}（{role}）")
        m["committees"] = committee_strs

        lead = leadership_by_name.get(key)
        if lead:
            # 議長・副議長・議選監査委員は faction ではなく committees に追記
            m["committees"].insert(0, lead)

    members.sort(key=lambda x: x["seat_number"])

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    for m in members:
        print(f"  [議席{m['seat_number']}] {m['name']} ({m['furigana']}) / {m['party']} / {', '.join(m['committees']) or '委員会なし'}")

    print(f"\n取得議員数: {len(members)}名")
    print(f"出力: {output_path}")
    return True


if __name__ == "__main__":
    ok = scrape_members()
    exit(0 if ok else 1)
