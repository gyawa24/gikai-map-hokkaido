"""
北海道議会 議員名簿スクレイパー
50音順PDF（8分割）から議員情報を動的に抽出する。
"""

import io
import json
import re
import shutil
import time
from pathlib import Path

import pdfplumber
import requests

BASE_URL = "https://www.gikai.pref.hokkaido.lg.jp"

# 50音順PDF（8分割）
PDF_URLS = [
    f"{BASE_URL}/fs/1/3/0/9/7/0/5/6/_/32meibo1-080408.pdf",  # あ～お
    f"{BASE_URL}/fs/1/3/0/9/7/0/5/7/_/32meibo2-080408.pdf",  # か～こ
    f"{BASE_URL}/fs/1/3/0/9/7/0/5/8/_/32meibo3-070619.pdf",  # さ～そ
    f"{BASE_URL}/fs/1/3/0/9/7/0/5/9/_/32meibo4-080408.pdf",  # た～と
    f"{BASE_URL}/fs/1/3/0/9/7/0/6/0/_/32meibo5-070619.pdf",  # な～の
    f"{BASE_URL}/fs/1/3/0/9/7/0/6/1/_/32meibo6-070619.pdf",  # は～ほ
    f"{BASE_URL}/fs/1/3/0/9/7/0/6/2/_/32meibo7-071201.pdf",  # ま～も
    f"{BASE_URL}/fs/1/3/0/9/7/0/6/3/_/32meibo8-071016.pdf",  # や～よ・わ
]

OUTPUT_DIR_DATA = Path(__file__).parent.parent.parent / "data" / "hokkaido"
OUTPUT_DIR_SITE = Path(__file__).parent.parent.parent / "site" / "data" / "hokkaido"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch_pdf(url: str) -> pdfplumber.PDF | None:
    """PDFをダウンロードしてpdfplumberで開く。"""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return pdfplumber.open(io.BytesIO(resp.content))
    except Exception as e:
        print(f"  [ERROR] PDF取得失敗: {url} -> {e}")
        return None


def parse_member_cell(text: str) -> dict | None:
    """PDFテーブルの1セルから議員情報をパースする。"""
    if not text or not text.strip():
        return None

    lines = [l.strip() for l in text.strip().split("\n") if l.strip()]
    if not lines:
        return None

    # 1行目: 氏名（ふりがな）
    name_line = lines[0]
    # 補選注記がある場合は除去して次の行から名前を取る
    line_idx = 0
    if name_line.startswith("※"):
        line_idx = 1
        if len(lines) <= 1:
            return None
        name_line = lines[1]

    # 「※令和６年10月補選」のような注記が名前行の後にある場合もチェック
    # 名前行パターン: "氏名（ふりがな）" or "氏名(ふりがな)"
    m = re.match(r"^(.+?)[\s　]*[（(](.+?)[）)]$", name_line)
    if m:
        name = m.group(1).strip()
        furigana = m.group(2).strip()
    else:
        name = name_line.strip()
        furigana = ""

    # 残りの行から情報を抽出
    full_text = "\n".join(lines[line_idx + 1:])

    # 会派（政党）: 2行目付近に「自民党・道民会議」「公明党」「民主・道民連合」「北海道結志会」等
    party = ""
    faction = ""
    # 既知の会派パターン（長い名前から先にマッチさせる）
    faction_patterns = [
        "自民党・道民会議",
        "民主・道民連合",
        "北海道結志会",
        "北海道維新の会",
        "日本共産党",
        "公明党",
        "無所属",
    ]
    for fp in faction_patterns:
        if fp in full_text:
            faction = fp
            break

    # 政党を会派から推定
    party_map = {
        "自民党・道民会議": "自由民主党",
        "民主・道民連合": "",  # 立憲民主・国民民主等混在のため空
        "北海道結志会": "",
        "北海道維新の会": "日本維新の会",
        "日本共産党": "日本共産党",
        "公明党": "公明党",
        "無所属": "無所属",
    }
    party = party_map.get(faction, "")

    # 選挙区: 「〇〇選出」パターン
    # PDFでは「会派名 選挙区名選出」の形式で1行に書かれている
    district = ""
    m_dist = re.search(r"(.+?)選出", full_text)
    if m_dist:
        district = m_dist.group(1).strip()
        # 会派名が含まれている場合は除去
        for fp in faction_patterns:
            district = district.replace(fp, "").strip()
        # 先頭の空白や改行残りを除去
        district = district.strip()
        # 選挙区名の末尾に「地域」「市」「区」等がない場合のフォールバック
        # 改行が混入している場合は最後のトークンを取る
        if "\n" in district:
            district = district.split("\n")[-1].strip()

    # 委員会: 「〇〇委員」「〇〇委員長」「〇〇副委員長」パターン
    committees = []
    # 委員会パターン: 行単位で抽出
    for line in lines:
        line = line.strip()
        # 委員会名を含む行を検出
        # 「〇〇委員」「〇〇委員長」「〇〇副委員長」で終わる行
        if re.search(r"委員(長)?$", line) or re.search(r"副委員長$", line):
            # 住所行やTel行は除外
            if any(kw in line for kw in ["住所", "Tel", "Fax", "URL", "E-mail", "モットー"]):
                continue
            # 「員長」だけの断片行を除外
            if line in ("員長", "委員長", "副委員長"):
                continue
            committees.append(line)

    # 当選回数
    terms = 0
    m_terms = re.search(r"当選[　\s]*(\d+|１|２|３|４|５|６|７|８|９)[　\s]*回", full_text)
    if m_terms:
        kanji_map = {"１": 1, "２": 2, "３": 3, "４": 4, "５": 5, "６": 6, "７": 7, "８": 8, "９": 9}
        val = m_terms.group(1)
        terms = kanji_map.get(val, int(val) if val.isdigit() else 0)

    return {
        "name": name,
        "furigana": furigana,
        "party": party,
        "faction": faction,
        "district": district,
        "committees": committees,
        "terms": terms,
    }


def scrape_members():
    print("=== 北海道議会 議員名簿スクレイパー 開始 ===\n")
    all_members = []

    for i, pdf_url in enumerate(PDF_URLS):
        print(f"[{i+1}/{len(PDF_URLS)}] {pdf_url.split('/')[-1]}")
        pdf = fetch_pdf(pdf_url)
        if pdf is None:
            continue

        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    for cell in row:
                        if not cell:
                            continue
                        member = parse_member_cell(cell)
                        if member and member["name"]:
                            all_members.append(member)
                            print(f"  {member['name']}（{member['furigana']}）/ {member['faction']} / {member['district']}")

        pdf.close()

        if i < len(PDF_URLS) - 1:
            time.sleep(1)

    # 重複除去（名前+ふりがなで一意とする）
    seen = set()
    unique_members = []
    for m in all_members:
        key = (m["name"], m["furigana"])
        if key not in seen:
            seen.add(key)
            unique_members.append(m)

    # 50音順でソート（ふりがなベース）
    unique_members.sort(key=lambda x: x["furigana"])

    # seat_number を振る（50音順）
    for i, m in enumerate(unique_members, 1):
        m["seat_number"] = i

    # 保存
    for output_dir in [OUTPUT_DIR_DATA, OUTPUT_DIR_SITE]:
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / "members.json"
        path.write_text(
            json.dumps(unique_members, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"\n  -> 保存: {path}")

    print(f"\n=== 完了: 取得議員数: {len(unique_members)}名 ===")
    return unique_members


if __name__ == "__main__":
    scrape_members()
