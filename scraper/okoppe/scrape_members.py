"""
興部町議会 議員名簿スクレイパー
出力: data/okoppe/members.json

HTML 構造:
- <h2>議長</h2><h3>氏名（ふりがな）</h3> ...
- <h2>副議長</h2><h3>氏名（ふりがな）</h3> ...
- <h2>○○常任委員会</h2>
    <h3>委員長|副委員長|委員</h3>
    <div>ふりがな：... 氏名：... 生年月日：... 当選回数：...</div>
- <h2>議会運営委員会</h2> / <h2>議会広報特別委員会</h2> / <h2>監査委員(議会推薦)</h2>
    役職：氏名 のみのリスト（氏名は既出議員）
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup, Tag

BASE_URL = "https://www.town.okoppe.lg.jp"
MEMBERS_URL = f"{BASE_URL}/cms/section/gikai/nbm3tm0000000m1e.html"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "okoppe"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "okoppe"
SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "okoppe"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 議会内の委員会等セクション（役職付与対象）
COMMITTEE_SECTIONS = {
    "総務社会常任委員会",
    "産業建設常任委員会",
    "議会運営委員会",
    "議会広報特別委員会",
    "監査委員(議会推薦)",
}

# 氏名表記ゆれ（全角半角スペース）を正規化して同一人物判定する
def canonical_name(name: str) -> str:
    return re.sub(r"[ 　]+", "", name).strip()


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def iter_section(start: Tag):
    """h2 の次の兄弟から、次の h2 に当たるまでを順に返す"""
    sib = start.next_sibling
    while sib is not None:
        if isinstance(sib, Tag) and sib.name == "h2":
            return
        yield sib
        sib = sib.next_sibling


def parse_h3_name_furi(text: str) -> tuple[str, str]:
    """「藤渡 昭博（ふじわたり あきひろ）」→ ('藤渡 昭博', 'ふじわたり あきひろ')"""
    m = re.match(r"^\s*(.+?)\s*[（(]\s*(.+?)\s*[）)]\s*$", text)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return text.strip(), ""


def parse_data_block(div: Tag) -> dict:
    """ふりがな/氏名/当選回数が含まれる div を辞書化"""
    result: dict[str, str] = {}
    text = div.get_text("\n", strip=True)
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.split("\n") if ln.strip()]

    i = 0
    while i < len(lines):
        ln = lines[i]
        # 同一行内コロン形式「ふりがな：まえだ よしお」
        for key_jp, key_en in (
            ("ふりがな", "furigana"),
            ("氏名", "name"),
            ("当選回数", "term"),
        ):
            if ln.startswith(f"{key_jp}：") or ln.startswith(f"{key_jp}:"):
                val = re.sub(rf"^{key_jp}[：:]", "", ln).strip()
                if val:
                    result[key_en] = val
                elif i + 1 < len(lines):
                    result[key_en] = lines[i + 1]
                    i += 1
                break
            if ln == f"{key_jp}：" or ln == f"{key_jp}:":
                if i + 1 < len(lines):
                    result[key_en] = lines[i + 1]
                    i += 1
                break
        i += 1
    return result


def parse_role_list(section_nodes: list) -> list[tuple[str, str]]:
    """
    議会運営委員会 等: 「委員長：\n前田 義雄」のような形式から (役職, 氏名) を抽出
    """
    out: list[tuple[str, str]] = []
    text_parts: list[str] = []
    for node in section_nodes:
        if isinstance(node, Tag):
            text_parts.append(node.get_text("\n", strip=True))
    raw = "\n".join(text_parts)
    lines = [ln.strip() for ln in raw.split("\n") if ln.strip() and ln.strip() != "トップに戻る"]

    i = 0
    while i < len(lines):
        ln = lines[i]
        m = re.match(r"^(委員長|副委員長|委員|議員)[：:]\s*(.*)$", ln)
        if m:
            role = m.group(1)
            val = m.group(2).strip()
            if not val and i + 1 < len(lines):
                val = lines[i + 1]
                i += 1
            if val:
                out.append((role, val))
        i += 1
    return out


def scrape() -> list[dict] | None:
    print("興部町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    members: dict[str, dict] = {}  # key: canonical_name

    def upsert(name: str, furigana: str = "", term: str = "", role: str = "", committee: str = ""):
        key = canonical_name(name)
        if not key:
            return
        m = members.setdefault(key, {
            "name": name,
            "furigana": "",
            "term": "",
            "roles": [],
            "committees": [],
        })
        # より長い（スペース入り）氏名を優先
        if len(name) > len(m["name"]):
            m["name"] = name
        if furigana and not m["furigana"]:
            m["furigana"] = furigana
        if term and not m["term"]:
            m["term"] = term
        if role and role not in m["roles"]:
            m["roles"].append(role)
        if committee and committee not in m["committees"]:
            m["committees"].append(committee)

    h2_nodes = soup.find_all("h2")

    for h2 in h2_nodes:
        title = re.sub(r"\s+", "", h2.get_text(strip=True))

        if title in ("議長", "副議長"):
            # 次の h3 に「氏名（ふりがな）」
            for node in iter_section(h2):
                if isinstance(node, Tag) and node.name == "h3":
                    name, furi = parse_h3_name_furi(node.get_text(strip=True))
                    if name:
                        upsert(name, furigana=furi, role=title)
                    break
            continue

        if "常任委員会" in title:
            # h3（役職）→ div（データ） の繰り返し
            current_role = ""
            for node in iter_section(h2):
                if not isinstance(node, Tag):
                    continue
                if node.name == "h3":
                    current_role = node.get_text(strip=True)
                elif node.name == "div":
                    data = parse_data_block(node)
                    if data.get("name"):
                        role_full = f"{title}{current_role}" if current_role else title
                        upsert(
                            data["name"],
                            furigana=data.get("furigana", ""),
                            term=data.get("term", ""),
                            role=role_full,
                            committee=title,
                        )
            continue

        if title in {"議会運営委員会", "議会広報特別委員会", "監査委員(議会推薦)"}:
            pairs = parse_role_list(list(iter_section(h2)))
            for role, name in pairs:
                role_full = f"{title}{role}" if role != "委員" or title == "監査委員(議会推薦)" else f"{title}委員"
                # 監査委員は「委員」のみ表記なので統一
                if title == "監査委員(議会推薦)":
                    role_full = "監査委員"
                upsert(name, role=role_full, committee=title)
            continue

    if not members:
        print("  議員情報が抽出できませんでした")
        return None

    # 掲載順（議長→副議長→各常任委員会順）で seat_number を割り振る
    order = list(members.values())
    def sort_key(m):
        roles = m["roles"]
        if any(r == "議長" for r in roles):
            return (0, 0)
        if any(r == "副議長" for r in roles):
            return (1, 0)
        for r in roles:
            if r.startswith("総務社会常任委員会"):
                if "委員長" in r and "副委員長" not in r:
                    return (2, 0)
                if "副委員長" in r:
                    return (2, 1)
                return (2, 2)
            if r.startswith("産業建設常任委員会"):
                if "委員長" in r and "副委員長" not in r:
                    return (3, 0)
                if "副委員長" in r:
                    return (3, 1)
                return (3, 2)
        return (9, 0)

    order.sort(key=sort_key)

    out: list[dict] = []
    for i, m in enumerate(order, start=1):
        # roles のうち議長・副議長・委員長を主要役職として faction 的ポジションに
        primary_role = ""
        for r in m["roles"]:
            if r in ("議長", "副議長"):
                primary_role = r
                break
        if not primary_role:
            for r in m["roles"]:
                if "委員長" in r:
                    primary_role = r
                    break
        if not primary_role and m["roles"]:
            primary_role = m["roles"][0]

        out.append({
            "seat_number": i,
            "name": m["name"],
            "furigana": m["furigana"],
            "party": "",
            "faction": "",
            "committees": m["committees"],
            "role": primary_role,
            "roles_all": m["roles"],
            "term": m["term"],
            "photo_url": "",
        })

    return out


def save(members: list[dict]):
    out = {
        "municipality": "okoppe",
        "municipality_name": "興部町",
        "source_url": MEMBERS_URL,
        "members": members,
    }
    for target in (OUTPUT_DIR, SITE_OUTPUT_DIR):
        path = target / "members.json"
        path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  書き出し: {path}")


if __name__ == "__main__":
    result = scrape()
    if result:
        save(result)
        print(f"取得議員数: {len(result)}名")
        for m in result:
            print(f"  #{m['seat_number']} {m['name']} ({m['furigana']}) [{m['role']}]")
    else:
        print("取得不可")
