"""
苫小牧市議会 会議録スクレイパー
対象: https://ssp.kaigiroku.net/tenant/tomakomai/MinuteBrowse.html (DNP Discuss システム)
tenant_id: 536
対象会議: 本会議定例会 R6〜R7, 予算審査特別委員会（一般会計・企業会計）, 決算審査特別委員会（同）
出力: data/tomakomai/minutes/index.json および data/tomakomai/minutes/{council_id}.json
"""

from pathlib import Path
from datetime import date
import argparse
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

CURRENT_YEAR = date.today().year
TARGET_YEARS = {str(year) for year in range(CURRENT_YEAR - 5, CURRENT_YEAR + 1)}
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", default=",".join(sorted(TARGET_YEARS)))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    run_scrape(
        slug="tomakomai",
        tenant_id=TENANT_ID,
        output_dir=OUTPUT_DIR,
        target_keywords=TARGET_KEYWORDS,
        target_years={year for year in args.years.split(",") if year},
        request_interval=REQUEST_INTERVAL,
        force=args.force,
    )


if __name__ == "__main__":
    main()
