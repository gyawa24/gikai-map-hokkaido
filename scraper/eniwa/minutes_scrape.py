"""
恵庭市議会 会議録スクレイパー
対象: https://ssp.kaigiroku.net/tenant/eniwa/MinuteBrowse.html (DNP Discuss システム)
tenant_id: 89
対象会議: 本会議定例会 R6〜R7, 予算審査特別委員会, 決算審査特別委員会
出力: data/eniwa/minutes/index.json および data/eniwa/minutes/{council_id}.json
"""

from pathlib import Path
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

TARGET_YEARS = {"2024", "2025"}  # 令和6年・令和7年
def main():
    run_scrape(
        slug="eniwa",
        tenant_id=TENANT_ID,
        output_dir=OUTPUT_DIR,
        target_keywords=TARGET_KEYWORDS,
        target_years=TARGET_YEARS,
        request_interval=REQUEST_INTERVAL,
    )


if __name__ == "__main__":
    main()
