"""
新篠津村議会 議員名簿スクレイパー
出力: data/shinshinotsu/members.json, site/data/shinshinotsu/members.json

新篠津村公式サイトの議員名簿ページ（/hotnews/detail/00003255.html）は
画像（JPG）でしか名簿を提供していないため、議員氏名と委員会構成が
HTMLテキストで掲載されている「村議会の概要」ページから抽出する。
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup, NavigableString

BASE_URL = "https://www.vill.shinshinotsu.hokkaido.jp"
OVERVIEW_URL = f"{BASE_URL}/hotnews/detail/00003253.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIRS = [
    REPO_ROOT / "data" / "shinshinotsu",
    REPO_ROOT / "site" / "data" / "shinshinotsu",
]
for d in OUTPUT_DIRS:
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 委員会名 → 出力時のラベル。村議会本体の常任・特別委員会のみ拾う。
# 「一部事務組合等選出議員」配下の組合議員は別組織なので含めない。
COMMITTEE_HEADINGS = {
    "行政常任委員会": "行政常任委員会",
    "議会運営委員会": "議会運営委員会",
    "議会広報特別委員会": "議会広報特別委員会",
}
CHAIR_HEADING = "正副議長"


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize(s: str) -> str:
    return re.sub(r"[\s\u3000]+", "", s)


def parse_role_line(line: str) -> tuple[str, str] | None:
    """'委 員 長 大 塚 裕 樹' のような行から (役職, 名前) を返す。"""
    compact = normalize(line)
    if not compact:
        return None
    for label in ("議長", "副議長", "委員長", "副委員長", "委員"):
        if compact.startswith(label):
            name = compact[len(label):]
            if 2 <= len(name) <= 8:
                return label, name
    return None


def walk_sections(main: BeautifulSoup) -> dict[str, list[str]]:
    """main 配下を順に走査し、見出し → そこから次の見出しまでの行リスト の dict を作る。"""
    # <br> を改行文字に変換
    for br in main.find_all("br"):
        br.replace_with("\n")

    sections: dict[str, list[str]] = {}
    current: str | None = None

    for el in main.descendants:
        name = getattr(el, "name", None)
        if name in ("h2", "h3", "h4"):
            current = normalize(el.get_text())
            sections.setdefault(current, [])
        elif isinstance(el, NavigableString):
            if el.parent and el.parent.name in ("h2", "h3", "h4"):
                continue
            if current is None:
                continue
            for raw in str(el).split("\n"):
                line = raw.strip()
                if line:
                    sections[current].append(line)

    # NavigableString は親要素から複数回取れないが、
    # descendants の走査順序により同じテキストノードが複数のセクションに入ることはない
    # （見出しを跨ぐと current が更新される）
    return sections


def scrape_members():
    print("新篠津村議会 議員名簿を収集中...")
    soup = fetch(OVERVIEW_URL)
    if soup is None:
        return None

    main = soup.find("div", id="page_maincontents")
    if main is None:
        print("  本文領域が見つからない")
        return None

    sections = walk_sections(main)
    if CHAIR_HEADING not in sections:
        print(f"  '{CHAIR_HEADING}' セクションが見つからない")
        return None

    members: dict[str, dict] = {}

    def ensure(name: str) -> dict:
        if name not in members:
            members[name] = {
                "name": name,
                "roles": [],
                "committees": [],
            }
        return members[name]

    # 正副議長
    for line in sections.get(CHAIR_HEADING, []):
        parsed = parse_role_line(line)
        if not parsed:
            continue
        role, name = parsed
        if role in ("議長", "副議長"):
            m = ensure(name)
            if role not in m["roles"]:
                m["roles"].append(role)

    # 各委員会
    for heading, label in COMMITTEE_HEADINGS.items():
        for line in sections.get(heading, []):
            parsed = parse_role_line(line)
            if not parsed:
                continue
            role, name = parsed
            m = ensure(name)
            committee_label = label
            if role in ("委員長", "副委員長"):
                committee_label = f"{label}（{role}）"
            if committee_label not in m["committees"]:
                m["committees"].append(committee_label)

    if not members:
        print("  議員データを抽出できなかった")
        return None

    # 議長 → 副議長 → その他（名前順）で seat_number を割り当てる
    def sort_key(item):
        name, m = item
        if "議長" in m["roles"]:
            return (0, name)
        if "副議長" in m["roles"]:
            return (1, name)
        return (2, name)

    sorted_members = sorted(members.items(), key=sort_key)
    output = []
    for i, (name, m) in enumerate(sorted_members, start=1):
        output.append({
            "seat_number": i,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "・".join(m["roles"]),
            "committees": m["committees"],
        })
    return output


def main():
    data = scrape_members()
    if not data:
        print("取得不可: ページから議員データを抽出できませんでした")
        return

    payload = {"members": data}
    for d in OUTPUT_DIRS:
        out = d / "members.json"
        out.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き込み: {out}")

    print(f"取得議員数: {len(data)}名")
    for m in data:
        print(f"  {m['seat_number']:>2}. {m['name']}  faction={m['faction']!r}  committees={m['committees']}")


if __name__ == "__main__":
    main()
