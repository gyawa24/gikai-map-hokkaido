"""
千歳市議会 会議録スクレイパー
対象: https://ssp.kaigiroku.net/tenant/chitose/MinuteBrowse.html (DNP Discuss システム)
対象会議: 本会議定例会 R6〜R7, 予算特別委員会, 決算特別委員会, 補正予算関連委員会
出力: data/chitose/minutes/index.json および data/chitose/minutes/{council_id}.json
"""

from pathlib import Path
from datetime import date
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scraper.lib.dnp_minutes import run_scrape

TENANT_ID = 452
REQUEST_INTERVAL = 2  # 秒 (アクセス間隔)
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "chitose" / "minutes"
TARGET_KEYWORDS = [
    "定例会",
    "予算特別委員会",
    "決算特別委員会",
    "補正予算",
    "常任委員会",   # 総務・経済建設・文教民生 etc.
    "臨時会",
]
CURRENT_YEAR = date.today().year
TARGET_YEARS = {str(year) for year in range(CURRENT_YEAR - 5, CURRENT_YEAR + 1)}


def main():
    run_scrape(
        slug="chitose",
        tenant_id=TENANT_ID,
        output_dir=OUTPUT_DIR,
        target_keywords=TARGET_KEYWORDS,
        target_years=TARGET_YEARS,
        request_interval=REQUEST_INTERVAL,
    )


if __name__ == "__main__":
    main()
