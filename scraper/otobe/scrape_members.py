"""
乙部町議会 議員名簿スクレイパー
出力: data/otobe/members.json
議員名簿はPDFのみ提供 -> pdfplumber で抽出
PDF URL: https://www.town.otobe.lg.jp/section/gikai/e0taal0000000v31-att/e0taal0000000v4l.pdf
"""

import json
import re
import sys
import tempfile
from pathlib import Path

import requests

try:
    import pdfplumber
except ImportError:
    print("pdfplumber が未インストールです: pip install pdfplumber")
    sys.exit(1)

PDF_URL = "https://www.town.otobe.lg.jp/section/gikai/e0taal0000000v31-att/e0taal0000000v4l.pdf"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "otobe"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

PARTY_PATTERN = re.compile(r"(無所属|共産党|公明党|自民党|立憲民主党|国民民主党|社民党|維新|自由民主党)")
DATE_PATTERN = re.compile(r"[SHR]\d+\.\s*\d+\.\s*\d+")
MEMBER_LINE_PATTERN = re.compile(r"^(議\s+長|副\s+議\s+長|(\d+)\s+議\s+員)\s+(.+)")


def download_pdf(url: str) -> Path | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        tmp.write(resp.content)
        tmp.close()
        return Path(tmp.name)
    except Exception as e:
        print(f"  [ERROR] PDF ダウンロード失敗: {e}")
        return None


def extract_lines(pdf_path: Path) -> list[str]:
    lines = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                for line in text.splitlines():
                    line = line.strip()
                    if line:
                        lines.append(line)
    return lines


def parse_members(lines: list[str]) -> list[dict]:
    members = []

    # 委員会名の追跡用：議員行の直前/直後の委員会行を紐付ける
    # 処理済み行インデックスを管理
    used_indices = set()
    member_indices = []

    # まず議員行のインデックスを収集
    for i, line in enumerate(lines):
        if MEMBER_LINE_PATTERN.match(line):
            date_match = DATE_PATTERN.search(line)
            if date_match:
                member_indices.append(i)

    for pos, idx in enumerate(member_indices):
        line = lines[idx]
        m = MEMBER_LINE_PATTERN.match(line)
        if not m:
            continue

        role_text = m.group(1)
        seat_str = m.group(2)
        rest = m.group(3)

        # 議席番号・役職
        if seat_str:
            seat_num = int(seat_str)
            role = ""
        elif "副" in role_text:
            seat_num = 0
            role = "副議長"
        else:
            seat_num = 0
            role = "議長"

        # 日付を区切りとして氏名と後半を分離
        date_match = DATE_PATTERN.search(line)
        before_date = line[:date_match.start()].strip()
        after_date = line[date_match.end():].strip()

        # 氏名部分: ロール/議席番号を除いた残り
        # before_date の末尾がスペース区切りの漢字名
        prefix_m = re.match(r"^(?:議\s+長|副\s+議\s+長|\d+\s+議\s+員)\s+(.+)$", before_date)
        name_raw = prefix_m.group(1) if prefix_m else ""
        # スペースを除去して名前を結合
        name = name_raw.replace(" ", "").replace("\u3000", "")

        # 政党
        party_m = PARTY_PATTERN.search(after_date)
        party = party_m.group(1) if party_m else ""

        # 委員会: 同じ行内と前後の委員会行から収集
        prev_idx = member_indices[pos - 1] if pos > 0 else -1
        next_idx = member_indices[pos + 1] if pos + 1 < len(member_indices) else len(lines)
        committee_lines = []
        # 同じ行の委員会（日付より後、政党より前）
        if party_m:
            committee_text = after_date[:after_date.find(party)].strip()
        else:
            committee_text = after_date
        # 記号除去して委員会名を抽出
        committee_text = re.sub(r"[◎○]", "", committee_text).strip()
        if committee_text and not re.search(r"[A-Za-z0-9]", committee_text):
            c = committee_text.replace(" ", "").replace("\u3000", "")
            if c:
                committee_lines.append(c)

        def capture_committee(l_raw: str) -> str | None:
            l = l_raw.strip()
            l_normalized = l.replace(" ", "").replace("\u3000", "")
            # ヘッダー行・不要行をスキップ
            skip_words = {"欠番", "欠 番"}
            skip_patterns = ["役職名", "氏名", "所属する委員会等", "委員長副委員長", "（◎", "※議長"]
            if l in skip_words:
                return None
            for sp in skip_patterns:
                if sp in l_normalized:
                    return None
            if "委員会" in l_normalized or "委員" in l_normalized:
                return re.sub(r"[◎○]", "", l_normalized).strip()
            return None

        # 前の議員行の後〜現議員行の前（PDFの列順序ずれ対応）
        for j in range(prev_idx + 1, idx):
            if j in used_indices:
                continue
            c = capture_committee(lines[j])
            if c and c not in committee_lines:
                committee_lines.append(c)
                used_indices.add(j)

        # 議員行の次〜次の議員行の前
        for j in range(idx + 1, next_idx):
            if j in used_indices:
                continue
            c = capture_committee(lines[j])
            if c and c not in committee_lines:
                committee_lines.append(c)
                used_indices.add(j)

        member = {
            "seat_number": seat_num,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": role,
            "committees": committee_lines,
            "photo_url": "",
        }
        members.append(member)

    # 議席番号順にソート（議長・副議長は末尾）
    members.sort(key=lambda m: (m["seat_number"] == 0, m["seat_number"]))

    # 議長・副議長に仮番号は付けない（0のまま）
    return members


def scrape():
    print("乙部町議会 議員名簿を収集中...")
    print(f"  PDF URL: {PDF_URL}")

    pdf_path = download_pdf(PDF_URL)
    if pdf_path is None:
        print("取得不可: PDF ダウンロード失敗")
        return

    lines = extract_lines(pdf_path)
    pdf_path.unlink(missing_ok=True)

    if not lines:
        print("取得不可: PDF からテキスト抽出失敗（スキャン画像PDFの可能性）")
        return

    members = parse_members(lines)

    if not members:
        print("取得不可: 議員データのパースに失敗")
        return

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n取得議員数: {len(members)}名")
    print(f"出力: {output_path}")
    for mem in members:
        role_str = f" [{mem['faction']}]" if mem["faction"] else ""
        committees_str = f" 委員会:{','.join(mem['committees'])}" if mem["committees"] else ""
        print(f"  [{mem['seat_number']}] {mem['name']} 党派:{mem['party']}{role_str}{committees_str}")


if __name__ == "__main__":
    scrape()
