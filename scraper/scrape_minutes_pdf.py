"""
自前ホスト型PDF議事録スクレイパー（汎用）

対象: 議会サイト内にPDFを直接貼っているタイプの自治体
    （DNP/gijiroku.comのような検索システムを持たないケース）

使い方:
  python scraper/scrape_minutes_pdf.py --slug naie
  python scraper/scrape_minutes_pdf.py --slug naie --years 2024,2025
  python scraper/scrape_minutes_pdf.py --slug naie --force
  python scraper/scrape_minutes_pdf.py --slug shosanbetsu --ocr-fallback --ocr-psm 11 --ocr-max-pages 3

出力: data/{slug}/minutes/index.json, {council_id}.json
    （DNP/gijirokuスクレイパーと同一スキーマ）

実装ノート:
  - 自治体ごとに HTML 構造が異なるので、PDF_CONFIGS に抽出ルールを登録する
  - PDFテキスト抽出は pdfplumber を利用
  - 画像系PDFは明示的に --ocr-fallback を指定したときだけ Tesseract OCR を試す
  - council_id は {year}{type_flag}{回数2桁} 形式で合成
      10 = 定例会, 20 = 臨時会
      例: 令和7年第1回定例会 → 2025_10_01 → 20251001
"""

import argparse
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import date
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

import pdfplumber
import requests

ROOT = Path(__file__).parent.parent
MUNICIPALITIES_FILE = ROOT / "data" / "municipalities.json"
DATA_DIR = ROOT / "data"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; gikai-map-hokkaido/1.0)"}
REQUEST_INTERVAL = 1.0


def default_target_years(today: date | None = None) -> list[str]:
    current_year = (today or date.today()).year
    return [str(year) for year in range(current_year - 2, current_year + 1)]


DEFAULT_YEARS = default_target_years()


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
        "index_url": "https://www.town.hokuryu.hokkaido.jp/chosei/6551/",
        # 戦略: ファイル名に回数・種別がないため PDF1ページ目から取得
        # 例: g_giroku_r7.3.11.pdf の PDF 1ページ目に
        #     「第１回北竜町議会定例会 第１号\n令和７年３月１１日...」
        # 同じ第N回定例会に複数日（第1号/第2号/第3号）ある → scheduleに展開
        "strategy": "pdf_header",
        "title_regex": r"第(\d+)回[\s\S]{0,20}?(定例会|臨時会)",
        "year_regex": r"令和(\d+)年",
        "schedule_regex": r"第(\d+)号",
        # 旧・現行サイトのファイル名から元号年を loose year として拾う
        "loose_year_regex": r"r(?P<ey>\d+)[.-]",
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
            2026: "https://www.city.furano.hokkaido.jp/shigikai/docs/1885854.html",
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
    "abashiri": {
        "name": "網走市",
        # リンクテキスト「7年第3回定例会 [PDFファイル／...]」形式（令和省略）
        "strategy": "linktext_pattern",
        "index_urls": {
            2025: "https://www.city.abashiri.hokkaido.jp/site/gikai/1568.html",
            2024: "https://www.city.abashiri.hokkaido.jp/site/gikai/1568.html",
        },
    },
    "shiraoi": {
        "name": "白老町",
        # index /docs/6603.html のリンクテキストは「会議録へ」のみで council情報なし
        # 詳細ページの H1 「令和7年白老町議会定例会3月会議」から year/type/月会議 を抽出
        "strategy": "category_drilldown",
        "index_urls": {
            2025: "https://www.town.shiraoi.hokkaido.jp/docs/6603.html",
            2024: "https://www.town.shiraoi.hokkaido.jp/docs/5585.html",
        },
        "use_detail_title": True,
        "pdf_filter": ["会議", "号"],
    },
    "yubari": {
        "name": "夕張市",
        # /site/gikai/6897.html (R7) に「第1回定例市議会 3月5日」等のPDFがフラット並び
        "strategy": "linktext_pattern",
        "year_from_index": True,
        "index_urls": {
            2026: "https://www.city.yubari.lg.jp/site/gikai/10007.html",
            2025: "https://www.city.yubari.lg.jp/site/gikai/6897.html",
            2024: "https://www.city.yubari.lg.jp/site/gikai/3350.html",
        },
    },
    "mikasa": {
        "name": "三笠市",
        # /assembly/detail/00016223.html (R7) に「会議録 令和7年 第4回定例会 12月18日」
        "strategy": "linktext_pattern",
        "index_urls": {
            2026: "https://www.city.mikasa.hokkaido.jp/assembly/detail/00016816.html",
            2025: "https://www.city.mikasa.hokkaido.jp/assembly/detail/00016223.html",
            2024: "https://www.city.mikasa.hokkaido.jp/assembly/detail/00014600.html",
        },
    },
    "sunagawa": {
        "name": "砂川市",
        # /kaigiroku/{year}/index.html に council URL リスト、詳細ページ内に 第N号PDF
        "strategy": "category_drilldown",
        "index_urls": {
            2026: "https://www.city.sunagawa.hokkaido.jp/shisei/shigikai/kaigiroku/2026/index.html",
            2025: "https://www.city.sunagawa.hokkaido.jp/shisei/shigikai/kaigiroku/2025/index.html",
            2024: "https://www.city.sunagawa.hokkaido.jp/shisei/shigikai/kaigiroku/2024/index.html",
        },
        "pdf_filter": ["dai", "第", "mokuji", "gou", "号"],  # PDFファイル名・テキストに含まれる
    },
    "bibai": {
        "name": "美唄市",
        # /site/gikai/24889.html (R7) から council サブページ (/24887.html等)
        # サブページ内に「目次」「1月30日」形式のPDF
        "strategy": "category_drilldown",
        "index_urls": {
            2026: "https://www.city.bibai.hokkaido.jp/site/gikai/29609.html",
            2025: "https://www.city.bibai.hokkaido.jp/site/gikai/24889.html",
            2024: "https://www.city.bibai.hokkaido.jp/site/gikai/20254.html",
        },
        "pdf_filter": ["月", "目次", "号"],
    },
    "abira": {
        "name": "安平町",
        # indexページに「令和N年第N回安平町議会定例会/臨時会」のリンク、
        # 詳細ページ(/gyosei/kaigiroku/NNNN)に会議録PDF
        "strategy": "category_drilldown",
        "index_url": "https://www.town.abira.lg.jp/gyosei/kaigiroku",
        "pdf_filter": ["会議録", "kaigiroku"],
    },
    "shimizu": {
        "name": "清水町",
        # 年度ページ → 議事日程表 → 「当日の全会議録へ」HTML本文。
        # PDFではないが本文が公式HTMLで公開されているため minutes スキーマへ変換する。
        "strategy": "html_daily_minutes",
        "index_urls": {
            2025: "https://www.town.shimizu.hokkaido.jp/gikai/proceeding/7/",
            2024: "https://www.town.shimizu.hokkaido.jp/gikai/proceeding/6/",
        },
    },
    "utashinai": {
        "name": "歌志内市",
        # 1ページに全年度のh2「令和7年 第3回定例会」と直下PDFが並ぶ
        "strategy": "multi_index_html",
        "index_urls": {None: "https://www.city.utashinai.hokkaido.jp/hotnews/detail/00003817.html"},
        "council_tag": "h2",
        "year_from_heading": True,
    },
    "shikaoi": {
        "name": "鹿追町",
        # R7/ R6/ ディレクトリに直接PDF配置
        "strategy": "multi_index_html",
        "index_urls": {
            2025: "https://www.town.shikaoi.lg.jp/gikai/gijiroku/R7/",
            2024: "https://www.town.shikaoi.lg.jp/gikai/gijiroku/R6/",
        },
        "council_tag": "h3",
    },
    "takikawa": {
        "name": "滝川市",
        # h2=council見出し「第N回定例会/臨時会」、直下のPDF=schedule（「3月3日」等）
        # h1="令和7年本会議会議録" (1年1URL)
        "strategy": "multi_index_html",
        "index_urls": {
            2026: "https://www.city.takikawa.lg.jp/page/24011.html",
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
        "index_urls": {
            2026: "https://www.town.kiyosato.hokkaido.jp/administration/?content=2699",
            2025: "https://www.town.kiyosato.hokkaido.jp/administration/?content=1856",
            # 正規の2024年ページは content=1503。既存2024データが2023年ページ由来のため、
            # 隔離修正が終わるまでは自動更新対象へ戻さない。
        },
        "year_from_index": True,
    },
    "kunneppu": {
        "name": "訓子府町",
        # 年度ページに「令和N年第M回定例会/臨時会会議録（M月D日）」のPDFが並ぶ。
        "strategy": "linktext_pattern",
        "index_urls": {
            2025: "https://www.town.kunneppu.hokkaido.jp/gikai/kaigiroku/10989.html",
            2024: "https://www.town.kunneppu.hokkaido.jp/gikai/kaigiroku/9800.html",
        },
    },
    "tsubetsu": {
        "name": "津別町",
        # 年ページのPDFに加え、3月定例会だけは詳細ページに日別PDFが並ぶ。
        "strategy": "linktext_pattern_drilldown",
        "index_urls": {
            2026: "https://www.town.tsubetsu.hokkaido.jp/choseijoho/tsubetsugikai/2/4688.html",
            2025: "https://www.town.tsubetsu.hokkaido.jp/choseijoho/tsubetsugikai/2/4140.html",
            # 正規の2024年ページは末尾3659.html。既存2024データが平成22年ページ由来のため、
            # 隔離修正が終わるまでは自動更新対象へ戻さない。
        },
        "year_from_index": True,
        "detail_pdf_filter": [".pdf"],
    },
    "shikaoi": {
        "name": "鹿追町",
        # ファイル名 20251209giziroku.pdf / 20251028rinzi.pdf / 20250918kessan.pdf 形式
        # 月を seq として扱い、同月のPDFを同一councilに集約
        "strategy": "filename_pattern",
        "filename_regex": r"(?P<yyyy>\d{4})(?P<seq>\d{2})(?P<dd>\d{2})(?P<t>giziroku|rinzi|kessan|kaigiroku|yosansinsa)\w*\.pdf",
        "type_map": {
            "giziroku": "定例会", "kaigiroku": "定例会",
            "rinzi": "臨時会",
            "kessan": "決算特別委員会",
            "yosansinsa": "予算審査特別委員会",
        },
        "sort_groups": ["dd"],
        "link_text_format": "{seq:02d}月{dd:02d}日",
        "index_urls": {
            2025: "https://www.town.shikaoi.lg.jp/gikai/gijiroku/R7/",
            2024: "https://www.town.shikaoi.lg.jp/gikai/gijiroku/R6/",
        },
    },
    "shibetsu": {
        "name": "士別市",
        # 年度別ページ(R7=6029.html等)に R7-1tei-1.pdf 等のPDFが並ぶ
        "strategy": "filename_pattern",
        "filename_regex": r"R(?P<ey>\d+)-(?P<seq>\d+)(?P<t>tei|rinn?)([-_](?P<day>\d+))?\.pdf",
        "type_map": {"tei": "定例会", "rin": "臨時会", "rinn": "臨時会"},
        "era_base": 2018,
        "sort_groups": ["day"],
        "link_text_format": "第{day}日",
        "index_urls": {
            2026: "https://www.city.shibetsu.lg.jp/gyoseisaito/shiseijoho/gikai/1/kaigirokukekka/6825.html",
            2025: "https://www.city.shibetsu.lg.jp/gyoseisaito/shiseijoho/gikai/1/kaigirokukekka/6029.html",
            2024: "https://www.city.shibetsu.lg.jp/gyoseisaito/shiseijoho/gikai/1/kaigirokukekka/5304.html",
        },
    },
    "monbetsu": {
        "name": "紋別市",
        "strategy": "category_drilldown",
        "index_urls": {
            2026: [
                "https://mombetsu.jp/gikai/minutes/?category=262",  # 令和8年定例会
                "https://mombetsu.jp/gikai/minutes/?category=263",  # 令和8年臨時会
            ],
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
            2026: "https://www.town.setana.lg.jp/gikai/kaigiroku/cat904/",
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
    "shintotsukawa": {
        "name": "新十津川町",
        # 近年はPDFファイル名がアップロード日時のみのため、PDF先頭ページの会議名から抽出する。
        "strategy": "pdf_header",
        "index_url": "https://www.town.shintotsukawa.lg.jp/hotnews/detail/00001787.html",
        "title_regex": r"第\s*(\d+)\s*回[\s\S]{0,30}?(定例会|臨時会)",
        "year_regex": r"令和\s*(\d+)\s*年",
        "loose_year_regex": r"(?P<yyyy>20\d{2})",
        "era_base": 2018,
    },
    "makubetsu": {
        "name": "幕別町",
        # 1ページに全年度、h2=令和N年の下にul/li/a (「第1回臨時会【1月16日開催】」)
        "strategy": "linktext_pattern",
        "year_tag": "h2",
        "index_urls": {None: "https://www.town.makubetsu.lg.jp/gikai/hongikai/gikaikaigiroku/1898.html"},
    },
    "rankoshi": {
        "name": "蘭越町",
        # 年別ページ内で h1 の会議見出し直下に日別PDFが並ぶ。
        "strategy": "multi_index_html",
        "council_tag": "h1",
        "index_urls": {
            2026: "https://www.town.rankoshi.hokkaido.jp/administration/town/detail.html?content=867",
            2025: "https://www.town.rankoshi.hokkaido.jp/administration/town/detail.html?content=778",
            2024: "https://www.town.rankoshi.hokkaido.jp/administration/town/detail.html?content=656",
        },
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
    "uryu": {
        "name": "雨竜町",
        # ファイル名 uryugikai_kaigiroku_R7teirei01.pdf / R7rinzi01.pdf が R7以降の標準
        # 旧来形式 R6_1_teireikai_uryutyou.pdf は別regexで吸収
        "strategy": "filename_pattern",
        "filename_regex": r"(?:uryugikai_kaigiroku_)?R(?P<ey>\d+)(?:_(?P<s1>\d+))?_?(?P<t>teirei|rinzi|teireikai|rinjikai)\w*?(?P<seq2>\d+)?\.pdf",
        "type_map": {
            "teirei": "定例会", "teireikai": "定例会",
            "rinzi": "臨時会", "rinjikai": "臨時会",
        },
        "era_base": 2018,
        "index_url": "https://www.town.uryu.hokkaido.jp/docs/4719.html",
    },
    "moseushi": {
        "name": "妹背牛町",
        # 親indexから各定例会詳細HTMLへドリルダウン
        # 詳細ページのH1「令和6年第2回定例会」等から council情報を取る
        "strategy": "category_drilldown",
        "index_url": "https://www.town.moseushi.hokkaido.jp/gikai/gijiroku/",
        "use_detail_title": True,
        "pdf_filter": ["pdf"],
    },
    "oshamambe": {
        "name": "長万部町",
        # list28 親 → 年度HTML → 詳細ページ? 実は 年度HTML に直接PDFリンク + 豊富なリンクテキスト
        # 「第1回定例会　第1日目(令和4年3月10日)」形式
        "strategy": "linktext_pattern",
        "index_urls": {
            2025: "https://www.town.oshamambe.lg.jp/site/gikai/8216.html",
            2024: "https://www.town.oshamambe.lg.jp/site/gikai/6812.html",
        },
    },
    "haboro": {
        "name": "羽幌町",
        # 年度別HTMLに直接PDFリンクと「第3回定例会（令和7年3月11日）」形式のリンクテキスト
        "strategy": "linktext_pattern",
        "index_urls": {
            2025: "https://www.town.haboro.lg.jp/gikai-iinkai/gikai/gijiroku/2025-0610-1529-17.html",
            2024: "https://www.town.haboro.lg.jp/gikai-iinkai/gikai/gijiroku/R06kaigiroku.html",
        },
    },
    "matsumae": {
        "name": "松前町",
        # ファイル名: 07_1tei_kaigiroku.pdf / 06_3tei.pdf / 07_5rinzi_kaigiroku.pdf
        # rinji/rinzi 両表記あり
        "strategy": "filename_pattern",
        "filename_regex": r"(?P<ey>\d+)_(?P<seq>\d+)(?P<t>tei|rinji|rinzi)(?:_kaigiroku)?\.pdf",
        "type_map": {"tei": "定例会", "rinji": "臨時会", "rinzi": "臨時会"},
        "era_base": 2018,
        "index_url": "https://www.town.matsumae.hokkaido.jp/hotnews/detail/00000317.html",
    },
    "higashikawa": {
        "name": "東川町",
        # ファイル名: gikai_2025.03.11_teirei1-1.pdf / gikai_2023.03.31_rinji2.pdf
        "strategy": "filename_pattern",
        "filename_regex": r"gikai_(?P<yyyy>\d{4})\.(?P<mm>\d{2})\.(?P<dd>\d{2})_(?P<t>teirei|rinji)(?P<seq>\d+)(?:-(?P<day>\d+))?\.pdf",
        "type_map": {"teirei": "定例会", "rinji": "臨時会"},
        "sort_groups": ["mm", "dd", "day"],
        "link_text_format": "{mm:02d}月{dd:02d}日",
        "index_url": "https://higashikawa-town.jp/portal/machi/panel/105",
    },
    "yuni": {
        "name": "由仁町",
        # ファイル名: R07_1定_01.pdf / R06_１定_01.pdf (R5以降は統一形式)
        # 日本語文字 '定' をファイル名に含む → regex literal で対応
        # 全角/半角数字揺れ対応
        "strategy": "filename_pattern",
        "filename_regex": r"R(?P<ey>\d+)_(?P<seq>[\d０-９]+)定_(?P<day>\d+)\.pdf",
        "type_map": {"": "定例会"},  # 定例会固定
        "era_base": 2018,
        "sort_groups": ["day"],
        "link_text_format": "第{day}日",
        "index_urls": {
            2025: "https://www.town.yuni.lg.jp/chosei/gikai/teireikai",
            2024: "https://www.town.yuni.lg.jp/chosei/gikai/teireikai",
        },
    },
    "sarabetsu": {
        "name": "更別村",
        # リンクテキスト「令和6年第1回定例会第1日（令和6年3月11日）」
        "strategy": "linktext_pattern",
        "index_urls": {
            2025: "https://www.sarabetsu.jp/gikai/kaigiroku/r7/",
            2024: "https://www.sarabetsu.jp/gikai/kaigiroku/r6/",
        },
    },
    "urausu": {
        "name": "浦臼町",
        # ファイル名: kaigirokuR6-1tei.pdf / kaigirokuR7-2rin.pdf
        # giketu/tukoku 等の他PDFは "kaigiroku" prefix 無いので自然に除外される
        "strategy": "filename_pattern",
        "filename_regex": r"kaigirokuR(?P<ey>\d+)-(?P<seq>\d+)(?P<t>tei|rin)\.pdf",
        "type_map": {"tei": "定例会", "rin": "臨時会"},
        "era_base": 2018,
        "index_url": "https://www.town.urausu.hokkaido.jp/kurashi/gyosei/urausutyo/kaigiroku.html",
    },
    "hamanaka": {
        "name": "浜中町",
        # ファイル名: R7-1-1day.pdf / r6-3-2.pdf
        "strategy": "filename_pattern",
        "filename_regex": r"[Rr](?P<ey>\d+)-(?P<seq>\d+)-(?P<day>\d+)(?:day)?\.pdf",
        "type_map": {"": "定例会"},
        "era_base": 2018,
        "sort_groups": ["day"],
        "link_text_format": "第{day}日",
        "index_url": "https://www.townhamanaka.jp/gyousei/kaigi/",
    },
    "shibecha": {
        "name": "標茶町",
        # 定例会 R07T4.pdf / 臨時会 R07R1.pdf / 委員会は除外
        "strategy": "filename_pattern",
        "filename_regex": r"R(?P<ey>\d+)(?P<t>T|R)(?P<seq>\d+)\.pdf",
        "type_map": {"t": "定例会", "r": "臨時会"},
        "era_base": 2018,
        "index_url": "https://town.shibecha.hokkaido.jp/gikai/gijiroku.html",
    },
    "akkeshi": {
        "name": "厚岸町",
        # ファイル名: R07-1honkaigi0305.pdf （本会議）/ rinji_YYMMDD.pdf （臨時会）
        # 本会議のみ取得対象（yosan/hosei/jourei/gianは委員会・議案書なので除外）
        "strategy": "filename_pattern",
        "filename_regex": r"R(?P<ey>\d+)-(?P<seq>\d+)honkaigi(?P<mm>\d{2})(?P<dd>\d{2})\.pdf",
        "type_map": {"": "定例会"},
        "era_base": 2018,
        "sort_groups": ["mm", "dd"],
        "link_text_format": "{mm:02d}月{dd:02d}日",
        "index_urls": {
            2025: "https://www.akkeshi-town.jp/chogikai/minutes/r7/",
            2024: "https://www.akkeshi-town.jp/chogikai/minutes/r6/",
        },
    },
    "tobetsu": {
        "name": "当別町",
        # 年度別ページ→「令和X年第N回定例会(M月)」リンクテキスト
        "strategy": "linktext_pattern",
        "index_urls": {
            2026: "https://www.town.tobetsu.hokkaido.jp/site/gikai/54712.html",
            2025: "https://www.town.tobetsu.hokkaido.jp/site/gikai/50370.html",
            2024: "https://www.town.tobetsu.hokkaido.jp/site/gikai/45944.html",
        },
    },
    "esashi_souya": {
        "name": "枝幸町",
        # 単一ページに「令和X年第Y回定例会 第N号」リンク
        "strategy": "linktext_pattern",
        "index_url": "https://www.esashi.jp/gikai/meeting/minutes.html",
    },
    "esashi": {
        "name": "江差町",
        # 年度内の会議結果ページに会議録PDFが個別/合本で並ぶ。重複を避けるため、
        # 合本PDF(total.pdf)と臨時会PDFだけをヘッダー確認対象にする。
        "strategy": "pdf_header",
        "index_urls": {
            2024: [
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR6/honkaigiR6-02.html",
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR6/honkaigiR6-03-1.html",
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR6/honkaigiR6-03-2.html",
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR6/honkaigiR6-05.html",
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR6/honkaigiR6-06.html",
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR6/honkaigiR6-09.html",
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR6/honkaigiR6-12.html",
            ],
            2025: [
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR7/honkaigiR7-03-1.html",
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR7/honkaigiR7-03-2.html",
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR7/honkaigiR7-09-1.html",
            ],
            2026: [
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR8/honkaigiR8-02.html",
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR8/honkaigiR8-03-1.html",
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR8/honkaigiR8-04.html",
                "https://www.hokkaido-esashi.jp/gikai/h24-honkaigi/honkaigiR8/honkaigiR8-06-1.html",
            ],
        },
        "filename_filter_regex": r"(?:total\.pdf|^\d{6}(?:rinji)?\.pdf$)",
        "title_regex": r"第(\d+)回[\s\S]{0,30}?(定例会|臨時会)",
        "year_regex": r"令和(\d+)年",
        "schedule_regex": r"第(\d+)号",
        "loose_year_regex": r"(?P<yyyy>20\d{2})",
        "loose_year_from_page": True,
        "era_base": 2018,
    },
    "kamifurano": {
        "name": "上富良野町",
        # ファイル名: r06_1all.pdf (定例会全日合本) / r06_rinji01.pdf (臨時会)
        "strategy": "filename_pattern",
        "filename_regex": r"r(?P<ey>\d+)_(?:(?P<t>rinji)(?P<seq>\d+)|(?P<seq2>\d+)(?P<t2>all))\.pdf",
        "type_map": {"all": "定例会", "rinji": "臨時会"},
        "era_base": 2018,
        "index_url": "https://www.town.kamifurano.hokkaido.jp/index.php?id=152",
    },
    "nanae": {
        "name": "七飯町",
        # category_drilldown: hotnews/category/471 → detail/{ID} → PDF対
        # 詳細リンクテキスト「令和X年第N回七飯町議会定例会会議録（…）」
        "strategy": "category_drilldown",
        "index_url": "https://www.town.nanae.hokkaido.jp/hotnews/category/471.html",
        "use_detail_title": True,
        "pdf_filter": ["pdf"],
    },
    "akaigawa": {
        "name": "赤井川村",
        # WordPress、リンクテキスト「令和X年第Y回定例会本会議 第Z日（令和X年M月D日開催）」
        "strategy": "linktext_pattern",
        "index_url": "https://www.akaigawa.com/kurashi/gikai_jimukyoku/post_95.html",
    },
    "sobetsu": {
        "name": "壮瞥町",
        # ファイル名: R7_gikai_teireikai_gijiroku_1.pdf / R8_gikai_rinjikai_gijiroku_1.pdf
        "strategy": "filename_pattern",
        "filename_regex": r"R(?P<ey>\d+)_gikai_(?P<t>teireikai|rinjikai)_gijiroku_(?P<seq>\d+)\.pdf",
        "type_map": {"teireikai": "定例会", "rinjikai": "臨時会"},
        "era_base": 2018,
        "index_url": "https://www.town.sobetsu.lg.jp/gikai.html",
    },
    "biratori": {
        "name": "平取町",
        # リンク文言に「第N回…（定例会|臨時会）」があるため、日付だけのファイル名より優先する。
        # 既存2024/2025データは回次99で粗集約されているため、隔離修正までは自動更新対象へ戻さない。
        "strategy": "linktext_pattern",
        "index_urls": {
            2026: "https://www.town.biratori.hokkaido.jp/soshikikarasagasu/gikaijimukyoku/gijikakari_shomugakari/1/1/4/kaigiroku/2745.html",
        },
        "year_from_index": True,
    },
    "shintoku": {
        "name": "新得町",
        # ファイル名: r7tei1kaigiroku.pdf / R7rin1gijiroku.pdf / r7yosantokubetukaigiroku.pdf
        "strategy": "filename_pattern",
        "filename_regex": r"r(?P<ey>\d+)(?P<t>tei|rin|yosan|kessan)(?:tokubetu)?(?P<seq>\d+)?(?:kaigiroku|gijiroku)?\.pdf",
        "type_map": {
            "tei": "定例会", "rin": "臨時会",
            "yosan": "予算特別委員会", "kessan": "決算特別委員会",
        },
        "era_base": 2018,
        "index_urls": {
            2025: "https://www.shintoku-town.jp/gyousei/gikai/kaigiroku/r7/",
            2024: "https://www.shintoku-town.jp/gyousei/gikai/kaigiroku/r6/",
        },
    },
    "rikubetsu": {
        "name": "陸別町",
        # No.N は会議回次ではなく同一会議内の号数。種別と回次はPDFヘッダーを正とする。
        "strategy": "rikubetsu_pdf_header",
        "index_urls": {
            2025: "https://www.rikubetsu.jp/gikai/kaigiroku/R07/",
            2024: "https://www.rikubetsu.jp/gikai/kaigiroku/R06/",
        },
    },
    "toyokoro": {
        "name": "豊頃町",
        # リンクテキスト「令和7年第1回定例会第3号(3月13日)」
        "strategy": "linktext_pattern",
        "index_urls": {
            2026: "https://www.toyokoro.jp/site/gikai/7050.html",
            2025: "https://www.toyokoro.jp/site/gikai/5759.html",
            2024: "https://www.toyokoro.jp/site/gikai/4642.html",
        },
    },
    "bifuka": {
        "name": "美深町",
        # 見出し「令和7年第4回定例会」配下に「議事日程」「会議録」PDF
        "strategy": "multi_index_html",
        "index_urls": {
            2025: "https://www.town.bifuka.hokkaido.jp/cms/section/gikai/nuv41p000000fpk7.html",
            2024: "https://www.town.bifuka.hokkaido.jp/cms/section/gikai/nuv41p000000awkn.html",
        },
        "council_tag": "h3",
    },
    "bihoro": {
        "name": "美幌町",
        # 2段ドリルダウン: 年度トップ→「第N回臨時会（令和7年2月3日）」中間ページ→PDF
        "strategy": "category_drilldown",
        "index_urls": {
            2025: "https://www.town.bihoro.hokkaido.jp/site/gikai/1102.html",
            2024: "https://www.town.bihoro.hokkaido.jp/site/gikai/1084.html",
        },
        "use_detail_title": True,
        "pdf_filter": ["pdf"],
    },
    "shimukappu": {
        "name": "占冠村",
        # リンクテキスト「第N回占冠村議会定例会（自 令和N年M月D日 …）」
        "strategy": "linktext_pattern",
        "index_url": "https://www.vill.shimukappu.lg.jp/shimukappu/section/gikai/nmudtq000000cgh1.html",
    },
    "koshimizu": {
        "name": "小清水町",
        # /gikai/detail/00009799.html に全リスト、リンクテキストに日付・種別
        "strategy": "linktext_pattern",
        "index_url": "https://www.town.koshimizu.hokkaido.jp/gikai/detail/00009799.html",
    },
    "niikappu": {
        "name": "新冠町",
        # 見出し「令和N年第N回定例会」配下にPDF日付リスト
        "strategy": "multi_index_html",
        "index_urls": {None: "https://www.niikappu.jp/gyose/gikai/gikai_kaigiroku.html"},
        "council_tag": "h3",
        "year_from_heading": True,
    },
    "betsukai": {
        "name": "別海町",
        # 年度別URL、リンクテキスト「令和N年第N回定例会 第N号（令和N年M月D日）」
        "strategy": "linktext_pattern",
        "index_urls": {
            2025: "https://betsukai.jp/gikai/kaigikekka/kaigiroku/R07/",
            2024: "https://betsukai.jp/gikai/kaigikekka/kaigiroku/R06/",
        },
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
    "toyoura": {
        "name": "豊浦町",
        # 年度ページに「定例会9月会議第3号（9月19日）」形式のPDFが並ぶ通年会期制
        # month*10 + 当月内回次 を seq として扱い、同じ月会議の第N号PDFを schedules に束ねる
        "strategy": "monthly_meeting_linktext",
        "index_urls": {
            2026: "https://www.town.toyoura.hokkaido.jp/hotnews/detail/00006887.html",
            2025: "https://www.town.toyoura.hokkaido.jp/hotnews/detail_sp/00006367.html",
            2024: "https://www.town.toyoura.hokkaido.jp/hotnews/detail/00005917.html",
        },
    },
    "toyako": {
        "name": "洞爺湖町",
        # 表見出し「洞爺湖町議会令和7年9月会議」配下に日別PDFが並ぶ通年会期制。
        # 目次PDFは除外し、同じ月会議の日別PDFを schedules に束ねる。
        "strategy": "monthly_meeting_table",
        "index_urls": {
            None: "http://www.town.toyako.hokkaido.jp/town_administration/town_council/toc006/",
            2024: "http://www.town.toyako.hokkaido.jp/town_administration/town_council/toc006/toc101/3972",
        },
    },
    "mori": {
        "name": "森町",
        # 通年会期制の「令和7年第1回森町議会12月第2回会議」形式。
        # 年度ページ内に翌年1月会議も載るため、リンクテキストの令和年を優先する。
        "strategy": "monthly_meeting_linktext",
        "index_urls": {
            None: [
                "https://www.town.hokkaido-mori.lg.jp/soshiki/gikai/proceedings/proceedings/3274.html",
                "https://www.town.hokkaido-mori.lg.jp/soshiki/gikai/proceedings/proceedings/253.html",
            ],
        },
        "default_type": "定例会",
        "council_name_from_month": True,
    },
    "tsukigata": {
        "name": "月形町",
        # 年度ページ内の h2=定例会/臨時会、h3=第N回、会議録の日別PDFを取得する。
        # 議決結果・一般質問もPDFなので、日付リンクだけを対象にする。
        "strategy": "nested_html_sections",
        "index_urls": {
            2026: "https://www.town.tsukigata.hokkaido.jp/page/6952.html",
            2025: "https://www.town.tsukigata.hokkaido.jp/page/4071.html",
            2024: "https://www.town.tsukigata.hokkaido.jp/page/1607.html",
        },
        "year_tag": "h1",
        "type_tag": "h2",
        "council_tag": "h3",
        "pdf_filter": "月",
    },
    "chippubetsu": {
        "name": "秩父別町",
        # 議決結果リンクに会期情報があり、その直後に会議録PDFが並ぶ構造。
        "strategy": "result_following_minutes",
        "index_urls": {
            2026: "https://www.town.chippubetsu.hokkaido.jp/category/detail.html?category=town&content=636",
            2025: "https://www.town.chippubetsu.hokkaido.jp/category/detail.html?category=town&content=588",
            2024: "https://www.town.chippubetsu.hokkaido.jp/category/detail.html?category=town&content=543",
        },
    },
    "yakumo": {
        "name": "八雲町",
        # 令和6年は年別ページ配下の「定例会会議録」「臨時会会議録」詳細ページに
        # h2「第N回定例会/臨時会」ごとの日別PDFが並ぶ。
        # 令和8年臨時会ページだけは見出しなしのフラットなPDFリンクになっている。
        "strategy": "multi_index_html",
        "index_urls": {
            2026: [
                "https://www.town.yakumo.lg.jp/site/gikai/r8-kaigiroku-rinjikai.html",
                "https://www.town.yakumo.lg.jp/site/gikai/r8-kaigiroku-teireikai.html",
            ],
            2024: [
                "https://www.town.yakumo.lg.jp/site/gikai/content90992024.html",
                "https://www.town.yakumo.lg.jp/site/gikai/r6rinjikaikaigiroku.html",
            ],
        },
        "council_tag": "h2",
        "flat_council_links": True,
    },
    "numata": {
        "name": "沼田町",
        # 年度別ページ内で h4「定例会/臨時会」を切り替え、
        # 直下のPDFリンク「第N回（令和N年M月D日）」を会議録として拾う。
        "strategy": "year_page_type_sections",
        "index_urls": {
            2026: "https://www.town.numata.hokkaido.jp/section/gikai/juegn8000000165x.html",
            2025: "https://www.town.numata.hokkaido.jp/section/gikai/h0opp2000000rbtu.html",
            2024: "https://www.town.numata.hokkaido.jp/section/gikai/h0opp2000000mzi1.html",
        },
        "type_tag": "h4",
    },
    "kamisunagawa": {
        "name": "上砂川町",
        # 年度別の定例会/臨時会ページから個別会議ページへ辿り、
        # 個別ページ内の「会議録」PDFだけを拾う。
        "strategy": "category_drilldown",
        "index_urls": {
            2026: [
                "https://town.kamisunagawa.hokkaido.jp/gikai_jimukyoku/kekka/teirei/r8/index.html",
                "https://town.kamisunagawa.hokkaido.jp/gikai_jimukyoku/kekka/rinji/r8/index.html",
            ],
            2025: [
                "https://town.kamisunagawa.hokkaido.jp/gikai_jimukyoku/kekka/teirei/r7/index.html",
                "https://town.kamisunagawa.hokkaido.jp/gikai_jimukyoku/kekka/rinji/r7/index.html",
            ],
            2024: [
                "https://town.kamisunagawa.hokkaido.jp/gikai_jimukyoku/kekka/teirei/r6/index.html",
                "https://town.kamisunagawa.hokkaido.jp/gikai_jimukyoku/kekka/rinji/r6/index.html",
            ],
        },
        "pdf_filter": ["会議録", "kaigiroku"],
    },
    "shimokawa": {
        "name": "下川町",
        # 年度別記事内のPDF title属性に「令和N年M月...会議録」が入る。
        # リンク本文は「議案審議」固定なので title から会議情報を読む。
        "strategy": "pdf_title_pattern",
        "index_urls": {
            2025: "https://www.town.shimokawa.hokkaido.jp/section/2025/11/7-12.html",
            2024: "https://www.town.shimokawa.hokkaido.jp/section/2024/09/6-6.html",
        },
    },
    "biei": {
        "name": "美瑛町",
        # 年度別「会議録」ページの h3 見出しを会議単位にし、
        # 「令和N年M月D日開催」のPDFだけを本文として拾う。
        "strategy": "multi_index_html",
        "index_urls": {
            2025: "https://www.town.biei.hokkaido.jp/administration/parliament/proceedings/proceedings7.html",
            2024: "https://www.town.biei.hokkaido.jp/administration/parliament/proceedings/proceedings.html",
        },
        "council_tag": "h3",
        "pdf_filter": ["開催"],
    },
    "shihoro": {
        "name": "士幌町",
        # 年別ページ内で h2 の会議見出しごとに、h4「会議録」区間のPDFだけを拾う。
        "strategy": "council_minutes_section",
        "index_urls": {
            2026: "https://www.shihoro.jp/assembly/news/detail.php?news=278",
            2025: "https://www.shihoro.jp/assembly/news/detail.php?news=236",
            2024: "https://www.shihoro.jp/assembly/news/detail.php?news=197",
        },
        # 令和6年第1回臨時会は画像スキャンPDFで、現行のテキスト抽出では本文化できない。
        "skip_filenames": ["news_20250423_114637.pdf"],
    },
    "kamishihoro": {
        "name": "上士幌町",
        # 一覧ページ → 記事詳細 → 添付PDF。添付URLは dl.php?up_code=... で .pdf 終端ではない。
        "strategy": "entry_pdf_attachments",
        "index_url": "https://www.kamishihoro.jp/page/00000151",
        "exclude_detail_keywords": ["委員会"],
        "pdf_filter": [".pdf"],
    },
    "assabu": {
        "name": "厚沢部町",
        # 年別一覧 → 会議詳細 → 「議事録本文」PDF。名簿・議事日程PDFは除外する。
        "strategy": "category_drilldown",
        "index_urls": {
            2025: "https://www.town.assabu.lg.jp/site/gikai/list32-218.html",
            2024: "https://www.town.assabu.lg.jp/site/gikai/list32-205.html",
        },
        "pdf_filter": ["議事録本文"],
    },
    "urahoro": {
        "name": "浦幌町",
        # 年別ページ内で h3 の定例会・臨時会見出しごとに日別PDFが並ぶ。
        "strategy": "multi_index_html",
        "index_urls": {
            2026: "https://www.urahoro.jp/council/?content=2976",
            2025: "https://www.urahoro.jp/council/?content=2287",
            2024: "https://www.urahoro.jp/council/?content=1513",
        },
        "council_tag": "h3",
    },
    "horokanai": {
        "name": "幌加内町",
        # 年別ページの表から、開催日・会議名・PDFを読む。委員会は除外して本会議のみ対象。
        "strategy": "minutes_table_rows",
        "index_urls": {
            2026: "https://www.town.horokanai.hokkaido.jp/gikai/giroku/2026",
            2025: "https://www.town.horokanai.hokkaido.jp/gikai/giroku/2025",
            2024: "https://www.town.horokanai.hokkaido.jp/gikai/giroku/2024",
        },
    },
    "urakawa": {
        "name": "浦河町",
        # 年別の本会議一覧 → 会議詳細 → 会議録PDF。
        "strategy": "category_drilldown",
        "index_urls": {
            2026: "https://www.town.urakawa.hokkaido.jp/gyosei/council/?category=347",
            2025: "https://www.town.urakawa.hokkaido.jp/gyosei/council/?category=331",
            2024: "https://www.town.urakawa.hokkaido.jp/gyosei/council/?category=309",
        },
        "pdf_filter": ["pdf"],
    },
    "engaru": {
        "name": "遠軽町",
        # 単一ページ内で h3 が年、h5 が会議見出し。その直下に日別PDFが並ぶ。
        "strategy": "multi_index_html",
        "index_urls": {None: "https://engaru.jp/life/page.php?id=398"},
        "year_tag": "h3",
        "council_tag": "h5",
    },
    "kushirocho": {
        "name": "釧路町",
        # 年別一覧の会議録リンクから詳細ページへ入り、日別PDFを拾う。
        "strategy": "detail_page_daily_pdfs",
        "index_urls": {
            2026: "http://www.town.kushiro.lg.jp/gikai/gijiroku/2026.html",
            2025: "http://www.town.kushiro.lg.jp/gikai/gijiroku/2025.html",
            2024: "http://www.town.kushiro.lg.jp/gikai/gijiroku/2024.html",
        },
    },
    "rausu": {
        "name": "羅臼町",
        # 単一ページ内で h3=年、h4=定例会/臨時会、li=会議行。行内の号別PDFを拾う。
        "strategy": "list_item_pdf_links",
        "index_url": "https://www.rausu-town.jp/pages/view/151",
    },
    "oozora": {
        "name": "大空町",
        # 単一ページ内のPDFリンクテキストに「令和N年第N回定例会/臨時会」が入る。
        "strategy": "linktext_pattern",
        "index_url": "https://www.town.ozora.hokkaido.jp/soshiki/1002/1/5/1/819.html",
    },
    "embetsu": {
        "name": "遠別町",
        # 単一ページ内のPDFリンクテキストに「第N回...会議録(R0N.M.D)」が入る。
        "strategy": "linktext_pattern",
        "index_url": "https://www.town.embetsu.hokkaido.jp/docs/4088.html",
    },
    "ashoro": {
        "name": "足寄町",
        # h2=年、表の左列=会議名、右列=日別PDF。
        "strategy": "meeting_table_date_links",
        "index_url": "https://www.town.ashoro.hokkaido.jp/gikai/kaigiroku/page_6.html",
    },
    "otofuke": {
        "name": "音更町",
        # DBSRの会議録ライブラリから会議一覧を辿り、日別の本文HTMLを取得する。
        "strategy": "dbsr_library_html",
        "index_url": "https://www.town.otofuke.hokkaido.dbsr.jp/index.php/100000?Template=search-library",
    },
    "toyotomi": {
        "name": "豊富町",
        # 同一ページに議事概要と会議録本文が混在するため、「定例議会/臨時議会」の本文PDFだけ拾う。
        "strategy": "linktext_pattern",
        "index_url": "https://www.town.toyotomi.hokkaido.jp/section/gikaijimukyoku/ufvuj5000000101a.html",
        "required_text": "議会",
    },
    "imakane": {
        "name": "今金町",
        # p見出し=会議名、直後の表行=会議録第N号PDF。目次PDFは除外する。
        "strategy": "heading_table_pdf_links",
        "index_urls": {
            2026: [
                "https://www.town.imakane.lg.jp/ass/kaigiroku/post_6.html",
                "https://www.town.imakane.lg.jp/ass/cat/post_12.html",
            ],
            2025: [
                "https://www.town.imakane.lg.jp/ass/kaigiroku/post_6.html",
                "https://www.town.imakane.lg.jp/ass/cat/post_12.html",
            ],
            2024: [
                "https://www.town.imakane.lg.jp/ass/kaigiroku/post_6.html",
                "https://www.town.imakane.lg.jp/ass/cat/post_12.html",
            ],
        },
    },
    "nakatombetsu": {
        "name": "中頓別町",
        # 年別ページにランダム名のPDFが並ぶため、PDF先頭の会議録タイトルから会期を読む。
        "strategy": "pdf_header",
        "index_urls": {
            2026: "https://www.town.nakatombetsu.hokkaido.jp/bunya/114154/",
            2025: "https://www.town.nakatombetsu.hokkaido.jp/bunya/91827/",
            2024: "https://www.town.nakatombetsu.hokkaido.jp/bunya/60864/",
        },
        "title_regex": r"第\s*(\d+)\s*回[\s\S]{0,30}?(定例会|臨時会)",
        "year_regex": r"令和\s*(\d+)\s*年",
        "schedule_regex": r"第\s*(\d+)\s*号",
        "loose_year_from_page": True,
        "era_base": 2018,
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
        elif gd.get("yy") is not None:
            year = 2000 + int(gd["yy"])
        elif gd.get("ey") is not None and era_base is not None:
            year = era_base + int(gd["ey"])
        else:
            continue
        seq = int(gd.get("seq") or gd.get("seq2") or gd.get("s1") or 0) or None
        ttype = type_map.get((gd.get("t") or gd.get("t2") or "").lower())
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
    href_filters = cfg.get("href_filter", [])
    if isinstance(href_filters, str):
        href_filters = [href_filters]
    filename_filter_regex = cfg.get("filename_filter_regex")
    records: list[dict] = []
    seen = set()

    for base_url, _base_year in url_year_pairs:
        r = requests.get(base_url, timeout=30, headers=HEADERS)
        r.raise_for_status()
        for m in re.finditer(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', r.text, re.I):
            href = m.group(1)
            fn = href.rsplit("/", 1)[-1]
            fn_lower = fn.lower()
            if href_filters and not any(f.lower() in fn_lower for f in href_filters):
                continue
            if filename_filter_regex and not re.search(filename_filter_regex, fn, re.I):
                continue
            if fn in seen:
                continue
            seen.add(fn)

            lm = loose_re.search(fn)
            if not lm and cfg.get("loose_year_from_page") and _base_year:
                loose_year = _base_year
            elif lm:
                lgd = lm.groupdict()
                if lgd.get("yyyy"):
                    loose_year = int(lgd["yyyy"])
                elif lgd.get("ey"):
                    loose_year = era_base + int(lgd["ey"])
                else:
                    continue
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
            if target_set and year not in target_set:
                continue

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


RIKUBETSU_FILENAME_RE = re.compile(
    r"No\.(?P<issue>\d+)\(R(?P<ey>\d+)\.(?P<month>\d+)\.(?P<day>\d+)\)\.pdf$",
    re.I,
)
RIKUBETSU_HEADER_RE = re.compile(
    r"令和\s*(?P<ey>\d+)\s*年\s*陸別町議会\s*"
    r"(?:"
    r"(?P<regular_month>\d+)\s*月\s*定例会"
    r"|第\s*(?P<extraordinary_seq>\d+)\s*回\s*臨時会"
    r")\s*会議録\s*[（(]?\s*第\s*(?P<issue>\d+)\s*号",
)


def parse_rikubetsu_pdf_header(first_page_text: str) -> dict:
    """Read the official meeting identity without treating ``第N号`` as a meeting number."""
    normalized = _zen_to_half(first_page_text)
    match = RIKUBETSU_HEADER_RE.search(normalized)
    if not match:
        raise ValueError("陸別町PDFヘッダーから定例月または臨時会回次を認識できません")

    year = 2018 + int(match.group("ey"))
    if match.group("regular_month"):
        meeting_type = "定例会"
        sequence = int(match.group("regular_month"))
    else:
        meeting_type = "臨時会"
        sequence = int(match.group("extraordinary_seq"))
    return {
        "year": year,
        "type": meeting_type,
        "seq": sequence,
        "issue": int(match.group("issue")),
    }


def extract_pdf_links_by_rikubetsu_header(cfg: dict, years: list[int]) -> list[dict]:
    """Classify Rikubetsu PDFs by their official header, using filenames only for dates."""
    target_years = set(years)
    records: list[dict] = []
    seen_urls = set()

    for index_year, urls in cfg["index_urls"].items():
        if index_year not in target_years:
            continue
        for base_url in urls if isinstance(urls, list) else [urls]:
            response = requests.get(base_url, timeout=30, headers=HEADERS)
            response.raise_for_status()
            for link in re.finditer(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', response.text, re.I):
                href = link.group(1)
                filename = href.rsplit("/", 1)[-1].split("?", 1)[0]
                filename_match = RIKUBETSU_FILENAME_RE.fullmatch(filename)
                if not filename_match:
                    continue

                file_year = 2018 + int(filename_match.group("ey"))
                month = int(filename_match.group("month"))
                day = int(filename_match.group("day"))
                issue = int(filename_match.group("issue"))
                if file_year not in target_years:
                    continue
                try:
                    meeting_date = date(file_year, month, day)
                except ValueError as exc:
                    raise RuntimeError(f"陸別町PDFファイル名の日付が不正です: {filename}") from exc

                full_url = urljoin(base_url, href)
                if full_url in seen_urls:
                    continue
                seen_urls.add(full_url)

                try:
                    pdf_response = requests.get(full_url, timeout=60, headers=HEADERS)
                    pdf_response.raise_for_status()
                    with pdfplumber.open(io.BytesIO(pdf_response.content)) as pdf:
                        first_page_text = pdf.pages[0].extract_text() or ""
                    identity = parse_rikubetsu_pdf_header(first_page_text)
                except Exception as exc:
                    raise RuntimeError(f"陸別町PDFの会議識別に失敗しました: {full_url}: {exc}") from exc

                if identity["year"] != file_year or identity["year"] != index_year:
                    raise RuntimeError(
                        f"陸別町PDFの年度が一覧・ファイル名・ヘッダーで一致しません: {full_url}"
                    )
                if identity["issue"] != issue:
                    raise RuntimeError(
                        f"陸別町PDFの号数がファイル名とヘッダーで一致しません: {full_url}"
                    )
                if identity["type"] == "定例会" and identity["seq"] != month:
                    raise RuntimeError(
                        f"陸別町定例会の月がファイル名とヘッダーで一致しません: {full_url}"
                    )

                meeting_name = (
                    f"{era_str(file_year)}{identity['seq']}月定例会"
                    if identity["type"] == "定例会"
                    else f"{era_str(file_year)}第{identity['seq']}回臨時会"
                )
                records.append({
                    "type": identity["type"],
                    "year": file_year,
                    "seq": identity["seq"],
                    "filename": filename,
                    "link_text": f"{month:02d}月{day:02d}日 第{issue}号",
                    "url": full_url,
                    "date": meeting_date.isoformat(),
                    "council_name": meeting_name,
                    "sort_key": (month, day, issue, full_url),
                })
                time.sleep(0.3)

    return records


MONTH_TO_TEIREI_SEQ = {3: 1, 6: 2, 9: 3, 12: 4}


def extract_pdf_links_by_year_page_type_sections(cfg: dict, years: list[int]) -> list[dict]:
    """年度別ページ + 種別見出し + PDFリンクの構造向け戦略。

    PDFリンクテキストに種別が含まれず、直前の見出し（例: h4「臨時会」）から
    定例会/臨時会を補う自治体に使う。
    """
    index_urls: dict = cfg["index_urls"]
    type_tag = cfg.get("type_tag", "h4").lower()
    seq_re = re.compile(r"第\s*(\d+)\s*回")
    era_re = re.compile(r"令和(\d+)年")
    date_re = re.compile(r"令和\d+年\s*(\d+)月\s*(\d+)日")

    records: list[dict] = []
    seen = set()

    class SectionLinkParser(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.current_type = None
            self._type_text: list[str] | None = None
            self._link_href = None
            self._link_text: list[str] | None = None
            self.links: list[tuple[str, str, str]] = []

        def handle_starttag(self, tag, attrs):
            tag = tag.lower()
            if tag == type_tag:
                self._type_text = []
                return
            if tag == "a":
                href = dict(attrs).get("href")
                if href and ".pdf" in href.lower():
                    self._link_href = href
                    self._link_text = []

        def handle_data(self, data):
            if self._type_text is not None:
                self._type_text.append(data)
            if self._link_text is not None:
                self._link_text.append(data)

        def handle_endtag(self, tag):
            tag = tag.lower()
            if tag == type_tag and self._type_text is not None:
                text = _zen_to_half(re.sub(r"\s+", " ", "".join(self._type_text)).strip())
                self.current_type = next((ttype for ttype in TYPE_FLAGS if ttype in text), None)
                self._type_text = None
                return
            if tag == "a" and self._link_href and self._link_text is not None:
                text = _zen_to_half(re.sub(r"\s+", " ", "".join(self._link_text)).strip())
                self.links.append((self.current_type, self._link_href, text))
                self._link_href = None
                self._link_text = None

    for year, url in index_urls.items():
        if year not in years:
            continue
        r = requests.get(url, timeout=30, headers=HEADERS)
        r.encoding = r.apparent_encoding or "utf-8"
        r.raise_for_status()

        parser = SectionLinkParser()
        parser.feed(r.text)
        for current_type, href, text in parser.links:
            if not current_type:
                continue

            seq_m = seq_re.search(text)
            era_m = era_re.search(text)
            if not seq_m or not era_m:
                continue
            actual_year = 2018 + int(era_m.group(1))
            if actual_year != year:
                continue

            full_url = urljoin(url, href)
            if full_url in seen:
                continue
            seen.add(full_url)

            date_m = date_re.search(text)
            sort_key = (
                int(date_m.group(1)) if date_m else 0,
                int(date_m.group(2)) if date_m else 0,
                full_url,
            )
            records.append({
                "type": current_type,
                "year": actual_year,
                "seq": int(seq_m.group(1)),
                "filename": href.rsplit("/", 1)[-1],
                "link_text": text[:60],
                "url": full_url,
                "sort_key": sort_key,
            })
    return records


def extract_pdf_links_by_pdf_title_pattern(cfg: dict, years: list[int]) -> list[dict]:
    """PDFリンクのtitle属性に会議情報が入る構造向け戦略。"""
    index_urls: dict = cfg["index_urls"]
    title_re = re.compile(r'title=["\']([^"\']*会議録[^"\']*\.pdf)["\']', re.I)
    link_re = re.compile(r'<a[^>]+href=["\']([^"\']+\.pdf)["\'][^>]*>', re.I)
    era_re = re.compile(r"令和(\d+)年")
    month_re = re.compile(r"(\d+)月")
    second_re = re.compile(r"第\s*(\d+)\s*回")

    records: list[dict] = []
    seen = set()
    for page_year, url in index_urls.items():
        if page_year not in years:
            continue
        r = requests.get(url, timeout=30, headers=HEADERS)
        r.encoding = r.apparent_encoding or "utf-8"
        r.raise_for_status()

        for m in re.finditer(r"<a[^>]+>", r.text, re.I):
            tag = m.group(0)
            lm = link_re.search(tag)
            tm = title_re.search(tag)
            if not lm or not tm:
                continue
            href = lm.group(1)
            title = _zen_to_half(tm.group(1))
            if "目次" in title or "議案名" in title or "表紙" in title:
                continue

            era_m = era_re.search(title)
            month_m = month_re.search(title)
            if not era_m or not month_m:
                continue
            actual_year = 2018 + int(era_m.group(1))
            if actual_year not in years:
                continue

            month = int(month_m.group(1))
            if "定例" in title:
                ttype = "定例会"
                seq = MONTH_TO_TEIREI_SEQ.get(month, month)
            elif "臨時" in title:
                ttype = "臨時会"
                second_m = second_re.search(title)
                seq = month * 10 + int(second_m.group(1)) if second_m else month * 10 + 1
            else:
                continue

            full_url = urljoin(url, href)
            if full_url in seen:
                continue
            seen.add(full_url)
            fn = href.rsplit("/", 1)[-1]
            schedule_no = 0
            schedule_m = re.search(r"会議録(\d+)", title)
            if schedule_m:
                schedule_no = int(schedule_m.group(1))
            records.append({
                "type": ttype,
                "year": actual_year,
                "seq": seq,
                "filename": fn,
                "link_text": title.removesuffix(".pdf")[:60],
                "council_name": re.sub(r"会議録\d*$", "", title.removesuffix(".pdf")),
                "url": full_url,
                "sort_key": (month, schedule_no, fn),
            })
    return records


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
    r_era_re = re.compile(r"R0?(\d+)", re.I)
    # fallback: 「7年第3回定例会」のように令和省略 + N年 + 第N回 でR era推定
    era_fallback_re = re.compile(r"(\d+)年第\s*\d+\s*回")
    seq_re = re.compile(r"第\s*(\d+)\s*回")
    # 「定例会」「臨時会」だけでなく「定例市議会」「臨時町議会」等にも対応
    type_re = re.compile(r"(定例|臨時)(?:[^、\n]*?)会")
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
                        "type": f"{tm.group(1)}会",
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
                required_text = cfg.get("required_text")
                if required_text and required_text not in text:
                    continue
                tm = type_re.search(text)
                sm = seq_re.search(text)
                if not tm or not sm:
                    continue
                # 令和年の判定（厳密）:
                #   1. 「令和N年」→ 2018+N
                #   2. 「元年」→ 2019
                #   3. 「N年第N回」(令和省略)→ 1<=N<=10 なら 2018+N
                # どれにも当てはまらない場合は skip（index key にフォールバックしない
                # → 同一URL複数年度iterで誤マッチを防ぐ）
                em = era_re.search(text)
                actual_year = None
                if em:
                    actual_year = 2018 + int(em.group(1))
                elif "元年" in text:
                    actual_year = 2019
                else:
                    rm = r_era_re.search(text)
                    if rm:
                        actual_year = 2018 + int(rm.group(1))
                    else:
                        efb = era_fallback_re.search(text)
                        if efb and 1 <= int(efb.group(1)) <= 10:
                            actual_year = 2018 + int(efb.group(1))
                if actual_year is None and cfg.get("year_from_index"):
                    actual_year = year
                if actual_year != year:
                    continue
                fn = href.rsplit("/", 1)[-1]
                # 単一URLを複数年度で回す場合の重複排除
                if any(r["filename"] == fn for r in records):
                    continue
                date_m = re.search(r"(\d+)\s*月\s*(\d+)\s*日", text)
                day_m = re.search(r"(\d+)\s*日目", text)
                sort_key = (
                    int(date_m.group(1)) if date_m else 0,
                    int(date_m.group(2)) if date_m else 0,
                    int(day_m.group(1)) if day_m else 0,
                    href,
                )
                records.append({
                    "type": f"{tm.group(1)}会",
                    "year": year,
                    "seq": int(sm.group(1)),
                    "filename": fn,
                    "link_text": text[:60],
                    "url": urljoin(url, href),
                    "sort_key": sort_key,
                })
    return records


def extract_pdf_links_by_linktext_drilldown(cfg: dict, years: list[int]) -> list[dict]:
    """年ページ上のPDFと、会議詳細ページ内の日別PDFをまとめて取得する。"""
    records = extract_pdf_links_by_linktext_pattern(cfg, years)
    seen_pdf_urls = {record["url"] for record in records}
    seen_detail_urls = set()
    type_re = re.compile(r"(定例|臨時)(?:[^、\n]*?)会")
    seq_re = re.compile(r"第\s*(\d+)\s*回")
    era_re = re.compile(r"令和\s*(\d+)\s*年")
    pdf_filters = cfg.get("detail_pdf_filter", [".pdf"])
    if isinstance(pdf_filters, str):
        pdf_filters = [pdf_filters]

    for page_year, urls in cfg["index_urls"].items():
        if page_year not in years:
            continue
        url_list = urls if isinstance(urls, list) else [urls]
        for index_url in url_list:
            r = requests.get(index_url, timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
            r.raise_for_status()
            for m in re.finditer(
                r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>([\s\S]{1,300}?)</a>',
                r.text,
                re.I,
            ):
                href = unescape(m.group(1))
                if ".pdf" in href.lower() or href.startswith(("#", "javascript:")):
                    continue
                text = _zen_to_half(unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(2))).strip()))
                tm = type_re.search(text)
                sm = seq_re.search(text)
                if not tm or not sm:
                    continue
                em = era_re.search(text)
                actual_year = 2018 + int(em.group(1)) if em else page_year
                if actual_year != page_year:
                    continue
                detail_url = urljoin(index_url, href)
                if detail_url in seen_detail_urls:
                    continue
                seen_detail_urls.add(detail_url)

                dr = requests.get(detail_url, timeout=30, headers=HEADERS)
                dr.encoding = dr.apparent_encoding or "utf-8"
                dr.raise_for_status()
                for order, pm in enumerate(re.finditer(
                    r'<a[^>]+href=["\']([^"\']+\.pdf[^"\']*)["\'][^>]*>([\s\S]{0,300}?)</a>',
                    dr.text,
                    re.I,
                ), 1):
                    pdf_href = unescape(pm.group(1))
                    pdf_text = _zen_to_half(unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", pm.group(2))).strip()))
                    haystack = f"{pdf_href.lower()} {pdf_text.lower()}"
                    if pdf_filters and not any(value.lower() in haystack for value in pdf_filters):
                        continue
                    pdf_url = urljoin(detail_url, pdf_href)
                    if pdf_url in seen_pdf_urls:
                        continue
                    seen_pdf_urls.add(pdf_url)
                    date_m = re.search(r"(\d+)\s*月\s*(\d+)\s*日", pdf_text)
                    records.append({
                        "type": f"{tm.group(1)}会",
                        "year": page_year,
                        "seq": int(sm.group(1)),
                        "filename": pdf_href.split("?", 1)[0].rsplit("/", 1)[-1],
                        "link_text": pdf_text[:60] or f"第{order}日",
                        "council_name": f"{era_str(page_year)}第{int(sm.group(1))}回{tm.group(1)}会",
                        "url": pdf_url,
                        "sort_key": (
                            int(date_m.group(1)) if date_m else 0,
                            int(date_m.group(2)) if date_m else 0,
                            order,
                            pdf_url,
                        ),
                    })
                time.sleep(0.2)

    return records


def extract_pdf_links_by_meeting_table_date_links(cfg: dict, years: list[int]) -> list[dict]:
    """h2年度見出し + 表の会議名行から日別PDFを束ねる戦略。"""
    index_url = cfg["index_url"]
    r = requests.get(index_url, timeout=30, headers=HEADERS)
    r.encoding = r.apparent_encoding or "utf-8"
    r.raise_for_status()

    records: list[dict] = []
    seen = set()
    current_year = None
    block_re = re.compile(r"<(?P<tag>h2|tr)[^>]*>(?P<html>[\s\S]*?)</(?P=tag)>", re.I)
    link_re = re.compile(r'<a[^>]+href=["\']([^"\']+\.pdf)["\'][^>]*>([\s\S]*?)</a>', re.I)

    for m in block_re.finditer(r.text):
        tag = m.group("tag").lower()
        html = m.group("html")
        text = _zen_to_half(_html_to_text(html))

        if tag == "h2":
            current_year = japanese_year_to_int(text)
            continue
        if tag != "tr" or current_year not in years:
            continue

        cells = re.findall(r"<td[^>]*>([\s\S]*?)</td>", html, re.I)
        if len(cells) < 2:
            continue
        title = _zen_to_half(_html_to_text(cells[0]))
        if "委員会" in title:
            continue
        ttype = next((label for label in TYPE_FLAGS if label in title), None)
        seq_m = re.search(r"第\s*(\d+)\s*回", title)
        if not ttype or not seq_m:
            continue
        seq = int(seq_m.group(1))

        for order, (href, link_html) in enumerate(link_re.findall(cells[1]), 1):
            full = urljoin(index_url, href)
            if full in seen:
                continue
            seen.add(full)
            link_text = _zen_to_half(_html_to_text(link_html)) or f"第{order}日"
            date_m = re.search(r"(\d+)\s*月\s*(\d+)\s*日", link_text)
            month = int(date_m.group(1)) if date_m else 0
            day = int(date_m.group(2)) if date_m else 0

            records.append({
                "type": ttype,
                "year": current_year,
                "seq": seq,
                "filename": full.rsplit("/", 1)[-1],
                "link_text": link_text,
                "council_name": f"{era_str(current_year)}第{seq}回{ttype}",
                "url": full,
                "sort_key": (month, day, order, full),
            })

    return records


def extract_pdf_links_by_heading_table_pdf_links(cfg: dict, years: list[int]) -> list[dict]:
    """会議見出しの直後に並ぶ表行から、会議録本文PDFを取得する戦略。"""
    index_urls: dict = cfg["index_urls"]
    records: list[dict] = []
    seen = set()
    title_re = re.compile(r"令和\s*(\d+)\s*年\s*第\s*(\d+)\s*回.*?(定例会|臨時会)")
    block_re = re.compile(r"<(?P<tag>p|tr)[^>]*>(?P<html>[\s\S]*?)</(?P=tag)>", re.I)
    link_re = re.compile(r'href=["\']([^"\']+\.pdf)["\']', re.I)

    for page_year, urls in index_urls.items():
        if page_year not in years:
            continue
        for url in urls if isinstance(urls, list) else [urls]:
            r = requests.get(url, timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
            r.raise_for_status()
            current_council = None

            for m in block_re.finditer(r.text):
                tag = m.group("tag").lower()
                html = m.group("html")
                text = _zen_to_half(_html_to_text(html))

                if tag == "p":
                    tm = title_re.search(text)
                    if not tm:
                        continue
                    year = 2018 + int(tm.group(1))
                    if year not in years:
                        current_council = None
                        continue
                    current_council = {
                        "year": year,
                        "seq": int(tm.group(2)),
                        "type": tm.group(3),
                        "title": re.sub(r"\s+", " ", text).strip(),
                    }
                    continue

                if tag != "tr" or not current_council:
                    continue
                if "会議録第" not in text:
                    continue
                href_m = link_re.search(html)
                if not href_m:
                    continue
                href = href_m.group(1)
                full = urljoin(url, href)
                if full in seen:
                    continue
                seen.add(full)
                schedule_m = re.search(r"第\s*(\d+)\s*号", text)
                schedule_no = int(schedule_m.group(1)) if schedule_m else 1

                records.append({
                    "type": current_council["type"],
                    "year": current_council["year"],
                    "seq": current_council["seq"],
                    "filename": full.rsplit("/", 1)[-1],
                    "link_text": f"会議録第{schedule_no}号",
                    "council_name": current_council["title"],
                    "url": full,
                    "sort_key": (schedule_no, full),
                })
            time.sleep(0.2)

    return records


def extract_pdf_links_by_monthly_meeting_linktext(cfg: dict, years: list[int]) -> list[dict]:
    """通年会期制の「M月会議」リンクテキストを会期単位へ束ねる戦略。

    例:
      定例会9月会議第3号（9月19日）
      定例会11月第2回会議（11月27日）
      定例会1月会議（1月27日）
    """
    type_re = re.compile(r"(定例|臨時)(?:[^、\n]*?)会")
    era_re = re.compile(r"令和\s*(\d+)\s*年")
    month_meeting_re = re.compile(r"(\d+)\s*月(?:第(\d+)回)?会議")
    schedule_re = re.compile(r"第(\d+)号")
    date_re = re.compile(r"(\d+)\s*月\s*(\d+)日")

    records: list[dict] = []
    index_urls = cfg["index_urls"] if "index_urls" in cfg else {y: cfg["index_url"] for y in years}

    for year, urls in index_urls.items():
        if isinstance(year, int) and year not in years:
            continue
        url_list = urls if isinstance(urls, list) else [urls]
        for url in url_list:
            r = requests.get(url, timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
            r.raise_for_status()
            for m in re.finditer(
                r'<a[^>]+href=["\']([^"\']+\.pdf)["\'][^>]*>([\s\S]{1,300}?)</a>',
                r.text,
                re.I,
            ):
                href = m.group(1)
                raw = re.sub(r"<[^>]+>", "", m.group(2))
                text = _zen_to_half(re.sub(r"\s+", " ", raw).strip())
                tm = type_re.search(text)
                mm = month_meeting_re.search(text)
                if not mm:
                    continue
                if tm:
                    ttype = f"{tm.group(1)}会"
                else:
                    ttype = cfg.get("default_type")
                    if not ttype:
                        continue
                em = era_re.search(text)
                if em:
                    actual_year = 2018 + int(em.group(1))
                elif isinstance(year, int):
                    actual_year = year
                else:
                    continue
                if actual_year not in years:
                    continue

                month = int(mm.group(1))
                monthly_round = int(mm.group(2) or 1)
                seq = month * 10 + monthly_round
                schedule_m = schedule_re.search(text)
                schedule_no = int(schedule_m.group(1)) if schedule_m else 0
                date_m = date_re.search(text)
                day = int(date_m.group(2)) if date_m else 0

                if cfg.get("council_name_from_month"):
                    round_label = f"第{monthly_round}回" if monthly_round > 1 else ""
                    council_name = f"{era_str(actual_year)}{month}月{round_label}会議"
                else:
                    council_text = re.sub(r"第\s*\d+号.*$", "", text).strip()
                    council_text = re.sub(r"（\s*\d+\s*月\s*\d+\s*日\s*）", "", council_text).strip()
                    council_name = f"{era_str(actual_year)}{council_text}"
                records.append({
                    "type": ttype,
                    "year": actual_year,
                    "seq": seq,
                    "filename": href.rsplit("/", 1)[-1],
                    "link_text": text[:80],
                    "council_name": council_name,
                    "url": urljoin(url, href),
                    "sort_key": (month, monthly_round, schedule_no, day, href),
                })
    return records


def extract_pdf_links_by_monthly_meeting_table(cfg: dict, years: list[int]) -> list[dict]:
    """通年会期制の月会議テーブルを会期単位へ束ねる戦略。

    会議名は表見出し、日程名は各PDFリンクに分かれている構造を扱う。
    """
    heading_re = re.compile(r"(?:洞爺湖町議会)?令和\s*(\d+)\s*年\s*(\d+)\s*月(?:第(\d+)回)?会議")
    link_re = re.compile(r'<a[^>]+href=["\']([^"\']+\.pdf)["\'][^>]*>([\s\S]{0,200}?)</a>', re.I)
    day_re = re.compile(r"第\s*(\d+)\s*日目")
    date_re = re.compile(r"(\d+)\s*月\s*(\d+)日")

    records: list[dict] = []
    seen: set[str] = set()
    index_urls = cfg["index_urls"] if "index_urls" in cfg else {None: cfg["index_url"]}

    for expected_year, urls in index_urls.items():
        if expected_year is not None and expected_year not in years:
            continue
        url_list = urls if isinstance(urls, list) else [urls]
        for url in url_list:
            r = requests.get(url, timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
            r.raise_for_status()
            parts = re.split(
                r"(<td[^>]*colspan=[\"']?7[\"']?[^>]*>[\s\S]{1,200}?会議[\s\S]{0,100}?</td>)",
                r.text,
                flags=re.I,
            )
            for i in range(1, len(parts), 2):
                heading = _zen_to_half(_html_to_text(parts[i]))
                hm = heading_re.search(heading)
                if not hm:
                    continue
                year = 2018 + int(hm.group(1))
                if year not in years:
                    continue
                month = int(hm.group(2))
                monthly_round = int(hm.group(3) or 1)
                seq = month * 10 + monthly_round
                body = parts[i + 1] if i + 1 < len(parts) else ""

                link_texts: dict[str, list[str]] = {}
                for m in link_re.finditer(body):
                    href = m.group(1)
                    text = _zen_to_half(_html_to_text(m.group(2)))
                    if not text or "目次" in text:
                        continue
                    link_texts.setdefault(href, []).append(text)

                for href, texts in link_texts.items():
                    if href in seen:
                        continue
                    text = "".join(texts)

                    day_match = day_re.search(text)
                    date_match = date_re.search(text)
                    schedule_no = int(day_match.group(1)) if day_match else 0
                    day = int(date_match.group(2)) if date_match else 0
                    if schedule_no == 0 and day == 0:
                        continue

                    seen.add(href)
                    records.append({
                        "type": "定例会",
                        "year": year,
                        "seq": seq,
                        "filename": href.rsplit("/", 1)[-1],
                        "link_text": text[:80],
                        "council_name": f"{era_str(year)}{month}月会議",
                        "url": urljoin(url, href),
                        "sort_key": (month, monthly_round, schedule_no, day, href),
                    })
    return records


ERA_RE = re.compile(r"令和(\d+)年")


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
    year_tag = cfg.get("year_tag", "").lower()
    year_from_heading = cfg.get("year_from_heading", False)
    pdf_filter = cfg.get("pdf_filter", "")
    if isinstance(pdf_filter, str):
        pdf_filter = [pdf_filter] if pdf_filter else []
    records: list[dict] = []

    for year, urls in index_urls.items():
        # year_from_heading モードでは year=None を許容し、heading から年度を取る
        if not year_from_heading and not year_tag and year not in years:
            continue
        url_list = urls if isinstance(urls, list) else [urls]
        for url in url_list:
            r = requests.get(url, timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
            r.raise_for_status()
            html = r.text

            current_council = None  # {"type", "seq", "title"}
            current_pdfs = []
            current_section_year = year

            def finalize():
                nonlocal current_council, current_pdfs
                if current_council and current_pdfs:
                    for order, (fn, full, link_text) in enumerate(current_pdfs, 1):
                        records.append({
                            "type": current_council["type"],
                            "year": current_council.get("year", year),
                            "seq": current_council["seq"],
                            "filename": fn,
                            "link_text": link_text or fn.replace(".pdf", ""),
                            "url": full,
                            "sort_key": (order, fn),
                        })
                current_council = None
                current_pdfs = []

            for m in TAG_RE.finditer(html):
                tag = m.group("tag").lower()
                text = re.sub(r"<[^>]+>", "", m.group("text")).strip()
                attrs = m.group("attrs")

                if year_tag and tag == year_tag:
                    finalize()
                    current_section_year = japanese_year_to_int(_zen_to_half(text))
                    continue

                if tag == council_tag:
                    finalize()
                    text_half = _zen_to_half(text)
                    # year_from_heading: council見出しから年度を抽出
                    current_year = current_section_year
                    if year_from_heading:
                        ym = ERA_RE.search(text_half)
                        current_year = (2018 + int(ym.group(1))) if ym else None
                        if current_year not in years:
                            current_council = None
                            continue
                    # まず「第N回」があればそちらを優先（例: ニセコ「第2回ニセコ町議会定例会」）
                    sm = re.search(r"第\s*(\d+)\s*回", text_half)
                    if "定例会" in text:
                        if sm:
                            current_council = {"type": "定例会", "seq": int(sm.group(1)), "title": text, "year": current_year}
                        else:
                            mm_match = re.search(r"(\d+)\s*月", text_half)
                            if mm_match:
                                mm = int(mm_match.group(1))
                                seq = MONTH_TO_TEIREI_SEQ.get(mm, mm)
                                current_council = {"type": "定例会", "seq": seq, "title": text, "year": current_year}
                    elif "臨時会" in text:
                        if sm:
                            current_council = {"type": "臨時会", "seq": int(sm.group(1)), "title": text, "year": current_year}
                    continue

                if tag == "a" and not current_council and cfg.get("flat_council_links"):
                    href_m = HREF_RE.search(attrs)
                    if not href_m:
                        continue
                    href = href_m.group(1)
                    if ".pdf" not in href.lower():
                        continue
                    text_half = _zen_to_half(text)
                    sm = re.search(r"第\s*(\d+)\s*回", text_half)
                    ttype = next((label for label in ("定例会", "臨時会") if label in text_half), None)
                    if not sm or not ttype or current_section_year not in years:
                        continue
                    if pdf_filter:
                        haystack = f"{href.lower()} {text_half}"
                        if not any(kw.lower() in haystack.lower() for kw in pdf_filter):
                            continue
                    full = urljoin(url, href)
                    fn = href.rsplit("/", 1)[-1]
                    records.append({
                        "type": ttype,
                        "year": current_section_year,
                        "seq": int(sm.group(1)),
                        "filename": fn,
                        "link_text": text_half[:60],
                        "url": full,
                        "sort_key": (fn,),
                    })
                    continue

                if tag == "a" and current_council:
                    href_m = HREF_RE.search(attrs)
                    if not href_m:
                        continue
                    href = href_m.group(1)
                    if ".pdf" not in href.lower():
                        continue
                    if pdf_filter:
                        haystack = f"{href.lower()} {text}"
                        if not any(kw.lower() in haystack.lower() for kw in pdf_filter):
                            continue
                    full = urljoin(url, href)
                    fn = href.rsplit("/", 1)[-1]
                    current_pdfs.append((fn, full, text[:60]))

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
    year_tag = cfg["year_tag"].lower()
    type_tag = cfg["type_tag"].lower()
    council_tag = cfg["council_tag"].lower()
    pdf_filter = cfg.get("pdf_filter", "")
    years_set = set(years)
    records: list[dict] = []

    if "index_urls" in cfg:
        index_urls = cfg["index_urls"]
    else:
        index_urls = {None: cfg["index_url"]}

    def finalize(current_year, current_type, current_seq, current_pdfs):
        if (
            current_year in years_set
            and current_type
            and current_seq is not None
            and current_pdfs
        ):
            for order, (fn, full, link_text) in enumerate(current_pdfs, 1):
                records.append({
                    "type": current_type,
                    "year": current_year,
                    "seq": current_seq,
                    "filename": fn,
                    "link_text": link_text or fn.replace(".pdf", ""),
                    "url": full,
                    "sort_key": (order, fn),
                })

    for expected_year, urls in index_urls.items():
        if isinstance(expected_year, int) and expected_year not in years_set:
            continue
        url_list = urls if isinstance(urls, list) else [urls]
        for index_url in url_list:
            r = requests.get(index_url, timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
            r.raise_for_status()
            html = r.text

            current_year: int | None = None
            current_type: str | None = None
            current_seq: int | None = None
            current_pdfs: list[tuple[str, str, str]] = []

            for m in TAG_RE.finditer(html):
                tag = m.group("tag").lower()
                text = re.sub(r"<[^>]+>", "", m.group("text")).strip()
                attrs = m.group("attrs")
                text_half = _zen_to_half(text)

                if tag == year_tag:
                    finalize(current_year, current_type, current_seq, current_pdfs)
                    current_pdfs = []
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
                    finalize(current_year, current_type, current_seq, current_pdfs)
                    current_pdfs = []
                    current_seq = None
                    for ttype in ("定例会", "臨時会"):
                        if ttype in text:
                            current_type = ttype
                            break
                    continue

                if tag == council_tag:
                    finalize(current_year, current_type, current_seq, current_pdfs)
                    current_pdfs = []
                    for ttype in ("定例会", "臨時会"):
                        if ttype in text:
                            current_type = ttype
                            break
                    sm = re.search(r"第\s*(\d+)\s*回", text_half)
                    if sm:
                        current_seq = int(sm.group(1))
                    else:
                        current_seq = None
                    continue

                if tag != "a" or current_seq is None:
                    continue
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
                full = urljoin(index_url, href)
                fn = href.rsplit("/", 1)[-1]
                label = re.sub(r"\s*(?:\[PDF[^\]]+\]|［PDF[^］]+］)", "", text).strip()
                # 同一URLの重複排除（「会議録」「ダウンロード」等の並列リンク対応）
                if any(u == full for _, u, _ in current_pdfs):
                    continue
                current_pdfs.append((fn, full, label))

            finalize(current_year, current_type, current_seq, current_pdfs)

    return records


def extract_pdf_links_by_council_minutes_section(cfg: dict, years: list[int]) -> list[dict]:
    """会議見出しの下で「会議録」セクション内PDFだけを拾う戦略。

    士幌町のように、同じ会議見出しの下へ「会議録」「町提出議案」などの
    セクションが並び、PDFリンクが混在するページ向け。
    """
    council_tag = cfg.get("council_tag", "h2").lower()
    section_tag = cfg.get("section_tag", "h4").lower()
    minutes_section_text = cfg.get("minutes_section_text", "会議録")
    skip_filenames = set(cfg.get("skip_filenames", []))
    index_urls = cfg["index_urls"]
    records: list[dict] = []

    for year, urls in index_urls.items():
        if year not in years:
            continue
        url_list = urls if isinstance(urls, list) else [urls]
        for index_url in url_list:
            r = requests.get(index_url, timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
            r.raise_for_status()

            current_council: dict | None = None
            in_minutes_section = False
            order = 0

            for m in TAG_RE.finditer(r.text):
                tag = m.group("tag").lower()
                text = re.sub(r"<[^>]+>", "", m.group("text")).strip()
                attrs = m.group("attrs")
                text_half = _zen_to_half(text)

                if tag == council_tag:
                    sm = re.search(r"第\s*(\d+)\s*回", text_half)
                    current_council = None
                    in_minutes_section = False
                    order = 0
                    if not sm:
                        continue
                    if "定例会" in text:
                        current_council = {"type": "定例会", "seq": int(sm.group(1))}
                    elif "臨時会" in text:
                        current_council = {"type": "臨時会", "seq": int(sm.group(1))}
                    continue

                if tag == section_tag:
                    in_minutes_section = minutes_section_text in text
                    continue

                if tag != "a" or not current_council or not in_minutes_section:
                    continue
                href_m = HREF_RE.search(attrs)
                if not href_m:
                    continue
                href = href_m.group(1)
                if ".pdf" not in href.lower():
                    continue
                order += 1
                full = urljoin(index_url, href)
                fn = href.rsplit("/", 1)[-1]
                if fn in skip_filenames:
                    continue
                records.append({
                    "type": current_council["type"],
                    "year": year,
                    "seq": current_council["seq"],
                    "filename": fn,
                    "link_text": text[:80],
                    "url": full,
                    "sort_key": (order, fn),
                })

    return records


def _dates_from_japanese_text(text: str) -> list[str]:
    text_half = _zen_to_half(text)
    m = re.search(
        r"(\d+)\s*月\s*(\d+)\s*日(?:\s*[～〜~-]\s*(?:(\d+)\s*月\s*)?(\d+)\s*日)?",
        text_half,
    )
    if not m:
        return []
    start_month = int(m.group(1))
    start_day = int(m.group(2))
    end_month = int(m.group(3) or start_month) if m.group(4) else None
    end_day = int(m.group(4)) if m.group(4) else None
    dates = [f"{start_month}月{start_day}日"]
    if end_month and end_day:
        dates.append(f"{end_month}月{end_day}日")
    return dates


def extract_pdf_links_by_result_following_minutes(cfg: dict, years: list[int]) -> list[dict]:
    """議決結果リンクの直後に並ぶ会議録PDFを会期単位へ束ねる戦略。

    例: 秩父別町
      h2 「定例会」
      a 「第1回町議会定例会議決結果（3月11日～12日）」
      a 「会議録（3月11日）」
      a 「会議録（3月12日）」
    """
    records: list[dict] = []
    years_set = set(years)

    for year, urls in cfg["index_urls"].items():
        if isinstance(year, int) and year not in years_set:
            continue
        url_list = urls if isinstance(urls, list) else [urls]
        for index_url in url_list:
            r = requests.get(index_url, timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
            r.raise_for_status()

            current_type: str | None = None
            current_seq: int | None = None
            current_dates: list[str] = []
            date_cursor = 0

            for m in TAG_RE.finditer(r.text):
                tag = m.group("tag").lower()
                text = _zen_to_half(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group("text"))).strip())
                attrs = m.group("attrs")

                if tag == "h2":
                    if text in ("定例会", "臨時会"):
                        current_type = text
                        current_seq = None
                        current_dates = []
                        date_cursor = 0
                    continue

                if tag != "a":
                    continue
                href_m = HREF_RE.search(attrs)
                if not href_m:
                    continue
                href = href_m.group(1)
                if ".pdf" not in href.lower():
                    continue

                if "議決結果" in text:
                    if not current_type:
                        for ttype in ("定例会", "臨時会"):
                            if ttype in text:
                                current_type = ttype
                                break
                    sm = re.search(r"第\s*(\d+)\s*回", text)
                    current_seq = int(sm.group(1)) if sm else None
                    current_dates = _dates_from_japanese_text(text)
                    date_cursor = 0
                    continue

                if "会議録" not in text or not current_type or current_seq is None:
                    continue
                link_dates = _dates_from_japanese_text(text)
                if link_dates:
                    link_text = link_dates[0]
                elif date_cursor < len(current_dates):
                    link_text = current_dates[date_cursor]
                    date_cursor += 1
                else:
                    link_text = f"第{date_cursor + 1}日"
                    date_cursor += 1

                records.append({
                    "type": current_type,
                    "year": year,
                    "seq": current_seq,
                    "filename": href.rsplit("/", 1)[-1],
                    "link_text": link_text,
                    "url": urljoin(index_url, href),
                    "sort_key": (current_seq, date_cursor, href),
                })

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
    type_re = re.compile(r"(定例|臨時)(?:[^、\n]*?)会")
    # 「M月会議」形式（白老町等） — M月 を seq として扱う
    month_kaigi_re = re.compile(r"(\d+)\s*月会議")
    schedule_re = re.compile(r"第(\d+)号")
    pdf_filter = cfg.get("pdf_filter", ["会議録", "kaigiroku"])
    # 詳細ページのH1/titleから council情報を抽出するモード（shiraoi等、リンクテキストに情報がない場合）
    use_detail_title = cfg.get("use_detail_title", False)
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
                full = urljoin(url, href)

                if use_detail_title:
                    # 詳細ページを一度fetchしてH1/titleから council情報を取る（shiraoi等）
                    # リンクテキストで明らかに関係なさそうなものは先にフィルタ
                    if not ("定例会" in text or "臨時会" in text or "会議録" in text):
                        continue
                    if not any(d["url"] == full for d in detail_targets):
                        try:
                            pr = requests.get(full, timeout=15, headers=HEADERS)
                            pr.encoding = pr.apparent_encoding or "utf-8"
                            title_m = re.search(r"<h1[^>]*>([\s\S]{1,200}?)</h1>", pr.text, re.I)
                            title_text = _zen_to_half(re.sub(r"<[^>]+>", "", title_m.group(1)).strip()) if title_m else ""
                        except Exception:
                            title_text = ""
                        if not title_text:
                            continue
                        em = era_re.search(title_text)
                        tm = type_re.search(title_text)
                        sm = seq_re.search(title_text) or month_kaigi_re.search(title_text)
                        if not (em and tm and sm):
                            continue
                        actual_year = 2018 + int(em.group(1))
                        if actual_year not in years:
                            continue
                        detail_targets.append({
                            "url": full,
                            "year": actual_year,
                            "seq": int(sm.group(1)),
                            "type": f"{tm.group(1)}会",
                            "title": title_text[:80],
                        })
                        time.sleep(0.2)
                    continue

                em = era_re.search(text)
                tm = type_re.search(text)
                sm = seq_re.search(text)
                if not (tm and sm):
                    continue
                if em:
                    actual_year = 2018 + int(em.group(1))
                elif isinstance(year, int):
                    actual_year = year
                else:
                    continue
                if actual_year not in years:
                    continue
                detail_targets.append({
                    "url": full,
                    "year": actual_year,
                    "seq": int(sm.group(1)),
                    "type": f"{tm.group(1)}会",
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
            full_url = urljoin(d["url"], href)
            if full_url in seen_files:
                continue
            seen_files.add(full_url)
            sch = schedule_re.search(text)
            schedule_no = int(sch.group(1)) if sch else None
            explicit_year = era_re.search(text)
            explicit_type = type_re.search(text)
            explicit_seq = seq_re.search(text)
            if explicit_year and explicit_type and explicit_seq:
                record_year = 2018 + int(explicit_year.group(1))
                if record_year not in years:
                    continue
                record_type = f"{explicit_type.group(1)}会"
                record_seq = int(explicit_seq.group(1))
            else:
                record_year = d["year"]
                record_type = d["type"]
                record_seq = d["seq"]
            records.append({
                "type": record_type,
                "year": record_year,
                "seq": record_seq,
                "filename": fn,
                "link_text": text[:60],
                "url": full_url,
                "sort_key": (schedule_no or 0, fn),
            })
    return records


def extract_pdf_links_by_entry_pdf_attachments(cfg: dict, years: list[int]) -> list[dict]:
    """年見出しつき一覧から記事詳細へ進み、詳細内の添付PDFを取得する戦略。"""
    seq_re = re.compile(r"第\s*(\d+)\s*回")
    type_re = re.compile(r"(定例|臨時)(?:[^、\n]*?)会")
    pdf_filter = cfg.get("pdf_filter", ["会議録", ".pdf"])
    exclude_keywords = cfg.get("exclude_detail_keywords", [])
    year_tag = cfg.get("year_tag", "h2").lower()
    if isinstance(pdf_filter, str):
        pdf_filter = [pdf_filter]

    if "index_urls" in cfg:
        index_urls = cfg["index_urls"]
    else:
        index_urls = {None: cfg["index_url"]}

    detail_targets: list[dict] = []
    seen_detail_urls = set()
    for index_year, urls in index_urls.items():
        url_list = urls if isinstance(urls, list) else [urls]
        for index_url in url_list:
            r = requests.get(index_url, timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
            r.raise_for_status()
            current_year = index_year if isinstance(index_year, int) else None

            for m in TAG_RE.finditer(r.text):
                tag = m.group("tag").lower()
                text = _zen_to_half(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group("text"))).strip())
                if tag == year_tag:
                    current_year = japanese_year_to_int(text)
                    continue
                if tag != "a" or not current_year or current_year not in years:
                    continue
                if any(kw in text for kw in exclude_keywords):
                    continue
                tm = type_re.search(text)
                sm = seq_re.search(text)
                if not (tm and sm):
                    continue
                href_m = HREF_RE.search(m.group("attrs"))
                if not href_m:
                    continue
                full = urljoin(index_url, href_m.group(1))
                if full in seen_detail_urls:
                    continue
                seen_detail_urls.add(full)
                detail_targets.append({
                    "url": full,
                    "year": current_year,
                    "seq": int(sm.group(1)),
                    "type": f"{tm.group(1)}会",
                    "title": text[:80],
                })

    print(f"    → 詳細ページ: {len(detail_targets)}件", flush=True)

    records: list[dict] = []
    seen_urls = set()
    for d in detail_targets:
        try:
            r = requests.get(d["url"], timeout=30, headers=HEADERS)
            r.encoding = r.apparent_encoding or "utf-8"
            r.raise_for_status()
        except Exception as e:
            print(f"      ✗ 詳細取得失敗 {d['url']}: {e}", flush=True)
            continue
        time.sleep(0.3)
        for m in re.finditer(
            r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>([\s\S]{0,300}?)</a>',
            r.text,
            re.I,
        ):
            href = m.group(1)
            if href.startswith("#") or href.startswith("javascript:"):
                continue
            text = _zen_to_half(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(2))).strip())
            haystack = f"{href.lower()} {text.lower()}"
            if not any(kw.lower() in haystack for kw in pdf_filter):
                continue
            full = urljoin(d["url"], href)
            if full in seen_urls:
                continue
            seen_urls.add(full)
            records.append({
                "type": d["type"],
                "year": d["year"],
                "seq": d["seq"],
                "filename": href.rsplit("/", 1)[-1],
                "link_text": text[:60],
                "url": full,
                "sort_key": (0, text, full),
            })
    return records


def extract_pdf_links_by_minutes_table_rows(cfg: dict, years: list[int]) -> list[dict]:
    """開催日・会議名・PDF列を持つ表から本会議PDFを取得する戦略。"""
    index_urls: dict = cfg["index_urls"]
    records: list[dict] = []
    seen = set()

    for page_year, url in index_urls.items():
        if page_year not in years:
            continue
        r = requests.get(url, timeout=30, headers=HEADERS)
        r.encoding = r.apparent_encoding or "utf-8"
        r.raise_for_status()

        for row_m in re.finditer(r"<tr[\s\S]*?</tr>", r.text, re.I):
            row = row_m.group(0)
            href_m = re.search(r'href=["\']([^"\']+\.pdf)["\']', row, re.I)
            if not href_m:
                continue
            cells = re.findall(r"<td[^>]*>([\s\S]*?)</td>", row, re.I)
            if len(cells) < 2:
                continue
            date_text = _zen_to_half(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", cells[0])).strip())
            title = _zen_to_half(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", cells[1])).strip())
            if "定例会" not in title and "臨時会" not in title:
                continue

            dm = re.search(r"(\d{4})年\s*(\d+)月\s*(\d+)日", date_text)
            sm = re.search(r"第\s*(\d+)\s*回", title)
            if not dm or not sm:
                continue
            year = int(dm.group(1))
            if year not in years:
                continue
            ttype = "定例会" if "定例会" in title else "臨時会"
            schedule_m = re.search(r"第\s*(\d+)\s*号", title)
            schedule_no = int(schedule_m.group(1)) if schedule_m else 1
            href = href_m.group(1)
            full = urljoin(url, href)
            if full in seen:
                continue
            seen.add(full)

            records.append({
                "type": ttype,
                "year": year,
                "seq": int(sm.group(1)),
                "filename": href.rsplit("/", 1)[-1],
                "link_text": title,
                "url": full,
                "date": f"{year:04d}-{int(dm.group(2)):02d}-{int(dm.group(3)):02d}",
                "sort_key": (int(dm.group(2)), int(dm.group(3)), schedule_no, full),
            })

    return records


def _html_to_text(fragment: str) -> str:
    fragment = re.sub(r"(?i)<br\s*/?>", "\n", fragment)
    fragment = re.sub(r"(?i)</p\s*>", "\n", fragment)
    fragment = re.sub(r"(?i)</(?:div|tr|li|h[1-6])\s*>", "\n", fragment)
    fragment = re.sub(r"<script[\s\S]*?</script>", "", fragment, flags=re.I)
    fragment = re.sub(r"<style[\s\S]*?</style>", "", fragment, flags=re.I)
    text = re.sub(r"<[^>]+>", "", fragment)
    text = unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return text.strip()


def extract_html_text(url: str) -> str:
    r = requests.get(url, timeout=30, headers=HEADERS)
    r.encoding = r.apparent_encoding or "utf-8"
    r.raise_for_status()
    html = r.text
    m = re.search(
        r'<div[^>]+class=["\'][^"\']*content-inner[^"\']*["\'][^>]*>([\s\S]*?)<div[^>]+class=["\'][^"\']*inquiry-box',
        html,
        re.I,
    )
    body = m.group(1) if m else html
    return _html_to_text(body)


def extract_dbsr_html_text(url: str) -> str:
    r = requests.get(url, timeout=30, headers=HEADERS)
    r.encoding = r.apparent_encoding or "utf-8"
    r.raise_for_status()
    chunks = []
    for m in re.finditer(
        r'<p[^>]+class=["\'][^"\']*voice__text[^"\']*["\'][^>]*>([\s\S]*?)</p>',
        r.text,
        re.I,
    ):
        text = _html_to_text(m.group(1)).replace("◯", "○")
        if text:
            chunks.append(text)
    return "\n\n".join(chunks)


def extract_pdf_links_by_dbsr_library_html(cfg: dict, years: list[int]) -> list[dict]:
    """DBSRの会議録ライブラリから本文HTMLリンクを取得する戦略。"""
    index_url = cfg["index_url"]
    r = requests.get(index_url, timeout=30, headers=HEADERS)
    r.encoding = r.apparent_encoding or "utf-8"
    r.raise_for_status()

    records: list[dict] = []
    seen = set()
    council_link_re = re.compile(
        r'<a[^>]+href=["\']([^"\']+\?[^"\']*Template=List[^"\']*)["\'][^>]*>([\s\S]{1,160}?)</a>',
        re.I,
    )
    detail_link_re = re.compile(
        r'<a[^>]+href=["\']([^"\']+\?[^"\']*Template=document[^"\']*)["\'][^>]*>([\s\S]{1,180}?)</a>',
        re.I,
    )

    for href, link_html in council_link_re.findall(r.text):
        title = _zen_to_half(_html_to_text(link_html))
        if "定例会" not in title and "臨時会" not in title:
            continue
        year = japanese_year_to_int(title)
        if year not in years:
            continue
        seq_m = re.search(r"第\s*(\d+)\s*回", title)
        if not seq_m:
            continue
        ttype = "定例会" if "定例会" in title else "臨時会"
        seq = int(seq_m.group(1))
        list_url = urljoin(index_url, href.replace("&amp;", "&"))

        lr = requests.get(list_url, timeout=30, headers=HEADERS)
        lr.encoding = lr.apparent_encoding or "utf-8"
        lr.raise_for_status()
        for order, (doc_href, doc_html) in enumerate(detail_link_re.findall(lr.text), 1):
            doc_text = _zen_to_half(_html_to_text(doc_html))
            if "本文" not in doc_text:
                continue
            full = urljoin(list_url, doc_href.replace("&amp;", "&"))
            if full in seen:
                continue
            seen.add(full)
            schedule_m = re.search(r"第\s*(\d+)\s*号", doc_text)
            schedule_no = int(schedule_m.group(1)) if schedule_m else order
            records.append({
                "type": ttype,
                "year": year,
                "seq": seq,
                "filename": f"dbsr-{year}-{TYPE_FLAGS[ttype]}-{seq}-{schedule_no}.html",
                "link_text": doc_text,
                "council_name": title,
                "url": full,
                "source_type": "dbsr_html",
                "sort_key": (schedule_no, full),
            })
        time.sleep(0.2)

    return records


def extract_pdf_links_by_detail_page_daily_pdfs(cfg: dict, years: list[int]) -> list[dict]:
    """年別一覧から会議詳細ページへ入り、日別PDFを取得する戦略。"""
    index_urls: dict = cfg["index_urls"]
    records: list[dict] = []
    seen_detail_urls = set()
    seen_pdf_urls = set()

    detail_href_re = re.compile(r'href=["\']([^"\']*/gikai/gijiroku/\d+/[12]/\d{4}\.html)["\']', re.I)
    title_re = re.compile(r"令和\s*(\d+)\s*年\s*第\s*(\d+)\s*回\s*(定例会|臨時会)")
    date_re = re.compile(r"(\d{2})\.(\d{2})\.(\d{2})")

    for page_year, url in index_urls.items():
        if page_year not in years:
            continue
        r = requests.get(url, timeout=30, headers=HEADERS)
        r.encoding = r.apparent_encoding or "utf-8"
        r.raise_for_status()

        detail_urls = []
        for href in detail_href_re.findall(r.text):
            full = urljoin(url, href)
            if full not in seen_detail_urls:
                seen_detail_urls.add(full)
                detail_urls.append(full)

        for detail_url in detail_urls:
            dr = requests.get(detail_url, timeout=30, headers=HEADERS)
            dr.encoding = dr.apparent_encoding or "utf-8"
            dr.raise_for_status()
            title_text = _zen_to_half(_html_to_text(dr.text))
            tm = title_re.search(title_text)
            if not tm:
                continue
            year = 2018 + int(tm.group(1))
            if year not in years:
                continue
            seq = int(tm.group(2))
            ttype = tm.group(3)
            council_name = f"{era_str(year)}第{seq}回{ttype}"

            for order, row_m in enumerate(re.finditer(r"<tr[\s\S]*?</tr>", dr.text, re.I), 1):
                row = row_m.group(0)
                href_m = re.search(r'href=["\']([^"\']+\.pdf)["\']', row, re.I)
                if not href_m:
                    continue
                href = href_m.group(1)
                if "/kaigiroku/" not in href:
                    continue
                full_pdf_url = urljoin(detail_url, href)
                if full_pdf_url in seen_pdf_urls:
                    continue
                seen_pdf_urls.add(full_pdf_url)

                row_text = _zen_to_half(_html_to_text(row))
                if re.search(r"【[^】]*委員会】", row_text):
                    continue
                dm = date_re.search(row_text)
                if dm and int(dm.group(1)) != year - 2018:
                    actual_date = f"{year - 2018:02d}.{dm.group(2)}.{dm.group(3)}"
                    row_text = f"{row_text[:dm.start()]}{actual_date}{row_text[dm.end():]}"
                    dm = date_re.search(row_text)
                month = int(dm.group(2)) if dm else 0
                day = int(dm.group(3)) if dm else 0
                link_text = row_text
                if dm:
                    link_text = re.sub(r"\s+", " ", row_text[dm.start():]).strip()

                records.append({
                    "type": ttype,
                    "year": year,
                    "seq": seq,
                    "filename": full_pdf_url.rsplit("/", 1)[-1],
                    "link_text": link_text[:100] or f"第{order}日",
                    "council_name": council_name,
                    "url": full_pdf_url,
                    "sort_key": (month, day, order, full_pdf_url),
                })
            time.sleep(0.2)

    return records


def extract_pdf_links_by_list_item_pdf_links(cfg: dict, years: list[int]) -> list[dict]:
    """年・種別見出し配下のliから、号別PDFリンクを取得する戦略。"""
    index_url = cfg["index_url"]
    r = requests.get(index_url, timeout=30, headers=HEADERS)
    r.encoding = r.apparent_encoding or "utf-8"
    r.raise_for_status()

    records: list[dict] = []
    seen = set()
    current_year = None
    current_type = None
    block_re = re.compile(r"<(?P<tag>h3|h4|li)[^>]*>(?P<html>[\s\S]*?)</(?P=tag)>", re.I)
    link_re = re.compile(r'<a[^>]+href=["\']([^"\']+\.pdf)["\'][^>]*>([\s\S]*?)</a>', re.I)

    for m in block_re.finditer(r.text):
        tag = m.group("tag").lower()
        html = m.group("html")
        text = _zen_to_half(_html_to_text(html))

        if tag == "h3":
            current_year = japanese_year_to_int(text)
            current_type = None
            continue
        if tag == "h4":
            current_type = next((ttype for ttype in TYPE_FLAGS if ttype in text), None)
            continue
        if tag != "li" or current_year not in years:
            continue

        ttype = next((label for label in TYPE_FLAGS if label in text), current_type)
        seq_m = re.search(r"第\s*(\d+)\s*回", text)
        if not ttype or not seq_m:
            continue
        seq = int(seq_m.group(1))

        for order, (href, link_html) in enumerate(link_re.findall(html), 1):
            full = urljoin(index_url, href)
            if full in seen:
                continue
            seen.add(full)
            link_text = _zen_to_half(_html_to_text(link_html)) or f"第{order}号"
            schedule_m = re.search(r"第\s*(\d+)\s*号", link_text)
            schedule_no = int(schedule_m.group(1)) if schedule_m else order
            date_m = re.search(r"(20\d{2})(\d{2})(\d{2})", href)
            month = int(date_m.group(2)) if date_m else 0
            day = int(date_m.group(3)) if date_m else 0

            records.append({
                "type": ttype,
                "year": current_year,
                "seq": seq,
                "filename": full.rsplit("/", 1)[-1],
                "link_text": link_text,
                "council_name": f"{era_str(current_year)}第{seq}回{ttype}",
                "url": full,
                "sort_key": (month, day, schedule_no, full),
            })

    return records


def extract_pdf_links_by_html_daily_minutes(cfg: dict, years: list[int]) -> list[dict]:
    """年度一覧から日別HTML会議録を取得する戦略（清水町など）。"""
    index_urls: dict = cfg["index_urls"]
    detail_link_re = re.compile(
        r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>([\s\S]{1,220}?)</a>',
        re.I,
    )
    title_re = re.compile(r"<title[^>]*>([\s\S]{1,240}?)</title>", re.I)
    heading_re = re.compile(r"<h1[^>]*>([\s\S]{1,240}?)</h1>", re.I)
    page_title_re = re.compile(
        r'<div[^>]+class=["\'][^"\']*page-title[^"\']*["\'][^>]*>([\s\S]{1,240}?)</div>',
        re.I,
    )
    council_re = re.compile(r"令和(\d+)年第\s*(\d+)\s*回.*?(定例|臨時)会")
    date_re = re.compile(r"(\d+)月\s*(\d+)日")

    records: list[dict] = []
    seen = set()

    for year, index_url in index_urls.items():
        if year not in years:
            continue
        r = requests.get(index_url, timeout=30, headers=HEADERS)
        r.encoding = r.apparent_encoding or "utf-8"
        r.raise_for_status()

        schedule_urls: list[str] = []
        for m in detail_link_re.finditer(r.text):
            href = m.group(1)
            text = _zen_to_half(_html_to_text(m.group(2)))
            if "議事日程表" not in text:
                continue
            full = urljoin(index_url, href)
            if full not in schedule_urls:
                schedule_urls.append(full)

        for schedule_url in schedule_urls:
            sr = requests.get(schedule_url, timeout=30, headers=HEADERS)
            sr.encoding = sr.apparent_encoding or "utf-8"
            sr.raise_for_status()
            title_match = page_title_re.search(sr.text) or heading_re.search(sr.text) or title_re.search(sr.text)
            schedule_title = _zen_to_half(_html_to_text(title_match.group(1))) if title_match else ""
            cm = council_re.search(schedule_title)
            if not cm:
                continue
            actual_year = 2018 + int(cm.group(1))
            if actual_year not in years:
                continue
            seq = int(cm.group(2))
            ttype = f"{cm.group(3)}会"

            for p in re.finditer(r"<p[^>]*>([\s\S]{1,500}?)</p>", sr.text, re.I):
                paragraph = p.group(1)
                if "当日の全会議録" not in paragraph:
                    continue
                text = _zen_to_half(_html_to_text(paragraph))
                dm = date_re.search(text)
                sort_key = (
                    int(dm.group(1)) if dm else 0,
                    int(dm.group(2)) if dm else 0,
                    text,
                )
                for lm in detail_link_re.finditer(paragraph):
                    link_text = _html_to_text(lm.group(2))
                    if "当日の全会議録" not in link_text:
                        continue
                    full = urljoin(schedule_url, lm.group(1))
                    if full in seen:
                        continue
                    seen.add(full)
                    records.append({
                        "type": ttype,
                        "year": actual_year,
                        "seq": seq,
                        "filename": full.rsplit("/", 1)[-1],
                        "link_text": text[:60],
                        "url": full,
                        "source_type": "html",
                        "sort_key": sort_key,
                    })
            time.sleep(0.2)

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
    if strategy == "rikubetsu_pdf_header":
        return extract_pdf_links_by_rikubetsu_header(cfg, years or [])
    if strategy == "multi_index_html":
        return extract_pdf_links_by_multi_index_html(cfg, years or [])
    if strategy == "year_page_type_sections":
        return extract_pdf_links_by_year_page_type_sections(cfg, years or [])
    if strategy == "pdf_title_pattern":
        return extract_pdf_links_by_pdf_title_pattern(cfg, years or [])
    if strategy == "linktext_pattern":
        return extract_pdf_links_by_linktext_pattern(cfg, years or [])
    if strategy == "linktext_pattern_drilldown":
        return extract_pdf_links_by_linktext_drilldown(cfg, years or [])
    if strategy == "meeting_table_date_links":
        return extract_pdf_links_by_meeting_table_date_links(cfg, years or [])
    if strategy == "heading_table_pdf_links":
        return extract_pdf_links_by_heading_table_pdf_links(cfg, years or [])
    if strategy == "monthly_meeting_linktext":
        return extract_pdf_links_by_monthly_meeting_linktext(cfg, years or [])
    if strategy == "monthly_meeting_table":
        return extract_pdf_links_by_monthly_meeting_table(cfg, years or [])
    if strategy == "nested_html_sections":
        return extract_pdf_links_by_nested_html_sections(cfg, years or [])
    if strategy == "council_minutes_section":
        return extract_pdf_links_by_council_minutes_section(cfg, years or [])
    if strategy == "result_following_minutes":
        return extract_pdf_links_by_result_following_minutes(cfg, years or [])
    if strategy == "category_drilldown":
        return extract_pdf_links_by_category_drilldown(cfg, years or [])
    if strategy == "entry_pdf_attachments":
        return extract_pdf_links_by_entry_pdf_attachments(cfg, years or [])
    if strategy == "minutes_table_rows":
        return extract_pdf_links_by_minutes_table_rows(cfg, years or [])
    if strategy == "detail_page_daily_pdfs":
        return extract_pdf_links_by_detail_page_daily_pdfs(cfg, years or [])
    if strategy == "list_item_pdf_links":
        return extract_pdf_links_by_list_item_pdf_links(cfg, years or [])
    if strategy == "html_daily_minutes":
        return extract_pdf_links_by_html_daily_minutes(cfg, years or [])
    if strategy == "dbsr_library_html":
        return extract_pdf_links_by_dbsr_library_html(cfg, years or [])
    raise ValueError(f"unknown strategy: {strategy}")


# ---------------------------------------------------------------------------
# PDFテキスト抽出
# ---------------------------------------------------------------------------
def extract_pdf_text_ocr(
    pdf_bytes: bytes,
    max_pages: int = 500,
    *,
    dpi: int = 200,
    lang: str = "jpn+eng",
    psm: int = 6,
) -> str:
    if not shutil.which("pdftoppm"):
        raise RuntimeError("pdftoppm is required for OCR fallback")
    if not shutil.which("tesseract"):
        raise RuntimeError("tesseract is required for OCR fallback")

    with tempfile.TemporaryDirectory(prefix="gikai-ocr-") as tmp:
        tmp_path = Path(tmp)
        pdf_path = tmp_path / "source.pdf"
        pdf_path.write_bytes(pdf_bytes)

        subprocess.run(
            [
                "pdftoppm",
                "-f",
                "1",
                "-l",
                str(max_pages),
                "-r",
                str(dpi),
                "-png",
                "source.pdf",
                "page",
            ],
            cwd=tmp,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        texts = []
        for img in sorted(tmp_path.glob("page-*.png")):
            out_base = img.with_suffix("")
            subprocess.run(
                [
                    "tesseract",
                    img.name,
                    out_base.name,
                    "-l",
                    lang,
                    "--psm",
                    str(psm),
                ],
                cwd=tmp,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            txt_path = out_base.with_suffix(".txt")
            if txt_path.exists():
                text = txt_path.read_text(encoding="utf-8", errors="ignore").strip()
                if text:
                    texts.append(text)

        return "\n\n".join(texts).strip()


def extract_pdf_text(
    url: str,
    max_pages: int = 500,
    *,
    ocr_fallback: bool = False,
    ocr_dpi: int = 200,
    ocr_lang: str = "jpn+eng",
    ocr_psm: int = 6,
    ocr_min_text_chars: int = 100,
) -> str:
    last_error = None
    for attempt in range(3):
        try:
            r = requests.get(url, timeout=60, headers=HEADERS)
            r.raise_for_status()
            break
        except Exception as e:
            last_error = e
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    else:
        raise last_error
    pdf_bytes = r.content
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        pages = pdf.pages[:max_pages]
        texts = []
        for p in pages:
            t = p.extract_text() or ""
            if t.strip():
                texts.append(t)
        text = "\n\n".join(texts).strip()
        if not ocr_fallback or len(re.sub(r"\s+", "", text)) >= ocr_min_text_chars:
            return text

    return extract_pdf_text_ocr(
        pdf_bytes,
        max_pages=max_pages,
        dpi=ocr_dpi,
        lang=ocr_lang,
        psm=ocr_psm,
    )


def write_json_atomic(path: Path, data) -> None:
    """同じディレクトリの一時ファイルへ書き切ってから置き換える。"""
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            temp_file.write(json.dumps(data, ensure_ascii=False, indent=2))
        temp_path.replace(path)
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()


def load_existing_index(index_path: Path) -> dict[int, dict]:
    """既存indexが破損している場合は更新せず、呼び出し元へ失敗を返す。"""
    if not index_path.exists():
        return {}

    existing = json.loads(index_path.read_text(encoding="utf-8"))
    if not isinstance(existing, list):
        raise ValueError("index.json のルートが配列ではありません")

    index_map: dict[int, dict] = {}
    for position, entry in enumerate(existing):
        if not isinstance(entry, dict) or "council_id" not in entry:
            raise ValueError(f"index.json[{position}] に council_id がありません")
        council_id = entry["council_id"]
        if not isinstance(council_id, int) or isinstance(council_id, bool):
            raise ValueError(f"index.json[{position}] の council_id が整数ではありません")
        if council_id in index_map:
            raise ValueError(f"index.json に council_id={council_id} が重複しています")
        index_map[council_id] = entry
    return index_map


# ---------------------------------------------------------------------------
# メイン処理
# ---------------------------------------------------------------------------
def scrape_one(
    slug: str,
    years: list[int],
    force: bool,
    *,
    ocr_fallback: bool = False,
    ocr_dpi: int | None = None,
    ocr_psm: int | None = None,
    ocr_max_pages: int | None = None,
) -> int:
    cfg = PDF_CONFIGS.get(slug)
    if not cfg:
        raise ValueError(f"[{slug}] 設定未登録")

    out_dir = DATA_DIR / slug / "minutes"
    index_path = out_dir / "index.json"
    index_existed_before = index_path.exists()
    try:
        index_map = load_existing_index(index_path)
    except Exception as e:
        raise RuntimeError(f"[{slug}] index.json を安全に読めないため更新中止: {e}") from e

    src = cfg.get("index_url") or cfg.get("index_urls") or "-"
    print(f"  [{slug}] 議事録リスト取得: {src}", flush=True)
    records = extract_pdf_links(cfg, years)
    print(f"    → {len(records)}件の議事録を検出", flush=True)
    if not records:
        raise RuntimeError(f"[{slug}] 議事録を1件も検出できませんでした")

    # 対象年のみフィルタ
    target = [r for r in records if r["year"] in years]
    print(f"    → 対象年({years})の議事録: {len(target)}件", flush=True)
    if not target:
        raise RuntimeError(f"[{slug}] 対象年度の議事録を1件も検出できませんでした")
    out_dir.mkdir(parents=True, exist_ok=True)

    def extract_record_text(record: dict) -> str:
        if record.get("source_type") == "html":
            return extract_html_text(record["url"])
        if record.get("source_type") == "dbsr_html":
            return extract_dbsr_html_text(record["url"])
        return extract_pdf_text(
            record["url"],
            max_pages=ocr_max_pages or cfg.get("max_pages", 500),
            ocr_fallback=ocr_fallback or cfg.get("ocr_fallback", False),
            ocr_dpi=ocr_dpi or cfg.get("ocr_dpi", 200),
            ocr_lang=cfg.get("ocr_lang", "jpn+eng"),
            ocr_psm=ocr_psm or cfg.get("ocr_psm", 6),
            ocr_min_text_chars=cfg.get("ocr_min_text_chars", 100),
        )

    def schedule_from_record(record: dict, schedule_id: int, text: str) -> dict:
        schedule_name = record["link_text"] or f"第{schedule_id}日"
        schedule = {
            "schedule_id": schedule_id,
            "name": schedule_name,
            "page_no": schedule_id,
            "minutes": [{
                "minute_id": 1,
                "title": schedule_name,
                "minute_type": "本会議",
                "text": text,
                "source_url": record["url"],
            }],
        }
        if record.get("date"):
            schedule["date"] = record["date"]
        return schedule

    # (year, type, seq) が同じPDFはひとつのcouncilに集約
    # 日付順のschedulesとしてぶら下げる
    groups: dict[tuple[int, str, int], list[dict]] = {}
    for r in target:
        key = (r["year"], r["type"], r["seq"] or 99)
        groups.setdefault(key, []).append(r)

    saved = 0
    failures = []
    for (year, ttype, seq), items in groups.items():
        # sort_key があればそれでソート、なければリンクテキストで安定化
        items.sort(key=lambda x: x.get("sort_key") or x.get("filename", ""))
        type_flag = TYPE_FLAGS.get(ttype, 90)
        council_id = year * 10000 + type_flag * 100 + seq
        council_file = out_dir / f"{council_id}.json"
        previous_index_entry = index_map.get(council_id)
        name = items[0].get("council_name") or f"{era_str(year)}第{seq}回{ttype}"

        if council_file.exists() and not force:
            try:
                existing_council = json.loads(council_file.read_text(encoding="utf-8"))
            except Exception as e:
                print(f"    [keep] {council_id} {name} (既存ファイルを読めないため更新保留: {e})", flush=True)
                failures.append((council_id, str(e)))
                continue

            existing_schedules = existing_council.get("schedules", [])
            existing_by_source: dict[str, dict] = {}
            source_less_schedules = []
            for schedule in existing_schedules:
                source_urls = {
                    minute.get("source_url")
                    for minute in schedule.get("minutes", [])
                    if minute.get("source_url")
                }
                if not source_urls:
                    source_less_schedules.append(schedule)
                    continue
                for source_url in source_urls:
                    existing_by_source.setdefault(source_url, schedule)

            unique_items = []
            discovered_sources = set()
            for item in items:
                source_url = item.get("url")
                if not source_url or source_url in discovered_sources:
                    continue
                discovered_sources.add(source_url)
                unique_items.append(item)

            index_name = existing_council.get("name") or name
            index_year = str(existing_council.get("year") or year)
            index_japanese_year = existing_council.get("japanese_year") or era_str(year)
            index_type_label = existing_council.get("type_label") or f"全会議 > 本会議 > {ttype}"

            def keep_actual_schedule_count() -> None:
                index_map[council_id] = {
                    **(previous_index_entry or {}),
                    "council_id": council_id,
                    "name": index_name,
                    "year": index_year,
                    "japanese_year": index_japanese_year,
                    "type_label": index_type_label,
                    "file": f"{council_id}.json",
                    "schedule_count": len(existing_schedules),
                }

            missing_items = [item for item in unique_items if item["url"] not in existing_by_source]
            no_longer_discovered = set(existing_by_source) - discovered_sources
            schedule_metadata_updated = False
            for item in unique_items:
                existing_schedule = existing_by_source.get(item["url"])
                if existing_schedule is None or not item.get("date"):
                    continue
                if existing_schedule.get("date") != item["date"]:
                    existing_schedule["date"] = item["date"]
                    schedule_metadata_updated = True

            if missing_items and no_longer_discovered:
                print(
                    f"    [keep] {council_id} {index_name} "
                    "(一覧から消えた既存日程と新規日程が同時にあり、順序を安全に確定できないため更新保留)",
                    flush=True,
                )
                for item in missing_items:
                    print(f"      変更候補: + {item['url']}", flush=True)
                for source_url in sorted(no_longer_discovered):
                    print(f"      保持: 今回の一覧にない既存source_url {source_url}", flush=True)
                keep_actual_schedule_count()
                continue

            if source_less_schedules and missing_items:
                print(
                    f"    [keep] {council_id} {index_name} "
                    f"(既存{len(source_less_schedules)}日程にsource_urlがなく安全に比較できないため更新保留)",
                    flush=True,
                )
                for item in missing_items:
                    print(f"      変更候補: + {item['url']}", flush=True)
                keep_actual_schedule_count()
                continue

            if not missing_items:
                print(f"    [skip] {council_id} {index_name} (既存{len(existing_schedules)}日程)", flush=True)
                if schedule_metadata_updated:
                    write_json_atomic(council_file, existing_council)
                    saved += 1
                for source_url in sorted(no_longer_discovered):
                    print(f"      保持: 今回の一覧にない既存source_url {source_url}", flush=True)
                keep_actual_schedule_count()
                continue

            print(
                f"    [update] {council_id} {index_name} "
                f"新規日程{len(missing_items)}件 / 既存{len(existing_schedules)}件",
                flush=True,
            )
            staged_schedules: dict[str, dict] = {}
            update_failed = False
            for item in missing_items:
                print(f"      変更候補: + {item['url']}", flush=True)
                try:
                    text = extract_record_text(item)
                    if not text.strip():
                        raise ValueError("本文が空です")
                    staged_schedules[item["url"]] = schedule_from_record(item, 0, text)
                    print(f"      ✓ {item['link_text']} ({len(text)}文字)", flush=True)
                except Exception as e:
                    print(f"      ✗ {item['link_text']}: {e} (既存会議は変更しません)", flush=True)
                    update_failed = True
                    break
                time.sleep(REQUEST_INTERVAL)

            if update_failed:
                failures.append((council_id, "新規日程の本文を取得できませんでした"))
                keep_actual_schedule_count()
                continue

            ordered_schedules = []
            used_existing_schedule_ids = set()
            for item in unique_items:
                source_url = item["url"]
                if source_url in existing_by_source:
                    existing_schedule = existing_by_source[source_url]
                    schedule_object_id = id(existing_schedule)
                    if schedule_object_id in used_existing_schedule_ids:
                        continue
                    used_existing_schedule_ids.add(schedule_object_id)
                    ordered_schedules.append(existing_schedule)
                elif source_url in staged_schedules:
                    ordered_schedules.append(staged_schedules[source_url])

            for schedule in existing_schedules:
                if id(schedule) not in used_existing_schedule_ids:
                    ordered_schedules.append(schedule)
                else:
                    continue

            normalized_schedules = []
            for schedule_id, schedule in enumerate(ordered_schedules, 1):
                normalized = dict(schedule)
                normalized["schedule_id"] = schedule_id
                normalized["page_no"] = schedule_id
                normalized_schedules.append(normalized)

            updated_council = dict(existing_council)
            updated_council["schedules"] = normalized_schedules
            write_json_atomic(council_file, updated_council)
            existing_schedules = normalized_schedules
            keep_actual_schedule_count()
            for source_url in sorted(no_longer_discovered):
                print(f"      保持: 今回の一覧にない既存source_url {source_url}", flush=True)
            print(f"      ✓ 既存本文を保持して全{len(normalized_schedules)}日程へ更新", flush=True)
            saved += 1
            continue

        print(f"    [{council_id}] {name} 日程{len(items)}件 取得...", flush=True)

        schedules = []
        new_council_failed = False
        for idx, r in enumerate(items, 1):
            try:
                text = extract_record_text(r)
                if not text.strip():
                    raise ValueError("本文が空です")
                print(f"      ✓ {r['link_text']} ({len(text)}文字)", flush=True)
            except Exception as e:
                print(f"      ✗ {r['link_text']}: {e} (会議を保存しません)", flush=True)
                new_council_failed = True
                break
            schedules.append(schedule_from_record(r, idx, text))
            time.sleep(REQUEST_INTERVAL)

        if new_council_failed:
            failures.append((council_id, "会議本文を完全に取得できませんでした"))
            if previous_index_entry is None:
                index_map.pop(council_id, None)
            else:
                index_map[council_id] = previous_index_entry
            continue

        council_data = {
            "council_id": council_id,
            "name": name,
            "year": str(year),
            "japanese_year": era_str(year),
            "type_label": f"全会議 > 本会議 > {ttype}",
            "schedules": schedules,
        }
        write_json_atomic(council_file, council_data)
        index_map[council_id] = {
            **(previous_index_entry or {}),
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
    if index_list or index_existed_before:
        write_json_atomic(index_path, index_list)
    else:
        print("  ! 取得成功した会議がないため index.json は作成しません", flush=True)
    print(f"  ✓ 完了: {saved}件取得 / 全{len(index_list)}件 → {out_dir}", flush=True)
    if failures:
        failed_ids = ", ".join(str(council_id) for council_id, _ in failures)
        raise RuntimeError(f"[{slug}] {len(failures)} council(s) failed: {failed_ids}")
    return saved


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", nargs="+", required=True)
    ap.add_argument("--years", default=",".join(DEFAULT_YEARS))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--ocr-fallback", action="store_true", help="PDFテキスト抽出が空に近い場合だけTesseract OCRを使う")
    ap.add_argument("--ocr-dpi", type=int, default=None)
    ap.add_argument("--ocr-psm", type=int, default=None)
    ap.add_argument("--ocr-max-pages", type=int, default=None)
    args = ap.parse_args()

    years = [int(y) for y in args.years.split(",") if y.strip()]
    failures = []
    for slug in args.slug:
        print(f"=== {slug} (years={years}) ===", flush=True)
        try:
            scrape_one(
                slug,
                years,
                args.force,
                ocr_fallback=args.ocr_fallback,
                ocr_dpi=args.ocr_dpi,
                ocr_psm=args.ocr_psm,
                ocr_max_pages=args.ocr_max_pages,
            )
        except Exception as e:
            print(f"  ✗ エラー: {e}", flush=True)
            import traceback; traceback.print_exc()
            failures.append((slug, str(e)))
    if failures:
        print("失敗した自治体:", flush=True)
        for slug, error in failures:
            print(f"  - {slug}: {error}", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
