"""
音更町議会 議員名簿スクレイパー
公式サイトの議員名簿ページに議員データはHTMLとして存在せず、PDFのみで配布されている。
よってPDFを pdfplumber で解析して JSON を生成する。

- 公式ページ: https://www.town.otofuke.hokkaido.jp/gikai/meibo.html
- PDFリンク（相対パス）: /files/00004400/00004446/r071001giunmeibo.pdf
  （ファイル名は改定で変わる可能性があるため、HTMLから動的に取得する）

出力: data/otofuke/members.json
"""

import json
import re
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.otofuke.hokkaido.jp"
MEIBO_URL = f"{BASE_URL}/gikai/meibo.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "site" / "data" / "otofuke"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
RAW_DIR = ROOT / "data" / "otofuke"
RAW_DIR.mkdir(parents=True, exist_ok=True)
PDF_PATH = RAW_DIR / "members.pdf"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 全角→半角数字
ZEN_TO_HAN = str.maketrans("０１２３４５６７８９", "0123456789")


def zen_digits_to_han(s: str) -> str:
    return s.translate(ZEN_TO_HAN)


def find_pdf_url() -> str | None:
    """議員名簿HTMLから議員名簿PDFのURLを取得。"""
    resp = requests.get(MEIBO_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        if href.lower().endswith(".pdf") and ("議員名簿" in text or "meibo" in href.lower() or "giunmeibo" in href.lower() or "giinmeibo" in href.lower()):
            return href if href.startswith("http") else BASE_URL + href
    return None


def download_pdf(url: str) -> None:
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    PDF_PATH.write_bytes(resp.content)


def parse_members(pdf_text_pages: list[str]) -> list[dict]:
    """
    1〜2ページ目のテキストから議員ブロックを抽出。
    各ページは左右2カラムに議員ブロックが並ぶ形式:

        議席番号１ 議席番号２
        阿部 秀一 石垣 加奈子
        アベ シュウイチ イシガキ カナコ
        生年月日 S46.11.25 生年月日 S48.2.27
        住 所 ...        住 所 ...
        職 業 無職        職 業 政党役員
        期 数 2期         期 数 2期
    """
    members: dict[int, dict] = {}

    for text in pdf_text_pages:
        lines = [l.rstrip() for l in text.split("\n") if l.strip()]
        i = 0
        while i < len(lines):
            line = lines[i]
            # セクション見出し・注記行はスキップ（「■議員一覧（定数２０名・議席番号４、１４は欠番...）」など、
            # 議席番号を本文に含む説明文が誤マッチするのを避ける）
            if line.startswith("■") or "欠番" in line or "定数" in line:
                i += 1
                continue
            # 議席番号行のみを対象にする：行全体が「議席番号N」の繰り返し（役職付きを許容）である場合のみマッチ
            if not re.fullmatch(r"(?:\s*議席番号[０-９0-9]+(?:\s+(?:議\s*長|副議長))?)+\s*", line):
                i += 1
                continue
            seat_match = re.findall(r"議席番号([０-９0-9]+)", line)
            if not seat_match:
                i += 1
                continue

            # 次の3行を想定（氏名・ふりがな）。ふりがなは必ずしも3行目とは限らないため柔軟に。
            if i + 2 >= len(lines):
                break
            name_line = lines[i + 1]
            furi_line = lines[i + 2]

            # 氏名（漢字含む）とふりがな（カタカナ）を左右に分離。
            # 「阿部 秀一 石垣 加奈子」「アベ シュウイチ イシガキ カナコ」
            # それぞれトークン4個（姓・名・姓・名）で構成。
            name_tokens = name_line.split()
            furi_tokens = furi_line.split()

            # 左右の議席番号数と、姓名トークンのペアリング
            # 一人分の「姓 名」は2トークンなのでseat_matchの数 × 2 になるはず
            expected_people = len(seat_match)
            if len(name_tokens) < expected_people * 2:
                i += 1
                continue

            for k, seat_str in enumerate(seat_match):
                seat_num = int(zen_digits_to_han(seat_str))
                # 姓 名
                surname = name_tokens[k * 2]
                given = name_tokens[k * 2 + 1] if k * 2 + 1 < len(name_tokens) else ""
                name = f"{surname} {given}".strip()

                # ふりがな（カタカナ → ひらがな変換）
                furigana = ""
                if len(furi_tokens) >= (k + 1) * 2:
                    fs = furi_tokens[k * 2]
                    fg = furi_tokens[k * 2 + 1] if k * 2 + 1 < len(furi_tokens) else ""
                    kata = f"{fs} {fg}".strip()
                    # カタカナ→ひらがな
                    furigana = "".join(
                        chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c
                        for c in kata
                    )

                members[seat_num] = {
                    "seat_number": seat_num,
                    "name": name,
                    "furigana": furigana,
                    "party": "",
                    "faction": "",
                    "committees": [],
                }

            i += 3  # 議席番号行 + 氏名 + ふりがなを消費

    return [members[k] for k in sorted(members.keys())]


def parse_committees(page_text: str, members_by_name: dict[str, dict]) -> None:
    """
    3ページ目の委員会情報を解析し、各議員のcommittees配列を埋める。

    フォーマット例:
        総務文教常任委員会 定数８名
        委 員 長 平子 勇輔
        副委員長 松浦 波雄
        委 員 阿部 秀一 神長 基子 堀江 美夫 不破 尚美 柴田 秀樹
    """
    lines = [l.rstrip() for l in page_text.split("\n") if l.strip()]
    current_committee: str | None = None

    committee_header_re = re.compile(r"^(.+?(?:常任委員会|特別委員会|委員会))(?:\s+定数.*)?$")
    role_lines_re = re.compile(r"^(委\s*員\s*長|副\s*委員長|副\s*委\s*員\s*長|委\s*員)\s+(.+)$")

    for line in lines:
        # 「■常任委員会」「■議会運営委員会」「■特別委員会」のセクション見出しはスキップ
        if line.startswith("■"):
            continue
        m = committee_header_re.match(line)
        if m and ("委員会" in m.group(1)):
            # 委員会名だけ抽出（「総務文教常任委員会」など）
            current_committee = m.group(1).strip()
            continue

        rm = role_lines_re.match(line)
        if rm and current_committee:
            names_blob = rm.group(2)
            # 「阿部 秀一 神長 基子」のように 姓+名 が連続する。
            # 議員マスター（members_by_name）と突き合わせて該当する議員を検出。
            tokens = names_blob.split()
            # 2トークンずつで姓・名を構成
            idx = 0
            while idx + 1 < len(tokens):
                candidate = f"{tokens[idx]} {tokens[idx + 1]}"
                if candidate in members_by_name:
                    m_obj = members_by_name[candidate]
                    if current_committee not in m_obj["committees"]:
                        m_obj["committees"].append(current_committee)
                    idx += 2
                else:
                    # マッチしなければ1トークン進む（空白込み氏名の誤分割対策）
                    idx += 1


def parse_factions(page_text: str, members_by_name: dict[str, dict]) -> None:
    """
    4ページ目の会派情報を解析し、各議員のfaction/partyを埋める。

    フォーマット例:
        ■会派
        ...
        日本共産党
        代 表 神長 基子
        会 員 石垣 加奈子 重堂 聡
        音和の会
        代 表 堀井 正憲
    """
    lines = [l.rstrip() for l in page_text.split("\n") if l.strip()]
    current_faction: str | None = None
    in_faction_section = False

    role_re = re.compile(r"^(代\s*表|会\s*員)\s+(.+)$")

    for line in lines:
        if line.startswith("■会派"):
            in_faction_section = True
            continue
        if line.startswith("■") and in_faction_section:
            # 次のセクション（議員会役員）に入った
            break
        if not in_faction_section:
            continue

        # 「届出順」等の注記はスキップ
        if line in ("届出順",) or line.startswith("町政に関して"):
            continue

        rm = role_re.match(line)
        if rm:
            if current_faction is None:
                continue
            tokens = rm.group(2).split()
            idx = 0
            while idx + 1 < len(tokens):
                candidate = f"{tokens[idx]} {tokens[idx + 1]}"
                if candidate in members_by_name:
                    m_obj = members_by_name[candidate]
                    m_obj["faction"] = current_faction
                    # 会派名が明らかに政党名のものだけpartyにも反映（音更の場合は日本共産党のみ）
                    if current_faction in ("日本共産党", "公明党", "立憲民主党", "国民民主党", "自由民主党"):
                        m_obj["party"] = current_faction
                    idx += 2
                else:
                    idx += 1
        else:
            # 会派名の見出し行
            current_faction = line.strip()


def main() -> int:
    print("音更町議会 議員名簿を収集中...")

    pdf_url = find_pdf_url()
    if not pdf_url:
        print("  [ERROR] 議員名簿PDFのURLが見つかりません")
        return 1
    print(f"  PDF URL: {pdf_url}")
    download_pdf(pdf_url)
    print(f"  PDF保存: {PDF_PATH}")

    with pdfplumber.open(PDF_PATH) as pdf:
        page_texts = [p.extract_text() or "" for p in pdf.pages]

    if len(page_texts) < 2:
        print("  [ERROR] PDFが想定より短い")
        return 1

    members = parse_members(page_texts[:2])
    if not members:
        print("  [ERROR] 議員を抽出できません")
        return 1

    members_by_name = {m["name"]: m for m in members}

    if len(page_texts) >= 3:
        parse_committees(page_texts[2], members_by_name)
    if len(page_texts) >= 4:
        parse_factions(page_texts[3], members_by_name)

    output_path = OUTPUT_DIR / "members.json"
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"  取得議員数: {len(members)}名")
    print(f"  出力: {output_path}")

    # サマリ表示
    for m in members:
        print(
            f"  席{m['seat_number']:>2} {m['name']}（{m['furigana']}）"
            f" 会派={m['faction'] or '-'} 委員会={','.join(m['committees']) or '-'}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
