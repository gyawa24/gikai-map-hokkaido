"""
苫小牧市議会 会議録スクレイパー
対象: https://ssp.kaigiroku.net/tenant/tomakomai/MinuteBrowse.html (DNP Discuss システム)
tenant_id: 536
対象会議: 本会議定例会 R6〜R7, 予算審査特別委員会（一般会計・企業会計）, 決算審査特別委員会（同）
出力: data/tomakomai/minutes/index.json および data/tomakomai/minutes/{council_id}.json
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scraper.lib.dnp_minutes import run_scrape

TENANT_ID = 536
REQUEST_INTERVAL = 2  # 秒 (アクセス間隔)
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "tomakomai" / "minutes"

# 対象会議種別キーワード（council_type_name1〜4 のいずれかにマッチ、「資料」は除外）
TARGET_KEYWORDS = [
    "定例会",
    "予算審査特別委員会",
    "決算審査特別委員会",
]

TARGET_YEARS = {"2024", "2025"}  # 令和6年・令和7年
def main():
    run_scrape(
        slug="tomakomai",
        tenant_id=TENANT_ID,
        output_dir=OUTPUT_DIR,
        target_keywords=TARGET_KEYWORDS,
        target_years=TARGET_YEARS,
        request_interval=REQUEST_INTERVAL,
    )


if __name__ == "__main__":
    main()
