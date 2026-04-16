"""
芦別市議会 議員名簿スクレイパー
出力: data/ashibetsu/members.json

データ取得元（PDF）:
  議員名簿: https://www.city.ashibetsu.hokkaido.jp/docs/4944.html
  委員会名簿: https://www.city.ashibetsu.hokkaido.jp/docs/4945.html
  会派名簿: https://www.city.ashibetsu.hokkaido.jp/docs/4946.html
"""

import json
import re
import subprocess
import tempfile
from pathlib import Path

import requests

BASE_URL = "https://www.city.ashibetsu.hokkaido.jp"
MEMBER_PDF_URL = f"{BASE_URL}/fs/2/7/1/9/4/1/_/_____R7.2.16___.pdf"
COMMITTEE_PDF_URL = f"{BASE_URL}/fs/2/7/9/3/8/1/_/______R7.4.28___.pdf"
INTRO_PDF_URL = f"{BASE_URL}/fs/3/1/0/4/0/7/_/______R7.4.28___.pdf"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "ashibetsu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "ashibetsu"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 既知の会派名（正規化済み）
KNOWN_FACTIONS = ["新星クラブ", "創政会", "こうせい", "公明党", "日本共産党", "無所属"]
# 既知の党派名（正規化済み）
KNOWN_PARTIES = ["自由民主党", "公明党", "日本共産党", "無所属"]

ZENKAKU_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")


def download_pdf(url: str) -> str | None:
    """PDFをダウンロードして pdftotext -layout でテキスト抽出"""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(resp.content)
            tmp_path = f.name
        result = subprocess.run(
            ["pdftotext", "-layout", tmp_path, "-"],
            capture_output=True, text=True
        )
        Path(tmp_path).unlink(missing_ok=True)
        return result.stdout
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize(text: str) -> str:
    """全角スペース・空白を除去"""
    return re.sub(r"[\s\u3000]+", "", text)


def extract_faction_party(seat_line: str) -> tuple[str, str, int]:
    """
    議席番号行から会派・党派・当選回数を抽出する。

    pdftotext -layout の出力では各漢字が固定幅カラムに配置されるため、
    行末の全角数字（当選回数）を除き、残りのテキストを正規化して
    既知の会派名・党派名とマッチングする。

    戻り値: (faction, party, terms)
    """
    # 行末から当選回数（全角数字）を取得
    terms_m = re.search(r"([０-９]+)\s*$", seat_line)
    terms = 0
    if terms_m:
        terms = int(terms_m.group(1).translate(ZENKAKU_DIGITS))

    # 議席番号と当選回数を除いた中間部分を正規化
    middle = re.sub(r"^[\s◎○]*[０-９]+\s*", "", seat_line)  # 先頭の議席番号除去
    middle = re.sub(r"[０-９]+\s*$", "", middle)             # 末尾の当選回数除去
    middle_norm = normalize(middle)

    # 会派・党派をマッチング（長いものから優先）
    faction = ""
    party = ""

    for f in sorted(KNOWN_FACTIONS, key=len, reverse=True):
        if middle_norm.startswith(f):
            faction = f
            rest = middle_norm[len(f):]
            for p in sorted(KNOWN_PARTIES, key=len, reverse=True):
                if rest == p or rest.startswith(p):
                    party = p
                    break
            break

    return faction, party, terms


def parse_member_pdf(text: str) -> list[dict]:
    """
    pdftotext -layout の出力から議員データを解析する。

    各ブロック:
      行A: （ふりがな）
      行B: 議席番号  会派  党派  当選回数
      行C: 氏名（漢字）
    """
    members = []
    lines = text.splitlines()

    idx = 0
    while idx < len(lines):
        line = lines[idx]
        # ふりがな行検出: （...）を含む
        if "（" in line and "）" in line:
            fm = re.search(r"（\s*(.+?)\s*）", line)
            if fm:
                furigana = normalize(fm.group(1))

                # 議席番号行
                seat_line = lines[idx + 1] if idx + 1 < len(lines) else ""
                seat_m = re.match(r"\s*[◎○]?\s*([０-９]+)", seat_line)
                seat_num = None
                if seat_m:
                    seat_num = int(seat_m.group(1).translate(ZENKAKU_DIGITS))

                faction, party, terms = extract_faction_party(seat_line)

                # 氏名行（◎議長・○副議長記号を除去）
                name_line = lines[idx + 2] if idx + 2 < len(lines) else ""
                name = re.sub(r"^[◎○]", "", normalize(name_line))

                if seat_num and len(name) >= 2:
                    members.append({
                        "seat_number": seat_num,
                        "name": name,
                        "furigana": furigana,
                        "faction": faction,
                        "party": party,
                        "terms": terms,
                    })
                idx += 3
                continue
        idx += 1

    return members


def parse_committee_pdf(text: str) -> dict[str, list[str]]:
    """
    委員会名簿PDFから {議員名(正規化): [委員会(役職)] } のマッピングを返す。
    """
    member_committees: dict[str, list[str]] = {}
    current_committee = ""

    for line in text.splitlines():
        line_clean = re.sub(r"\s+", " ", line).strip()

        # 委員会名を検出: ○で始まる委員会
        comm_m = re.match(r"[○■](.+)", line_clean)
        if comm_m:
            cname = normalize(comm_m.group(1))
            if "委員会" in cname:
                current_committee = cname
            else:
                current_committee = ""
            continue

        # 役職・氏名行を解析
        # 例: "委 員 長 新 村 充" or "副委員長 藤 田 悠 介"
        role_m = re.match(
            r"(委\s*員\s*長|副\s*委\s*員\s*長|委\s*員|幹\s*事\s*長|会\s*長)\s+(.+)",
            line_clean
        )
        if role_m and current_committee:
            role = normalize(role_m.group(1))
            # 名前は残りの全文字（正規化で空白除去）
            name = normalize(role_m.group(2))
            if len(name) < 2:
                continue
            if name not in member_committees:
                member_committees[name] = []
            if role in ("委員長", "副委員長", "幹事長", "会長"):
                entry = f"{current_committee}({role})"
            else:
                entry = current_committee
            if entry not in member_committees[name]:
                member_committees[name].append(entry)

    return member_committees


def try_download_photos() -> int:
    """
    議員の紹介PDFから画像を抽出する（pdfimages を使用）。
    抽出した画像を seat_N.jpg として保存する。
    戻り値: 抽出した画像数
    """
    print("  写真抽出を試みます...")
    try:
        resp = requests.get(INTRO_PDF_URL, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(resp.content)
            tmp_pdf = f.name

        with tempfile.TemporaryDirectory() as tmpdir:
            subprocess.run(
                ["pdfimages", "-j", tmp_pdf, f"{tmpdir}/img"],
                capture_output=True
            )
            imgs = sorted(Path(tmpdir).glob("img-*.*"))
            print(f"  画像 {len(imgs)} 枚を抽出")
            for idx, img in enumerate(imgs, 1):
                dest = PHOTO_DIR / f"seat_{idx}{img.suffix}"
                dest.write_bytes(img.read_bytes())

        Path(tmp_pdf).unlink(missing_ok=True)
        return len(imgs)
    except Exception as e:
        print(f"  [WARN] 写真取得スキップ: {e}")
        return 0


def main():
    print("芦別市議会 議員名簿を収集中...")

    # 議員名簿PDF
    print("  議員名簿PDF取得中...")
    member_text = download_pdf(MEMBER_PDF_URL)
    if not member_text:
        print("  [ERROR] 議員名簿PDFの取得に失敗しました")
        return

    members = parse_member_pdf(member_text)
    print(f"  {len(members)} 名の議員データを解析しました")

    # 委員会名簿PDF
    print("  委員会名簿PDF取得中...")
    committee_text = download_pdf(COMMITTEE_PDF_URL)
    committee_map: dict[str, list[str]] = {}
    if committee_text:
        committee_map = parse_committee_pdf(committee_text)
        print(f"  委員会データ: {len(committee_map)} 名分")

    # 写真取得
    n_photos = try_download_photos()

    # 出力データ組み立て
    output = []
    for m in sorted(members, key=lambda x: x["seat_number"]):
        name = m["name"]
        seat = m["seat_number"]
        committees = committee_map.get(name, [])

        # pdfimages が seat_{N}.jpg として保存済み（N = PDF内の画像順序）
        # 議員の紹介PDFが議席番号順に掲載されている前提
        photo_path = PHOTO_DIR / f"seat_{seat}.jpg"
        photo_url = f"/members/ashibetsu/seat_{seat}.jpg" if photo_path.exists() else ""

        record = {
            "seat_number": seat,
            "name": name,
            "furigana": m["furigana"],
            "party": m["party"],
            "faction": m["faction"],
            "committees": committees,
            "photo_url": photo_url,
        }
        output.append(record)
        print(
            f"  [{seat}] {name} ({m['furigana']}) "
            f"会派:{m['faction']} 党:{m['party']} "
            f"委員会:{len(committees)}件 写真:{bool(photo_url)}"
        )

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完了: {out_path}")
    print(f"取得議員数: {len(output)}名")


if __name__ == "__main__":
    main()
