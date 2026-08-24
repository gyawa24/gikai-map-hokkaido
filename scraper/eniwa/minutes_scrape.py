"""
恵庭市議会 会議録スクレイパー
対象: https://ssp.kaigiroku.net/tenant/eniwa/MinuteBrowse.html (DNP Discuss システム)
tenant_id: 89
対象会議: 本会議定例会 R6〜R7, 予算審査特別委員会, 決算審査特別委員会
出力: data/eniwa/minutes/index.json および data/eniwa/minutes/{council_id}.json
"""

from pathlib import Path
from datetime import date
import argparse
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scraper.lib.dnp_minutes import run_scrape

TENANT_ID = 89
REQUEST_INTERVAL = 2  # 秒 (アクセス間隔)
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "eniwa" / "minutes"

TARGET_KEYWORDS = [
    "定例会",
    "特別委員会",  # 予算審査特別委員会・決算審査特別委員会をまとめてカバー
]

CURRENT_YEAR = date.today().year
TARGET_YEARS = {str(year) for year in range(CURRENT_YEAR - 5, CURRENT_YEAR + 1)}
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", default=",".join(sorted(TARGET_YEARS)))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    run_scrape(
        slug="eniwa",
        tenant_id=TENANT_ID,
        output_dir=OUTPUT_DIR,
        target_keywords=TARGET_KEYWORDS,
        target_years={year for year in args.years.split(",") if year},
        request_interval=REQUEST_INTERVAL,
        force=args.force,
    )


if __name__ == "__main__":
    main()
