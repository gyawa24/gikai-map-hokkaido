"""
赤井川村議会 議員名簿スクレイパー
出力: data/akaigawa/members.json

公式ページ構造:
  https://www.akaigawa.com/kurashi/gikai_jimukyoku/index71.html
  議長・副議長・各常任委員会・議会運営委員会の見出し直下に議員名が並ぶ。
  氏名は「姓　名」形式（全角スペース区切り）で、複数人は「、」で区切られる。
  ふりがな・会派・議席番号は公開されていないため空とする。
"""

import json
import re
import unicodedata
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.akaigawa.com"
MEMBERS_URL = f"{BASE_URL}/kurashi/gikai_jimukyoku/index71.html"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "akaigawa"
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR = ROOT / "site" / "data" / "akaigawa"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 氏名パターン: 漢字/ひらがな/カタカナ 2文字以上 + 全角スペース + 同 1文字以上
NAME_RE = re.compile(r"[一-龥ぁ-んァ-ヶー]{1,5}\s+[一-龥ぁ-んァ-ヶー]{1,5}")


def fetch(url: str) -> BeautifulSoup:
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return BeautifulSoup(resp.text, "html.parser")


def normalize_name(raw: str) -> str:
    # 「岩井　英明」のようにスペースで区切られた氏名を正規化
    # 全角スペース・半角スペース・連続空白を1つの全角スペースに
    text = unicodedata.normalize("NFKC", raw).strip()
    parts = [p for p in re.split(r"\s+", text) if p]
    return "　".join(parts)


def split_names(line: str) -> list[str]:
    # 「、」「，」「,」区切りで複数人を分割
    chunks = re.split(r"[、,，]", line)
    names = []
    for c in chunks:
        m = NAME_RE.search(c)
        if m:
            names.append(normalize_name(m.group()))
    return names


def scrape_members() -> list[dict]:
    print(f"赤井川村議会 議員名簿を収集中... {MEMBERS_URL}")
    soup = fetch(MEMBERS_URL)

    # メインコンテンツ部分のテキストを抽出
    main = soup.find("main") or soup.find("article") or soup
    text = main.get_text("\n", strip=True)

    # 議会構成のセクションだけを対象にするため、
    # 「議会構成」見出し以降 / フッター手前までに絞る
    start = text.find("議会構成")
    if start == -1:
        raise RuntimeError("『議会構成』セクションが見つかりません")
    # 下限: 「令和」表記の「現在」行 or 「議会事務局」
    end_match = re.search(r"(令和[^\n]*現在|議会事務局)", text[start:])
    end = start + end_match.start() if end_match else len(text)
    section = text[start:end]

    # 役職・委員会別に所属議員を抽出
    # 見出し行をアンカーにして、以降の行を当該見出しに紐付ける
    # 例: 「◆議　長」「◆副議長」「◆総務開発常任委員会」「◇委員長」「◇副委員長」「◇委　員」
    lines = [l.strip() for l in section.splitlines() if l.strip()]

    chair_name = ""
    vice_chair_name = ""
    # {committee_name: {"chair": name, "vice_chair": name, "members": [names]}}
    committees: dict[str, dict] = {}
    audit_names: list[str] = []

    current_committee: str | None = None
    current_role: str | None = None  # "chair" | "vice_chair" | "members"
    pending_line_role: str | None = None  # 見出し直後の行待ち

    IGNORED_COMMITTEES = {
        "北後志消防組合議会議員",
        "北後志衛生施設組合議会議員",
        "北しりべし廃棄物処理広域連合議会議員",
        "後志広域連合議会議員",
    }

    for line in lines:
        # 見出し判定（◆で始まる）
        if line.startswith("◆"):
            head = line.lstrip("◆").strip()
            # 「議　長　　　岩井　英明」のように同一行に氏名が併記されることがある
            # まず役職＋氏名パターン
            m = re.match(r"(議\s*長|副議長)\s+(.+)$", head)
            if m:
                role, rest = m.group(1), m.group(2)
                role_key = re.sub(r"\s+", "", role)
                names = split_names(rest)
                if names:
                    if role_key == "議長":
                        chair_name = names[0]
                    else:
                        vice_chair_name = names[0]
                current_committee = None
                current_role = None
                continue
            # 「監査委員　　能登　ゆう」
            m = re.match(r"監査委員\s+(.+)$", head)
            if m:
                audit_names.extend(split_names(m.group(1)))
                current_committee = None
                current_role = None
                continue
            # 見出しのみ（役職名は次行）
            if head.replace(" ", "").replace("\u3000", "") == "議長":
                pending_line_role = "chair"
                current_committee = None
                current_role = None
                continue
            if head.replace(" ", "").replace("\u3000", "") == "副議長":
                pending_line_role = "vice_chair"
                current_committee = None
                current_role = None
                continue
            if head.replace(" ", "").replace("\u3000", "") == "監査委員":
                pending_line_role = "audit"
                current_committee = None
                current_role = None
                continue
            # それ以外は委員会名
            if head in IGNORED_COMMITTEES:
                current_committee = None
                current_role = None
                continue
            # 広域系は議員情報として使わない（村議会以外の所属）
            if any(kw in head for kw in ("広域", "組合議会", "衛生施設", "廃棄物処理")):
                current_committee = None
                current_role = None
                continue
            current_committee = head
            committees.setdefault(current_committee, {"chair": "", "vice_chair": "", "members": []})
            current_role = None
            continue

        # サブ見出し判定（◇で始まる）
        if line.startswith("◇"):
            sub = line.lstrip("◇").strip()
            key = sub.replace(" ", "").replace("\u3000", "").replace("　", "")
            if key == "委員長":
                current_role = "chair"
            elif key == "副委員長":
                current_role = "vice_chair"
            elif key.startswith("委員"):
                current_role = "members"
            else:
                current_role = None
            continue

        # 通常行: 氏名の集まり
        names = split_names(line)
        if not names:
            continue

        if pending_line_role == "chair":
            chair_name = names[0]
            pending_line_role = None
            continue
        if pending_line_role == "vice_chair":
            vice_chair_name = names[0]
            pending_line_role = None
            continue
        if pending_line_role == "audit":
            audit_names.extend(names)
            pending_line_role = None
            continue

        if current_committee is None or current_role is None:
            continue
        slot = committees[current_committee]
        if current_role == "chair":
            slot["chair"] = names[0]
        elif current_role == "vice_chair":
            slot["vice_chair"] = names[0]
        else:
            slot["members"].extend(names)

    # 全議員の集合を構築（順序は初出順に保つ）
    seen: dict[str, None] = {}

    def add(n: str):
        if n and n not in seen:
            seen[n] = None

    add(chair_name)
    add(vice_chair_name)
    for c in committees.values():
        add(c["chair"])
        add(c["vice_chair"])
        for n in c["members"]:
            add(n)
    for n in audit_names:
        add(n)

    all_names = list(seen.keys())
    if not all_names:
        raise RuntimeError("議員氏名を1件も抽出できませんでした")

    # 役職・委員会情報を組み立て
    members = []
    for i, name in enumerate(all_names, start=1):
        committees_for = []
        for cname, slot in committees.items():
            roles_in = []
            if slot["chair"] == name:
                roles_in.append("委員長")
            if slot["vice_chair"] == name:
                roles_in.append("副委員長")
            if name in slot["members"] and not roles_in:
                roles_in.append("委員")
            if roles_in:
                committees_for.append(f"{cname}（{'・'.join(roles_in)}）")
        if name in audit_names:
            committees_for.append("監査委員")

        faction = ""
        if name == chair_name:
            faction = "議長"
        elif name == vice_chair_name:
            faction = "副議長"

        members.append({
            "seat_number": i,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": faction,
            "committees": committees_for,
        })

    return members


def main():
    members = scrape_members()
    payload = {
        "source_url": MEMBERS_URL,
        "count": len(members),
        "members": members,
    }
    for out_dir in (DATA_DIR, OUTPUT_DIR):
        path = out_dir / "members.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  保存: {path}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
