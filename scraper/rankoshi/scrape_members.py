"""
蘭越町議会 議員名簿スクレイパー

蘭越町公式サイトに議員一覧のHTMLページが存在しないため、
「議会活動報告書」PDFから議員名簿を動的に抽出する。

手順:
1. 議会活動報告書ページ (content=818) から最新PDFのURLを抽出
2. PDFをダウンロード
3. pdfplumber でテキスト抽出し、議員名簿・委員会セクションをパース

出力: data/rankoshi/members.json, site/data/rankoshi/members.json
"""

import json
import re
import sys
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.rankoshi.hokkaido.jp"
REPORT_PAGE_URL = f"{BASE_URL}/administration/town/detail.html?content=818"

ROOT = Path(__file__).parent.parent.parent
RAW_DIR = ROOT / "data" / "rankoshi"
SITE_DATA_DIR = ROOT / "site" / "data" / "rankoshi"
RAW_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def find_report_pdf_url() -> str | None:
    """議会活動報告書ページから最新PDFのURLを取得"""
    resp = requests.get(REPORT_PAGE_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        if href.lower().endswith(".pdf") and "議会活動報告書" in text:
            if href.startswith("http"):
                return href
            if href.startswith("/"):
                return BASE_URL + href
            # ../../common/... のような相対パス
            return BASE_URL + "/" + href.lstrip("./")
    return None


def strip_fullwidth_spaces(s: str) -> str:
    """「熊 谷 雅 幸」のような全角・半角スペース混在名を連結"""
    return re.sub(r"\s+", "", s).strip()


def parse_members(text: str) -> list[dict]:
    """
    PDFテキストから議員名簿をパースする。
    想定フォーマット:
        （２）議員名簿
        議 長 熊 谷 雅 幸
        副 議 長 永 井 浩
        栁 谷 要
        ...
        議 員
        金 安 英 照
        ...
    """
    lines = [ln.rstrip() for ln in text.splitlines()]

    # 「（２）議員名簿」〜「（３）委員会名簿」で囲まれる本文セクションを特定
    # （目次ページにも「議員名簿」は出るが、目次では中黒「・・・」が続くため、
    #  中黒を含まない行をセクション開始マーカーとして採用する）
    start_idx = None
    end_idx = None
    for i, ln in enumerate(lines):
        if start_idx is None:
            if "（２）議員名簿" in ln and "・・" not in ln:
                start_idx = i + 1
        else:
            if "（３）委員会名簿" in ln:
                end_idx = i
                break
    if start_idx is None or end_idx is None:
        return []

    section = lines[start_idx:end_idx]

    members: list[dict] = []
    current_role = ""  # 議長 / 副議長 / 議員

    for raw in section:
        ln = raw.strip()
        if not ln:
            continue

        # 役職ラベルだけの行
        if strip_fullwidth_spaces(ln) == "議員":
            current_role = "議員"
            continue

        # 「議 長 熊 谷 雅 幸」「副 議 長 永 井 浩」を分離
        role_match = re.match(r"^(副\s*議\s*長|議\s*長)\s+(.+)$", ln)
        if role_match:
            role_raw = strip_fullwidth_spaces(role_match.group(1))
            name_raw = role_match.group(2)
            name = strip_fullwidth_spaces(name_raw)
            role = "副議長" if role_raw == "副議長" else "議長"
            # 議長/副議長の氏名を登録したあとは、後続行に役職が伝播しないよう
            # current_role を「議員」にリセットする
            current_role = "議員"
            if name and len(name) >= 2:
                members.append({"name": name, "role": role})
            continue

        # 氏名のみの行
        name = strip_fullwidth_spaces(ln)
        if len(name) >= 2 and re.fullmatch(r"[一-龥ぁ-んァ-ヶー々]+", name):
            role = current_role if current_role else "議員"
            # 議長・副議長はすでに追加済みなのでスキップ回避のため役職を空でもOK
            members.append({"name": name, "role": "議員" if role == "議員" else role})

    return members


def parse_committees(text: str, member_names: list[str]) -> dict[str, list[str]]:
    """
    委員会構成をパースする。PDFの行内には姓名区切り用のスペース
    （例: 「淀谷 融」）と名前間区切りスペースが混在するため、
    既知の議員名リストを使って部分一致検索する。

    例:
        総務文教常任委員会 難波修二 淀谷 融 熊谷雅幸 金安英照 佐々木雄三
    返り値: {議員名: [委員会名, ...]}
    """
    lines = text.splitlines()
    start_idx = None
    end_idx = None
    for i, ln in enumerate(lines):
        if start_idx is None:
            if "（３）委員会名簿" in ln and "・・" not in ln:
                start_idx = i + 1
        else:
            if "（４）議会選出委員" in ln or "（５）広域連合" in ln:
                end_idx = i
                break
    if start_idx is None:
        return {}
    if end_idx is None:
        end_idx = len(lines)

    committee_names = [
        "総務文教常任委員会",
        "経済建設常任委員会",
        "議会運営委員会",
    ]

    result: dict[str, list[str]] = {}
    for raw in lines[start_idx:end_idx]:
        ln = raw.strip()
        if not ln:
            continue
        for cname in committee_names:
            if ln.startswith(cname):
                rest_no_space = strip_fullwidth_spaces(ln[len(cname):])
                for name in member_names:
                    if name in rest_no_space:
                        result.setdefault(name, [])
                        if cname not in result[name]:
                            result[name].append(cname)
                break
    return result


def main():
    print("蘭越町議会 議員名簿を収集中...")

    print("  議会活動報告書PDFのURLを探索...")
    pdf_url = find_report_pdf_url()
    if not pdf_url:
        print("  [ERROR] 議会活動報告書PDFが見つかりません")
        sys.exit(1)
    print(f"  PDF URL: {pdf_url}")

    pdf_path = RAW_DIR / "activity_report.pdf"
    print(f"  PDFをダウンロード -> {pdf_path}")
    resp = requests.get(pdf_url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    pdf_path.write_bytes(resp.content)

    # PDFテキスト抽出（最初の数ページに議員名簿がある）
    full_text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages[:5]:
            t = page.extract_text()
            if t:
                full_text += t + "\n"

    members = parse_members(full_text)
    if not members:
        print("  [ERROR] 議員名簿のパースに失敗")
        sys.exit(1)

    committee_map = parse_committees(full_text, [m["name"] for m in members])

    # 委員会情報をマージ・議席番号を付与（議長→副議長→その他の順）
    output = []
    for i, m in enumerate(members):
        name = m["name"]
        role = m.get("role", "議員")
        entry = {
            "seat_number": i + 1,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": committee_map.get(name, []),
        }
        if role != "議員":
            entry["role"] = role
        output.append(entry)

    # 書き出し
    for out_dir in (RAW_DIR, SITE_DATA_DIR):
        out_path = out_dir / "members.json"
        out_path.write_text(
            json.dumps(output, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {out_path}")

    print(f"取得議員数: {len(output)}名")


if __name__ == "__main__":
    main()
