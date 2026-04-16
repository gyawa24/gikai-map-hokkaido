"""
秩父別町議会 議員名簿スクレイパー
出力: data/chippubetsu/members.json

公式サイトの議員紹介ページにはPDFリンクのみが掲載されているため、
PDF を pdfplumber で座標ベースに抽出する。
"""

import json
import re
import unicodedata
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.chippubetsu.hokkaido.jp"
INDEX_URL = f"{BASE_URL}/category/detail.html?category=town&content=121"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "chippubetsu"
SITE_OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "chippubetsu"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def find_pdf_url() -> str | None:
    resp = requests.get(INDEX_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        if href.lower().endswith(".pdf") and ("議員" in text or "名簿" in text):
            if href.startswith("http"):
                return href
            if href.startswith("/"):
                return BASE_URL + href
            # ../common/img/... のような相対パス
            return BASE_URL + "/" + href.lstrip("./")
    return None


def normalize(text: str) -> str:
    """全角数字→半角、全角スペース→半角、空白除去用の正規化"""
    return unicodedata.normalize("NFKC", text)


def parse_cell(lines: list[str]) -> dict | None:
    """
    1セル分の行リストから議員データを抽出する。

    典型的な行構成:
      議席番号 N
      ふりがな
      役職 氏名 (年齢 歳)
      当選N回・無所属・職業
      委員長 等（任意）
    """
    if not lines:
        return None

    # 各行を正規化（全角→半角、スペース除去）
    norm_lines = [normalize(line) for line in lines]
    joined = " ".join(norm_lines)

    # 議席番号
    m_seat = re.search(r"議席番号\s*(\d+)", joined)
    if not m_seat:
        return None
    seat_number = int(m_seat.group(1))

    # ふりがな（ひらがなのみで構成される行を探す）
    furigana = ""
    for line in norm_lines:
        stripped = re.sub(r"\s+", "", line)
        if stripped and re.fullmatch(r"[ぁ-ゖー]+", stripped):
            furigana = stripped
            break

    # 役職と氏名
    role = ""
    name = ""
    for line in norm_lines:
        # 役職（議長 / 副議長 / 議員）+ 氏名 + (年齢 歳)
        m = re.search(r"(議\s*長|副議長|議\s*員)\s*([^\s(]+(?:\s+[^\s(]+)?)\s*\(", line)
        if m:
            role = re.sub(r"\s+", "", m.group(1))
            name = re.sub(r"\s+", "", m.group(2))
            break

    if not name:
        return None

    # 当選回数・政党・職業
    party = ""
    occupation = ""
    for line in norm_lines:
        # 中黒は ・ または ･
        m = re.search(r"当選\s*([0-9]+)\s*回[・･]\s*([^・･\s]+)[・･]\s*(.+)", line)
        if m:
            party = m.group(2)
            occupation = m.group(3).strip()
            break

    # 委員会（委員長等）
    committees: list[str] = []
    for line in norm_lines:
        stripped = re.sub(r"\s+", "", line)
        if "委員会" in stripped and "当選" not in stripped and "議席" not in stripped:
            committees.append(stripped)

    # 役職も委員会扱いで保持（議長/副議長は faction 的役職として残す）
    faction = role if role in ("議長", "副議長") else ""

    return {
        "seat_number": seat_number,
        "name": name,
        "furigana": furigana,
        "party": party,
        "faction": faction,
        "committees": committees,
        "_occupation": occupation,
    }


def cluster_values(values: list[float], tolerance: float) -> list[float]:
    """近接する数値をクラスタ化し代表値（平均）のリストを返す"""
    if not values:
        return []
    sorted_vals = sorted(values)
    clusters: list[list[float]] = [[sorted_vals[0]]]
    for v in sorted_vals[1:]:
        if v - clusters[-1][-1] <= tolerance:
            clusters[-1].append(v)
        else:
            clusters.append([v])
    return [sum(c) / len(c) for c in clusters]


def extract_members_from_pdf(pdf_path: Path) -> list[dict]:
    members: list[dict] = []
    seen_seats: set[int] = set()
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(keep_blank_chars=False, use_text_flow=False)

            # 「議席番号」の出現位置からセルの基準点を取得
            seat_anchors = [
                w for w in words
                if "議席番号" in w["text"] and w["top"] > 200
            ]
            if not seat_anchors:
                continue

            # 行・列の基準座標を近接クラスタで抽出
            top_centers = cluster_values([w["top"] for w in seat_anchors], tolerance=20)
            left_centers = cluster_values([w["x0"] for w in seat_anchors], tolerance=50)

            # 各セルの境界はアンカー位置を左/上端、次のアンカーを右/下端に
            def make_bounds(centers: list[float], end: float, lead: float) -> list[tuple[float, float]]:
                bounds = []
                for i, c in enumerate(centers):
                    lo = max(0.0, c - lead)
                    hi = centers[i + 1] - lead if i + 1 < len(centers) else end
                    bounds.append((lo, hi))
                return bounds

            row_bounds = make_bounds(top_centers, page.height, lead=10)
            col_bounds = make_bounds(left_centers, page.width, lead=5)

            for top, bottom in row_bounds:
                for left, right in col_bounds:
                    cell_words = [
                        w for w in words
                        if top <= w["top"] < bottom and left <= w["x0"] < right
                    ]
                    if not cell_words:
                        continue

                    # y 座標を行クラスタにまとめてからグループ化
                    ys = [w["top"] for w in cell_words]
                    line_centers = cluster_values(ys, tolerance=3)

                    def assign_line(y: float) -> int:
                        return min(
                            range(len(line_centers)),
                            key=lambda i: abs(line_centers[i] - y),
                        )

                    grouped: dict[int, list] = {}
                    for w in cell_words:
                        idx = assign_line(w["top"])
                        grouped.setdefault(idx, []).append(w)

                    lines: list[str] = []
                    for idx in sorted(grouped.keys()):
                        line_words = sorted(grouped[idx], key=lambda w: w["x0"])
                        lines.append(" ".join(w["text"] for w in line_words))

                    parsed = parse_cell(lines)
                    if parsed and parsed["seat_number"] not in seen_seats:
                        members.append(parsed)
                        seen_seats.add(parsed["seat_number"])

    members.sort(key=lambda m: m["seat_number"])
    return members


def main() -> None:
    print("秩父別町議会 議員名簿を収集中...")
    pdf_url = find_pdf_url()
    if not pdf_url:
        print("  [ERROR] 議員名簿PDFのリンクが見つかりませんでした")
        return
    print(f"  PDF URL: {pdf_url}")

    pdf_path = Path("/tmp/chippubetsu_members.pdf")
    pdf_resp = requests.get(pdf_url, headers=HEADERS, timeout=30)
    pdf_resp.raise_for_status()
    pdf_path.write_bytes(pdf_resp.content)

    members = extract_members_from_pdf(pdf_path)
    if not members:
        print("  [ERROR] PDF から議員データを抽出できませんでした")
        return

    # 内部用フィールド _occupation を除去
    cleaned = []
    for m in members:
        m.pop("_occupation", None)
        m["photo_url"] = ""
        cleaned.append(m)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"members": cleaned, "source_url": pdf_url}
    for path in (OUTPUT_DIR / "members.json", SITE_OUTPUT_DIR / "members.json"):
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {path}")

    print(f"取得議員数: {len(cleaned)}名")
    for m in cleaned:
        print(
            f"    席{m['seat_number']:2d} {m['name']} "
            f"({m['furigana']}) {m['faction']} {m['committees']}"
        )


if __name__ == "__main__":
    main()
