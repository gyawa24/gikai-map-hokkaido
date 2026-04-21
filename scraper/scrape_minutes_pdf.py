"""
自前ホスト型PDF議事録スクレイパー（汎用）

対象: 議会サイト内にPDFを直接貼っているタイプの自治体
    （DNP/gijiroku.comのような検索システムを持たないケース）

使い方:
  python scraper/scrape_minutes_pdf.py --slug naie
  python scraper/scrape_minutes_pdf.py --slug naie --years 2024,2025
  python scraper/scrape_minutes_pdf.py --slug naie --force

出力: data/{slug}/minutes/index.json, {council_id}.json
    （DNP/gijirokuスクレイパーと同一スキーマ）

実装ノート:
  - 自治体ごとに HTML 構造が異なるので、PDF_CONFIGS に抽出ルールを登録する
  - PDFテキスト抽出は pdfplumber を利用（OCRは非対応）
  - council_id は {year}{type_flag}{回数2桁} 形式で合成
      10 = 定例会, 20 = 臨時会
      例: 令和7年第1回定例会 → 2025_10_01 → 20251001
"""

import argparse
import io
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import pdfplumber
import requests

ROOT = Path(__file__).parent.parent
MUNICIPALITIES_FILE = ROOT / "data" / "municipalities.json"
DATA_DIR = ROOT / "data"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; gikai-map-hokkaido/1.0)"}
REQUEST_INTERVAL = 1.0
DEFAULT_YEARS = ["2024", "2025"]


# ---------------------------------------------------------------------------
# 自治体別設定
# ---------------------------------------------------------------------------
# 同じ「PDF自前ホスト」でも構造は自治体ごとに違うので、ここに足していく。
# 共通化は3自治体以上で繰り返したら検討。
PDF_CONFIGS: dict[str, dict] = {
    "naie": {
        "name": "奈井江町",
        "index_url": "https://www.town.naie.hokkaido.jp/gikai/g_kaigiroku/",
        # 戦略: HTML見出しで種別・年度セクションを把握
        # <h3>定例会</h3> / <h3>臨時会</h3> で種別セクション切替
        # <h4>令和7年</h4> で年度セクション切替
        "strategy": "html_sections",
        "type_tag": "h3",
        "year_tag": "h4",
    },
    "makkari": {
        "name": "真狩村",
        "index_url": "https://www.vill.makkari.lg.jp/songikai/kaigiroku/",
        # 戦略: PDFファイル名から年度・種別・回数・日付をパース
        # 例: R7-3-10-1tei.pdf / 6-3-8-1tei.pdf
        #   令和{ey}年{mm}月{dd}日 第{seq}回{tei=定例会|rin=臨時会}
        "strategy": "filename_pattern",
        "filename_regex": r"(?:R)?(?P<ey>\d+)-(?P<mm>\d+)-(?P<dd>\d+)-(?P<seq>\d+)(?P<t>tei|rin)\.pdf",
        "era_base": 2018,
        "type_map": {"tei": "定例会", "rin": "臨時会"},
        "sort_groups": ["mm", "dd"],
        "link_text_format": "{mm:02d}月{dd:02d}日",
    },
    "yoichi": {
        "name": "余市町",
        "index_url": "https://www.town.yoichi.hokkaido.jp/gikai/kaigiroku/index.html",
        # 戦略: PDFファイル名から年度・種別・回数・日目をパース
        # 例: R7.4tei1.pdf（令和7年第4回定例会1日目）/ R06.1tei.5.pdf / R7.6rin.pdf
        # R 省略、先頭0桁の両方を吸収する
        "strategy": "filename_pattern",
        "filename_regex": r"R?0?(?P<ey>\d+)\.(?P<seq>\d+)(?P<t>tei|rin)\.?(?P<day>\d+)?\.pdf",
        "era_base": 2018,
        "type_map": {"tei": "定例会", "rin": "臨時会"},
        "sort_groups": ["day"],
        "link_text_format": "第{day}日",
    },
    "honbetsu": {
        "name": "本別町",
        "index_url": "https://www.town.honbetsu.hokkaido.jp/web/parliament/parliament04.html",
        # 戦略: ファイル名に回数情報が無いため、PDF先頭ページのタイトルから抽出
        # 例: teireikaiR7.3.pdf の PDF 1ページ目に
        #     「令和７年 第１回 本別町議会定例会会議録」と書いてある
        "strategy": "pdf_header",
        "title_regex": r"第(\d+)回[\s\S]{0,30}?(定例会|臨時会)",
        "year_regex": r"令和(\d+)年",
        "loose_year_regex": r"R0?(?P<ey>\d+)",
        "era_base": 2018,
    },
    "hokuryu": {
        "name": "北竜町",
        "index_url": "http://www.town.hokuryu.hokkaido.jp/tyousei/gikai/gikaikaigiroku/",
        # 戦略: ファイル名に回数・種別がないため PDF1ページ目から取得
        # 例: g_giroku_r7.3.11.pdf の PDF 1ページ目に
        #     「第１回北竜町議会定例会 第１号\n令和７年３月１１日...」
        # 同じ第N回定例会に複数日（第1号/第2号/第3号）ある → scheduleに展開
        "strategy": "pdf_header",
        "title_regex": r"第(\d+)回[\s\S]{0,20}?(定例会|臨時会)",
        "year_regex": r"令和(\d+)年",
        "schedule_regex": r"第(\d+)号",
        # ファイル名 g_giroku_r7.3.11.pdf → r7 を loose year として拾う
        "loose_year_regex": r"r(?P<ey>\d+)\.",
        "era_base": 2018,
    },
    "furubira": {
        "name": "古平町",
        "index_url": "https://www.town.furubira.lg.jp/town/detail.php?id=59",
        # 戦略: hokuryuと同じ形式のPDFヘッダー（第N回...定例会/臨時会 第N号）
        # ファイル名は cassette_NN_pdfNN_yyyymmdd_HHMMSS.pdf （yyyymmdd=アップロード日）
        "strategy": "pdf_header",
        "title_regex": r"第(\d+)回[\s\S]{0,20}?(定例会|臨時会)",
        "year_regex": r"令和(\d+)年",
        "schedule_regex": r"第(\d+)号",
        "loose_year_regex": r"(?P<yyyy>20\d{2})",
        "era_base": 2018,
    },
    "nanporo": {
        "name": "南幌町",
        "index_url": "https://www.town.nanporo.hokkaido.jp/about/politics/council/conference/",
        # 3階層の見出し構造: h2(年)/h3(種別)/h4(回数)、council直下に複数PDF
        # ファイル名例: r3-1t-kaigiroku.pdf / r3-1t-kaigikekka.pdf / r3-1t-ippansitumon.pdf
        # 議事録本体は kaigiroku のみ対象にする
        "strategy": "nested_html_sections",
        "year_tag": "h2",
        "type_tag": "h3",
        "council_tag": "h4",
        "pdf_filter": ["kaigiroku", "会議録"],
    },
    # ===== deep_discover v2 で新規判定した linktext_pattern =====
    # いずれも単一ページにリンクテキスト「令和N年第N回定例会/臨時会…」のPDFが並ぶ構造
    "horonobe": {
        "name": "幌延町",
        "strategy": "linktext_pattern",
        "index_url": "https://www.town.horonobe.lg.jp/www4/section/gikai/le009f0000008a13.html",
    },
    "niki": {
        "name": "仁木町",
        "strategy": "linktext_pattern",
        "index_url": "https://www.town.niki.hokkaido.jp/section/gikai/irv97600000004s6.html",
    },
    "akabira": {
        "name": "赤平市",
        "strategy": "linktext_pattern",
        "index_url": "https://www.city.akabira.hokkaido.jp/docs/2013011000349.html",
    },
    "furano": {
        "name": "富良野市",
        "strategy": "category_drilldown",
        "index_urls": {
            2025: "https://www.city.furano.hokkaido.jp/shigikai/docs/978780.html",
            2024: "https://www.city.furano.hokkaido.jp/shigikai/docs/541456.html",
        },
    },
    "otaru": {
        "name": "小樽市",
        # 例: R07-01.pdf (令和7年第1回定例会), R07-R1.pdf (令和7年第1回臨時会)
        # 末尾 -2 等は同一会期内の追加日程
        "strategy": "filename_pattern",
        "filename_regex": r"R(?P<ey>\d+)-(?P<t>R)?(?P<seq>\d+)(?:-(?P<day>\d+))?\.pdf",
        "type_map": {"r": "臨時会", "": "定例会"},
        "era_base": 2018,
        "sort_groups": ["day"],
        "link_text_format": "第{day}日",
        "index_url": "https://www.city.otaru.lg.jp/docs/2020113000634/",
    },
    "takikawa": {
        "name": "滝川市",
        # h2=council見出し「第N回定例会/臨時会」、直下のPDF=schedule（「3月3日」等）
        # h1="令和7年本会議会議録" (1年1URL)
        "strategy": "multi_index_html",
        "index_urls": {
            2025: "https://www.city.takikawa.lg.jp/page/18437.html",
        },
        "council_tag": "h2",
    },
    "taiki": {
        "name": "大樹町",
        # ファイル名 R7Teirei1.pdf, R8Rinji1.pdf (CamelCase版)
        "strategy": "filename_pattern",
        "filename_regex": r"R(?P<ey>\d+)(?P<t>Teirei|Rinji)(?P<seq>\d+)\.pdf",
        "type_map": {"teirei": "定例会", "rinji": "臨時会"},
        "era_base": 2018,
        "index_url": "https://www.town.taiki.hokkaido.jp/choseijoho/taikichogikai/1698.html",
    },
    "kiyosato": {
        "name": "清里町",
        # リンクテキスト「第2回定例会（3月10日） [PDF｜...]」形式
        "strategy": "linktext_pattern",
        "index_url": "https://www.town.kiyosato.hokkaido.jp/administration/?content=1244",
    },
    "tsubetsu": {
        "name": "津別町",
        # リンクテキスト「第1回臨時会（2月4日） [PDFファイル: ...]」形式
        "strategy": "linktext_pattern",
        "index_url": "https://www.town.tsubetsu.hokkaido.jp/choseijoho/tsubetsugikai/2/1788.html",
    },
    "shibetsu": {
        "name": "士別市",
        # 年度別ページ(R7=6029.html等)に R7-1tei-1.pdf 等のPDFが並ぶ
        "strategy": "filename_pattern",
        "filename_regex": r"R(?P<ey>\d+)-(?P<seq>\d+)(?P<t>tei|rinn)([-_](?P<day>\d+))?\.pdf",
        "type_map": {"tei": "定例会", "rinn": "臨時会"},
        "era_base": 2018,
        "sort_groups": ["day"],
        "link_text_format": "第{day}日",
        "index_urls": {
            2025: "https://www.city.shibetsu.lg.jp/gyoseisaito/shiseijoho/gikai/1/kaigirokukekka/6029.html",
            2024: "https://www.city.shibetsu.lg.jp/gyoseisaito/shiseijoho/gikai/1/kaigirokukekka/5304.html",
        },
    },
    "monbetsu": {
        "name": "紋別市",
        "strategy": "category_drilldown",
        "index_urls": {
            2025: [
                "https://mombetsu.jp/gikai/minutes/?category=233",  # 令和7年定例会
                "https://mombetsu.jp/gikai/minutes/?category=234",  # 令和7年臨時会
            ],
            2024: [
                "https://mombetsu.jp/gikai/minutes/?category=208",
                "https://mombetsu.jp/gikai/minutes/?category=209",
            ],
        },
    },
    # 以下は v2 で newly_classifiable と判定されたが手動検証で議事録本文ではなかった
    # ため対応保留:
    #   koshimizu/nakashibetsu/kaminokuni: 別カテゴリの記事だった（誤検出）
    #   yakumo/ebetsu: 議会改革小委員会等の特殊会議のみ
    #   numata/oshamambe: R2-R4の古いデータのみで2024-2025未掲載
    #   bibai: 議決結果(賛否一覧)のみで会議録本文非公開
    "setana": {
        "name": "せたな町",
        # R6/R7 サブディレクトリに各PDF、リンクテキストに全情報
        # 例: 「令和７年第１回定例会（３月３日～４月３日）.pdf」
        "strategy": "linktext_pattern",
        "index_urls": {
            2025: "https://www.town.setana.lg.jp/gikai/kaigiroku/R7/",
            2024: "https://www.town.setana.lg.jp/gikai/kaigiroku/R6/",
        },
    },
    "kikonai": {
        "name": "木古内町",
        # R7/teireikai.html と R7/rinji.html に分離
        "strategy": "linktext_pattern",
        "index_urls": {
            2025: [
                "https://www.town.kikonai.hokkaido.jp/gikai/kaigiroku/R7/teireikai.html",
                "https://www.town.kikonai.hokkaido.jp/gikai/kaigiroku/R7/rinji.html",
            ],
            # R6のみ typo で reireikai.html（木古内町側のスペルミス）
            2024: [
                "https://www.town.kikonai.hokkaido.jp/gikai/kaigiroku/R6/reireikai.html",
                "https://www.town.kikonai.hokkaido.jp/gikai/kaigiroku/R6/rinji.html",
            ],
        },
    },
    "shiriuchi": {
        "name": "知内町",
        # 年度別ディレクトリ（r07, r06）、各PDF先頭に「令和7年第1回知内町議会定例会（1日目）」
        "strategy": "pdf_header",
        "title_regex": r"第(\d+)回[\s\S]{0,20}?(定例会|臨時会)",
        "year_regex": r"令和(\d+)年",
        "schedule_regex": r"\((\d+)日目\)",
        "loose_year_regex": r"(?P<yyyy>20\d{2})",  # ファイル名 20250718... 形式
        "era_base": 2018,
        "index_urls": {
            2025: "https://www.town.shiriuchi.hokkaido.jp/chosei/gikai/kaigiroku/r07/",
            2024: "https://www.town.shiriuchi.hokkaido.jp/chosei/gikai/kaigiroku/r06/",
        },
    },
    "makubetsu": {
        "name": "幕別町",
        # 1ページに全年度、h2=令和N年の下にul/li/a (「第1回臨時会【1月16日開催】」)
        "strategy": "linktext_pattern",
        "year_tag": "h2",
        "index_urls": {None: "https://www.town.makubetsu.lg.jp/gikai/hongikai/gikaikaigiroku/1898.html"},
    },
    "hiroo": {
        "name": "広尾町",
        # 年度サブディレクトリ、リンクテキストに全情報
        # ただしリンクに <i class="..."></i> アイコンが含まれるので regex改良対応
        # 例: <a href="...kaigiroku_R7.1rin.pdf"><i></i>第1回臨時会（令和7年1月15日）</a>
        "strategy": "linktext_pattern",
        "index_urls": {
            2025: "https://www.town.hiroo.lg.jp/gikai/gikaikaigiroku/gikaikaigiroku_r07/",
            2024: "https://www.town.hiroo.lg.jp/gikai/gikaikaigiroku/gikaikaigiroku_r06/",
        },
    },
    "oketo": {
        "name": "置戸町",
        # R7_kaigi/R6_kaigi 等、リンクテキストに「第N回定例会（令和7年3月10日～18日開催）」
        "strategy": "linktext_pattern",
        "index_urls": {
            2025: "https://www.town.oketo.hokkaido.jp/gikai/kaigiroku/R7_kaigi/",
            2024: "https://www.town.oketo.hokkaido.jp/gikai/kaigiroku/R6_kaigi/",
        },
    },
    "niseko": {
        "name": "ニセコ町",
        # 年度ごとにディレクトリ分離
        # h3 council見出し: 「令和7年(2025年)第1回ニセコ町議会臨時会」等
        "strategy": "multi_index_html",
        "index_urls": {
            2025: "https://www.town.niseko.lg.jp/chosei/gikai/kaigi/r07/",
            2024: "https://www.town.niseko.lg.jp/chosei/gikai/kaigi/r06/",
        },
        "council_tag": "h3",
    },
    "nakasatsunai": {
        "name": "中札内村",
        # 年度ごとに別ディレクトリ配下にPDFが並ぶ構造
        "strategy": "multi_index_html",
        "index_urls": {
            2025: "https://www.vill.nakasatsunai.hokkaido.jp/gikai/kaigiroku/kaigiroku_R7/",
            2024: "https://www.vill.nakasatsunai.hokkaido.jp/gikai/kaigiroku/kaigiroku_R6/",
        },
        "council_tag": "h4",
        # council見出し例: 「12月定例会」「9月定例会」「第5回臨時会」「第1回臨時会」
    },
    "mukawa": {
        "name": "むかわ町",
        "index_url": "http://www.town.mukawa.lg.jp/2872.htm",
        # 戦略: ファイル名先頭に yyyymmdd、後段にR年・回数・種別
        # 例: 20240311-R06-1teirei.pdf / 20220616-17-R04-2teirei.pdf
        # 「rinji」「rinnji」の揺れあり。日付範囲 (-17) は optional で吸収
        "strategy": "filename_pattern",
        "filename_regex": r"(?P<yyyy>\d{4})(?P<mm>\d{2})(?P<dd>\d{2})(?:-\d+)?-[Rr]\d+-(?P<seq>\d+)(?P<t>teirei|rinnji|rinji)\.pdf",
        "type_map": {"teirei": "定例会", "rinji": "臨時会", "rinnji": "臨時会"},
        "sort_groups": ["mm", "dd"],
        "link_text_format": "{mm:02d}月{dd:02d}日",
    },
}

TYPE_FLAGS = {
    "定例会": 10,
    "臨時会": 20,
}
JP_ERA = [
    ("令和", 2018),  # 令和元年 = 2019
    ("平成", 1988),
    ("昭和", 1925),
]


def japanese_year_to_int(s: str) -> int | None:
    m = re.search(r"(令和|平成|昭和)\s*(\d+|元)", s)
    if not m:
        return None
    era, n = m.group(1), m.group(2)
    n_int = 1 if n == "元" else int(n)
    for era_name, base in JP_ERA:
        if era == era_name:
            return base + n_int
    return None


def era_str(year: int) -> str:
    for era_name, base in JP_ERA:
        if year > base:
            return f"{era_name}{year - base}年"
    return str(year)


# ---------------------------------------------------------------------------
# HTML走査（正規表現ベース、dep減らすためBeautifulSoup未使用）
# ---------------------------------------------------------------------------
TAG_RE = re.compile(
    r"<(?P<tag>h[1-6]|a)(?P<attrs>[^>]*)>(?P<text>[\s\S]*?)</(?P=tag)>",
    re.I,
)
HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)


def extract_pdf_links_by_html_sections(
    index_url: str, type_tag: str, year_tag: str
) -> list[dict]:
    r = requests.get(index_url, timeout=30, headers=HEADERS)
    r.raise_for_status()
    html = r.text

    current_type = None  # 定例会 / 臨時会
    current_year = None  # int (西暦)
    records: list[dict] = []

    for m in TAG_RE.finditer(html):
        tag = m.group("tag").lower()
        text = re.sub(r"<[^>]+>", "", m.group("text")).strip()
        attrs = m.group("attrs")

        if tag == type_tag.lower():
            for ttype in ("定例会", "臨時会"):
                if ttype in text:
                    current_type = ttype
                    break
            continue

        if tag == year_tag.lower():
            y = japanese_year_to_int(text)
            if y:
                current_year = y
            continue

        if tag == "a" and current_type and current_year:
            href_m = HREF_RE.search(attrs)
            if not href_m:
                continue
            href = href_m.group(1)
            if ".pdf" not in href.lower():
                continue
            full_url = urljoin(index_url, href)

            # リンクテキストから回数推定（「第N回」）
            seq_m = re.search(r"第\s*([０-９0-9]+)\s*回", text)
            seq = None
            if seq_m:
                s = seq_m.group(1)
                # 全角→半角
                s = s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
                try:
                    seq = int(s)
                except ValueError:
                    seq = None
            records.append({
                "type": current_type,
                "year": current_year,
                "seq": seq,
                "link_text": text,
                "url": full_url,
            })

    return records


def extract_pdf_links_by_filename(cfg: dict) -> list[dict]:
    """ファイル名パターンから年度・種別・回数・順序情報を抽出する戦略。

    年の取り方:
      - regex中に (?P<yyyy>\\d{4}) があれば西暦直読み
      - そうでなければ cfg["era_base"] + (?P<ey>\\d+)
    """
    # index_url（単一） or index_urls（dict: year -> url[s]）の両対応
    if "index_urls" in cfg:
        urls: list[str] = []
        for _y, u in cfg["index_urls"].items():
            urls.extend(u if isinstance(u, list) else [u])
    else:
        urls = [cfg["index_url"]]

    pattern = re.compile(cfg["filename_regex"], re.I)
    era_base = cfg.get("era_base")
    type_map = cfg["type_map"]
    sort_groups = cfg.get("sort_groups", [])
    link_text_format = cfg.get("link_text_format")

    records: list[dict] = []
    seen = set()
    for base_url in urls:
     r = requests.get(base_url, timeout=30, headers=HEADERS)
     r.raise_for_status()
     for m in re.finditer(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', r.text, re.I):
        href = m.group(1)
        full_url = urljoin(base_url, href)
        fn = href.rsplit("/", 1)[-1]
        if fn in seen:
            continue
        seen.add(fn)
        pm = pattern.search(fn)
        if not pm:
            continue
        gd = pm.groupdict()
        if gd.get("yyyy"):
            year = int(gd["yyyy"])
        elif gd.get("ey") is not None and era_base is not None:
            year = era_base + int(gd["ey"])
        else:
            continue
        seq = int(gd.get("seq") or 0) or None
        ttype = type_map.get((gd.get("t") or "").lower())
        if not ttype:
            continue

        # 数値変換しておく（int→sortやformat引数に使う）
        numeric = {}
        for k, v in gd.items():
            if v is None:
                numeric[k] = 0
                continue
            try:
                numeric[k] = int(v)
            except ValueError:
                numeric[k] = v

        sort_key = tuple(numeric.get(g, 0) for g in sort_groups)

        if link_text_format:
            try:
                link_text = link_text_format.format(**numeric)
            except Exception:
                link_text = fn
        else:
            link_text = fn

        records.append({
            "type": ttype,
            "year": year,
            "seq": seq,
            "filename": fn,
            "link_text": link_text,
            "url": full_url,
            "sort_key": sort_key,
        })
    return records


def _zen_to_half(s: str) -> str:
    return s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))


def extract_pdf_links_by_pdf_header(cfg: dict, years: list[int]) -> list[dict]:
    """PDF先頭ページのテキストから年度・種別・回数・号数を抽出する戦略。

    ファイル名からは種別・回数が判別できないケース（本別町・北竜町等）向け。
    事前に loose_year_regex でファイル名から仮年度を絞ってダウンロードする。

    - title_regex: (seq, type) の2グループを返す
    - year_regex: (era_year) の1グループを返す
    - schedule_regex: (schedule_no) の1グループ（optional、同councilの号数）
    """
    title_re = re.compile(cfg["title_regex"])
    year_re = re.compile(cfg["year_regex"])
    schedule_re = re.compile(cfg["schedule_regex"]) if cfg.get("schedule_regex") else None
    loose_re = re.compile(cfg.get("loose_year_regex", r"R(?P<ey>\d+)"), re.I)
    era_base = cfg.get("era_base", 2018)

    # index_url 単一 or index_urls (dict: year->url[s]) のどちらも対応
    if "index_urls" in cfg:
        url_year_pairs: list[tuple[str, int | None]] = []
        for y, u in cfg["index_urls"].items():
            if y is not None and not any(abs(y - t) <= 1 for t in years):
                continue
            urls_here = u if isinstance(u, list) else [u]
            for uu in urls_here:
                url_year_pairs.append((uu, y))
    else:
        url_year_pairs = [(cfg["index_url"], None)]

    target_set = set(years)
    records: list[dict] = []
    seen = set()

    for base_url, _base_year in url_year_pairs:
        r = requests.get(base_url, timeout=30, headers=HEADERS)
        r.raise_for_status()
        for m in re.finditer(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', r.text, re.I):
            href = m.group(1)
            fn = href.rsplit("/", 1)[-1]
            if fn in seen:
                continue
            seen.add(fn)

            lm = loose_re.search(fn)
            if not lm:
                continue
            lgd = lm.groupdict()
            if lgd.get("yyyy"):
                loose_year = int(lgd["yyyy"])
            elif lgd.get("ey"):
                loose_year = era_base + int(lgd["ey"])
            else:
                continue
            if not any(abs(loose_year - y) <= 1 for y in target_set):
                continue

            full_url = urljoin(base_url, href)
            print(f"    … {fn} ヘッダー確認", flush=True)
            try:
                pr = requests.get(full_url, timeout=60, headers=HEADERS)
                pr.raise_for_status()
                with pdfplumber.open(io.BytesIO(pr.content)) as pdf:
                    first_text = pdf.pages[0].extract_text() or ""
            except Exception as e:
                print(f"      ✗ ヘッダー取得失敗: {e}", flush=True)
                continue

            first_text = _zen_to_half(first_text)
            tm = title_re.search(first_text)
            ym = year_re.search(first_text)
            if not tm or not ym:
                print(f"      ✗ タイトル未マッチ: {fn}", flush=True)
                continue
            seq = int(tm.group(1))
            ttype = tm.group(2)
            year = era_base + int(ym.group(1))

            schedule_no = None
            if schedule_re:
                sm = schedule_re.search(first_text)
                if sm:
                    schedule_no = int(sm.group(1))

            link_text = f"第{schedule_no}号" if schedule_no else f"{ttype}本編"
            records.append({
                "type": ttype,
                "year": year,
                "seq": seq,
                "filename": fn,
                "link_text": link_text,
                "url": full_url,
                "sort_key": (schedule_no or 0, fn),
            })
            time.sleep(0.3)

    return records


MONTH_TO_TEIREI_SEQ = {3: 1, 6: 2, 9: 3, 12: 4}


def extract_pdf_links_by_linktext_pattern(cfg: dict, years: list[int]) -> list[dict]:
    """リンクテキストに year/seq/type 情報が全部含まれる構造向け戦略。

    各 index_url ページの <a href=".pdf">リンクテキスト</a> を走査し、
    リンクテキストから 年 (令和N年) / 回 (第N回) / 種別 (定例会|臨時会) を抽出。
    年は index_urls の key (西暦) を優先、未ヒット時のみリンクテキストから。

    cfg["year_tag"] が指定されている場合は、1ページ内で year_tag 見出し
    （例: h2「令和7年」）が現れるたびに year を切り替える（makubetsu向け）。
    このモードでは index_urls は {None: [url...]} の形式で1ページのみ指定。

    例:
      setana: 「令和７年第１回定例会（３月３日～４月３日）.pdf」
      oketo:  「第2回定例会（令和7年3月10日～18日開催）」
      makubetsu: h2=令和7年, 直下ul/li/a=「第1回臨時会【1月16日開催】」
    """
    era_re = re.compile(r"令和(\d+)年")
    seq_re = re.compile(r"第\s*(\d+)\s*回")
    type_re = re.compile(r"(定例会|臨時会)")
    year_tag = cfg.get("year_tag")

    records: list[dict] = []

    # 単一 index_url （複数年度が1ページに混在するケース）を index_urls に展開
    if "index_urls" not in cfg and "index_url" in cfg:
        cfg = dict(cfg)
        cfg["index_urls"] = {y: cfg["index_url"] for y in years}

    if year_tag:
        # 単一ページ内 year_tag (h2等) 切替モード
        urls = cfg["index_urls"].get(None) or cfg["index_urls"].get("page")
        if isinstance(urls, str):
            urls = [urls]
        tag_re = re.compile(
            r"<(?P<tag>" + year_tag + r"|a)(?P<attrs>[^>]*)>(?P<text>[\s\S]*?)</(?P=tag)>",
            re.I,
        )
        for url in urls:
            r = requests.get(url, timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
            r.raise_for_status()
            current_year = None
            for m in tag_re.finditer(r.text):
                tag = m.group("tag").lower()
                raw_inner = m.group("text")
                inner = re.sub(r"<[^>]+>", "", raw_inner).strip()
                if tag == year_tag.lower():
                    em = era_re.search(_zen_to_half(inner))
                    current_year = (2018 + int(em.group(1))) if em else None
                    continue
                if tag == "a" and current_year in years:
                    attrs = m.group("attrs")
                    href_m = HREF_RE.search(attrs)
                    if not href_m:
                        continue
                    href = href_m.group(1)
                    if ".pdf" not in href.lower():
                        continue
                    text = _zen_to_half(re.sub(r"\s+", " ", inner))
                    tm = type_re.search(text)
                    sm = seq_re.search(text)
                    if not tm or not sm:
                        continue
                    records.append({
                        "type": tm.group(1),
                        "year": current_year,
                        "seq": int(sm.group(1)),
                        "filename": href.rsplit("/", 1)[-1],
                        "link_text": text[:60],
                        "url": urljoin(url, href),
                        "sort_key": (href,),
                    })
        return records

    for year, urls in cfg["index_urls"].items():
        if year not in years:
            continue
        url_list = urls if isinstance(urls, list) else [urls]
        for url in url_list:
            r = requests.get(url, timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
            r.raise_for_status()
            # リンクテキストに <i class=...> 等のアイコンタグが入るケースがあるので
            # [\s\S]{,300}? で受けて内部のHTMLタグは後で除去する
            for m in re.finditer(
                r'<a[^>]+href=["\']([^"\']+\.pdf)["\'][^>]*>([\s\S]{1,300}?)</a>',
                r.text,
                re.I,
            ):
                href = m.group(1)
                raw = re.sub(r"<[^>]+>", "", m.group(2))
                text = _zen_to_half(re.sub(r"\s+", " ", raw).strip())
                tm = type_re.search(text)
                sm = seq_re.search(text)
                if not tm or not sm:
                    continue
                # link_textの令和年が優先、なければ index_urls のkey
                em = era_re.search(text)
                actual_year = (2018 + int(em.group(1))) if em else year
                if actual_year != year:
                    # 別の年度PDFが混入する可能性 → skip（年度ディレクトリ境界尊重）
                    continue
                fn = href.rsplit("/", 1)[-1]
                # 単一URLを複数年度で回す場合の重複排除
                if any(r["filename"] == fn for r in records):
                    continue
                records.append({
                    "type": tm.group(1),
                    "year": year,
                    "seq": int(sm.group(1)),
                    "filename": fn,
                    "link_text": text[:60],
                    "url": urljoin(url, href),
                    "sort_key": (href,),
                })
    return records


def extract_pdf_links_by_multi_index_html(cfg: dict, years: list[int]) -> list[dict]:
    """年度ごとの別ディレクトリ配下にPDFが並ぶ構造に対応する戦略。

    各 index_url 内で council_tag（h4等）をcouncilヘッダーとしてグルーピングし、
    その直下のPDFリンクを日程として拾う。
    council見出し例:
      - 「12月定例会」 → 定例会、月12
      - 「9月定例会」  → 定例会、月9
      - 「第5回臨時会」 → 臨時会、第5回
    """
    index_urls: dict = cfg["index_urls"]
    council_tag = cfg["council_tag"].lower()
    records: list[dict] = []

    for year, url in index_urls.items():
        if year not in years:
            continue
        r = requests.get(url, timeout=30, headers=HEADERS)
        r.encoding = r.apparent_encoding or "utf-8"
        r.raise_for_status()
        html = r.text

        current_council = None  # {"type", "seq", "title"}
        current_pdfs = []

        def finalize():
            nonlocal current_council, current_pdfs
            if current_council and current_pdfs:
                for order, (fn, full) in enumerate(current_pdfs, 1):
                    records.append({
                        "type": current_council["type"],
                        "year": year,
                        "seq": current_council["seq"],
                        "filename": fn,
                        "link_text": fn.replace(".pdf", ""),
                        "url": full,
                        "sort_key": (order, fn),
                    })
            current_council = None
            current_pdfs = []

        for m in TAG_RE.finditer(html):
            tag = m.group("tag").lower()
            text = re.sub(r"<[^>]+>", "", m.group("text")).strip()
            attrs = m.group("attrs")

            if tag == council_tag:
                finalize()
                text_half = _zen_to_half(text)
                # まず「第N回」があればそちらを優先（例: ニセコ「第2回ニセコ町議会定例会」）
                sm = re.search(r"第\s*(\d+)\s*回", text_half)
                if "定例会" in text:
                    if sm:
                        current_council = {"type": "定例会", "seq": int(sm.group(1)), "title": text}
                    else:
                        # フォールバック: 月→回数（中札内「12月定例会」形式）
                        mm_match = re.search(r"(\d+)\s*月", text_half)
                        if mm_match:
                            mm = int(mm_match.group(1))
                            seq = MONTH_TO_TEIREI_SEQ.get(mm, mm)
                            current_council = {"type": "定例会", "seq": seq, "title": text}
                elif "臨時会" in text:
                    if sm:
                        current_council = {"type": "臨時会", "seq": int(sm.group(1)), "title": text}
                continue

            if tag == "a" and current_council:
                href_m = HREF_RE.search(attrs)
                if not href_m:
                    continue
                href = href_m.group(1)
                if ".pdf" not in href.lower():
                    continue
                full = urljoin(url, href)
                fn = href.rsplit("/", 1)[-1]
                current_pdfs.append((fn, full))

        finalize()

    return records


def extract_pdf_links_by_nested_html_sections(cfg: dict, years: list[int]) -> list[dict]:
    """3階層の見出し構造（year/type/council）+ councilごとの複数PDF対応。

    例: 南幌町
      h2 「令和7年（2025年）」 → year
      h3 「定例会」/「臨時会」 → type
      h4 「第1回定例会」/「第1回臨時会」 → council (seq)
      その下のPDFリンクから pdf_filter にマッチしたものを schedule として拾う
    """
    r = requests.get(cfg["index_url"], timeout=30, headers=HEADERS)
    r.raise_for_status()
    html = r.text
    year_tag = cfg["year_tag"].lower()
    type_tag = cfg["type_tag"].lower()
    council_tag = cfg["council_tag"].lower()
    pdf_filter = cfg.get("pdf_filter", "")
    years_set = set(years)

    current_year: int | None = None
    current_type: str | None = None
    current_seq: int | None = None
    current_pdfs: list[tuple[str, str]] = []
    records: list[dict] = []

    def finalize():
        nonlocal current_pdfs
        if (
            current_year in years_set
            and current_type
            and current_seq is not None
            and current_pdfs
        ):
            for order, (fn, full) in enumerate(current_pdfs, 1):
                records.append({
                    "type": current_type,
                    "year": current_year,
                    "seq": current_seq,
                    "filename": fn,
                    "link_text": fn.replace(".pdf", ""),
                    "url": full,
                    "sort_key": (order, fn),
                })
        current_pdfs = []

    for m in TAG_RE.finditer(html):
        tag = m.group("tag").lower()
        text = re.sub(r"<[^>]+>", "", m.group("text")).strip()
        attrs = m.group("attrs")
        text_half = _zen_to_half(text)

        if tag == year_tag:
            finalize()
            current_seq = None
            ym = re.search(r"(\d{4})\s*年", text)
            if ym:
                current_year = int(ym.group(1))
            else:
                jy = japanese_year_to_int(text)
                if jy:
                    current_year = jy
            continue

        if tag == type_tag:
            finalize()
            current_seq = None
            for ttype in ("定例会", "臨時会"):
                if ttype in text:
                    current_type = ttype
                    break
            continue

        if tag == council_tag:
            finalize()
            sm = re.search(r"第\s*(\d+)\s*回", text_half)
            if sm:
                current_seq = int(sm.group(1))
            else:
                current_seq = None
            continue

        if tag == "a" and current_seq is not None:
            href_m = HREF_RE.search(attrs)
            if not href_m:
                continue
            href = href_m.group(1)
            if ".pdf" not in href.lower():
                continue
            if pdf_filter:
                filters = pdf_filter if isinstance(pdf_filter, list) else [pdf_filter]
                haystack = f"{href.lower()} {text}"
                if not any(kw.lower() in haystack for kw in filters):
                    continue
            full = urljoin(cfg["index_url"], href)
            fn = href.rsplit("/", 1)[-1]
            # 同一URLの重複排除（「会議録」「ダウンロード」等の並列リンク対応）
            if any(u == full for _, u in current_pdfs):
                continue
            current_pdfs.append((fn, full))

    finalize()
    return records


def extract_pdf_links_by_category_drilldown(cfg: dict, years: list[int]) -> list[dict]:
    """カテゴリインデックスから会議詳細ページへ2段階クロールしてPDFを取得する戦略。

    使い所: 富良野市のように
      Step1: index ページに「令和7年 第1回富良野市議会定例会(会期...)」のような
             詳細ページへのリンクが並ぶ
      Step2: 各詳細ページに「令和7年第1回定例会 会議録 第1号(令和7年...)」の
             PDF が並ぶ

    config:
      index_url or index_urls: インデックスページ
      （詳細リンクは「令和N年」「第N回」「(定例会|臨時会)」を全部含むもの）
    """
    era_re = re.compile(r"令和(\d+)年")
    seq_re = re.compile(r"第\s*(\d+)\s*回")
    type_re = re.compile(r"(定例会|臨時会)")
    schedule_re = re.compile(r"第(\d+)号")
    pdf_filter = cfg.get("pdf_filter", ["会議録", "kaigiroku"])
    if isinstance(pdf_filter, str):
        pdf_filter = [pdf_filter]

    if "index_urls" in cfg:
        index_urls = cfg["index_urls"]
    else:
        index_urls = {y: cfg["index_url"] for y in years}

    detail_targets: list[dict] = []
    for year, urls in index_urls.items():
        if year is not None and year not in years:
            continue
        url_list = urls if isinstance(urls, list) else [urls]
        for url in url_list:
            r = requests.get(url, timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
            r.raise_for_status()
            for m in re.finditer(
                r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>([\s\S]{1,200}?)</a>',
                r.text,
                re.I,
            ):
                href = m.group(1)
                if href.startswith("#") or href.startswith("javascript:"):
                    continue
                text = _zen_to_half(re.sub(r"<[^>]+>", "", m.group(2)).strip())
                em = era_re.search(text)
                tm = type_re.search(text)
                sm = seq_re.search(text)
                if not (em and tm and sm):
                    continue
                actual_year = 2018 + int(em.group(1))
                if actual_year not in years:
                    continue
                full = urljoin(url, href)
                detail_targets.append({
                    "url": full,
                    "year": actual_year,
                    "seq": int(sm.group(1)),
                    "type": tm.group(1),
                    "title": text[:60],
                })

    print(f"    → 詳細ページ: {len(detail_targets)}件", flush=True)

    records: list[dict] = []
    seen_files = set()
    for d in detail_targets:
        try:
            r = requests.get(d["url"], timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
        except Exception as e:
            print(f"      ✗ 詳細取得失敗 {d['url']}: {e}", flush=True)
            continue
        time.sleep(0.3)
        for m in re.finditer(
            r'<a[^>]+href=["\']([^"\']+\.pdf)["\'][^>]*>([\s\S]{0,300}?)</a>',
            r.text,
            re.I,
        ):
            href = m.group(1)
            text = _zen_to_half(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(2))).strip())
            haystack = f"{href.lower()} {text}"
            if not any(kw.lower() in haystack for kw in pdf_filter):
                continue
            fn = href.rsplit("/", 1)[-1]
            if fn in seen_files:
                continue
            seen_files.add(fn)
            sch = schedule_re.search(text)
            schedule_no = int(sch.group(1)) if sch else None
            records.append({
                "type": d["type"],
                "year": d["year"],
                "seq": d["seq"],
                "filename": fn,
                "link_text": text[:60],
                "url": urljoin(d["url"], href),
                "sort_key": (schedule_no or 0, fn),
            })
    return records


def extract_pdf_links(cfg: dict, years: list[int] | None = None) -> list[dict]:
    strategy = cfg.get("strategy", "html_sections")
    if strategy == "html_sections":
        return extract_pdf_links_by_html_sections(
            cfg["index_url"], cfg["type_tag"], cfg["year_tag"]
        )
    if strategy == "filename_pattern":
        return extract_pdf_links_by_filename(cfg)
    if strategy == "pdf_header":
        return extract_pdf_links_by_pdf_header(cfg, years or [])
    if strategy == "multi_index_html":
        return extract_pdf_links_by_multi_index_html(cfg, years or [])
    if strategy == "linktext_pattern":
        return extract_pdf_links_by_linktext_pattern(cfg, years or [])
    if strategy == "nested_html_sections":
        return extract_pdf_links_by_nested_html_sections(cfg, years or [])
    if strategy == "category_drilldown":
        return extract_pdf_links_by_category_drilldown(cfg, years or [])
    raise ValueError(f"unknown strategy: {strategy}")


# ---------------------------------------------------------------------------
# PDFテキスト抽出
# ---------------------------------------------------------------------------
def extract_pdf_text(url: str, max_pages: int = 500) -> str:
    r = requests.get(url, timeout=60, headers=HEADERS)
    r.raise_for_status()
    with pdfplumber.open(io.BytesIO(r.content)) as pdf:
        pages = pdf.pages[:max_pages]
        texts = []
        for p in pages:
            t = p.extract_text() or ""
            if t.strip():
                texts.append(t)
        return "\n\n".join(texts).strip()


# ---------------------------------------------------------------------------
# メイン処理
# ---------------------------------------------------------------------------
def scrape_one(slug: str, years: list[int], force: bool) -> int:
    cfg = PDF_CONFIGS.get(slug)
    if not cfg:
        print(f"  [{slug}] 設定未登録", flush=True)
        return 0

    src = cfg.get("index_url") or cfg.get("index_urls") or "-"
    print(f"  [{slug}] PDFリスト取得: {src}", flush=True)
    records = extract_pdf_links(cfg, years)
    print(f"    → {len(records)}件のPDFを検出", flush=True)

    # 対象年のみフィルタ
    target = [r for r in records if r["year"] in years]
    print(f"    → 対象年({years})のPDF: {len(target)}件", flush=True)

    out_dir = DATA_DIR / slug / "minutes"
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path = out_dir / "index.json"
    index_map: dict[int, dict] = {}
    if index_path.exists() and not force:
        try:
            existing = json.loads(index_path.read_text(encoding="utf-8"))
            index_map = {x["council_id"]: x for x in existing}
        except Exception:
            pass

    # (year, type, seq) が同じPDFはひとつのcouncilに集約
    # 日付順のschedulesとしてぶら下げる
    groups: dict[tuple[int, str, int], list[dict]] = {}
    for r in target:
        key = (r["year"], r["type"], r["seq"] or 99)
        groups.setdefault(key, []).append(r)

    saved = 0
    for (year, ttype, seq), items in groups.items():
        type_flag = TYPE_FLAGS.get(ttype, 90)
        council_id = year * 10000 + type_flag * 100 + seq
        council_file = out_dir / f"{council_id}.json"
        name = f"{era_str(year)}第{seq}回{ttype}"

        if council_file.exists() and not force:
            print(f"    [skip] {council_id} {name} (既存)", flush=True)
            index_map[council_id] = {
                "council_id": council_id,
                "name": name,
                "year": str(year),
                "japanese_year": era_str(year),
                "type_label": f"全会議 > 本会議 > {ttype}",
                "file": f"{council_id}.json",
                "schedule_count": len(items),
            }
            continue

        # sort_key があればそれでソート、なければリンクテキストで安定化
        items.sort(key=lambda x: x.get("sort_key") or x.get("filename", ""))
        print(f"    [{council_id}] {name} 日程{len(items)}件 取得...", flush=True)

        schedules = []
        for idx, r in enumerate(items, 1):
            try:
                text = extract_pdf_text(r["url"])
                print(f"      ✓ {r['link_text']} ({len(text)}文字)", flush=True)
            except Exception as e:
                print(f"      ✗ {r['link_text']}: {e}", flush=True)
                text = ""
            schedules.append({
                "schedule_id": idx,
                "name": r["link_text"] or f"第{idx}日",
                "page_no": idx,
                "minutes": [{
                    "minute_id": 1,
                    "title": r["link_text"] or f"第{idx}日",
                    "minute_type": "本会議",
                    "text": text,
                    "source_url": r["url"],
                }],
            })
            time.sleep(REQUEST_INTERVAL)

        council_data = {
            "council_id": council_id,
            "name": name,
            "year": str(year),
            "japanese_year": era_str(year),
            "type_label": f"全会議 > 本会議 > {ttype}",
            "schedules": schedules,
        }
        council_file.write_text(
            json.dumps(council_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        index_map[council_id] = {
            "council_id": council_id,
            "name": name,
            "year": str(year),
            "japanese_year": era_str(year),
            "type_label": f"全会議 > 本会議 > {ttype}",
            "file": f"{council_id}.json",
            "schedule_count": len(items),
        }
        saved += 1

    # index.json 保存
    index_list = sorted(
        index_map.values(),
        key=lambda x: (x["year"], x["council_id"]),
        reverse=True,
    )
    index_path.write_text(
        json.dumps(index_list, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  ✓ 完了: {saved}件取得 / 全{len(index_list)}件 → {out_dir}", flush=True)
    return saved


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", nargs="+", required=True)
    ap.add_argument("--years", default=",".join(DEFAULT_YEARS))
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    years = [int(y) for y in args.years.split(",") if y.strip()]
    for slug in args.slug:
        print(f"=== {slug} (years={years}) ===", flush=True)
        try:
            scrape_one(slug, years, args.force)
        except Exception as e:
            print(f"  ✗ エラー: {e}", flush=True)
            import traceback; traceback.print_exc()
    return 0


if __name__ == "__main__":
    sys.exit(main())
