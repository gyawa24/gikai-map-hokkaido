"""
千歳市議会情報スクレイパー
収集対象: 議員名簿 / 議決結果 / 議会だより / 行事予定
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.chitose.lg.jp"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "chitose"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "chitose"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> BeautifulSoup | None:
    """GETしてBeautifulSoupを返す。失敗時はNoneを返す。"""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def save_json(data, filename: str):
    path = OUTPUT_DIR / filename
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  -> 保存: {path}")


# ---------------------------------------------------------------------------
# 1. 議員名簿
# ---------------------------------------------------------------------------

def scrape_members():
    print("\n[1] 議員名簿を収集中...")
    url = f"{BASE_URL}/docs/30520.html"
    soup = fetch(url)
    if soup is None:
        return

    members = []

    # 各 h3 が「議席番号X」に対応する
    for h3 in soup.find_all("h3"):
        text = h3.get_text(strip=True)
        m = re.search(r"議席番号\s*(\d+)", text)
        if not m:
            continue
        seat_number = int(m.group(1))

        # h3 以降の兄弟要素を next_siblings で走査し、次の h3 まで集める
        block_elements = []
        for sibling in h3.next_siblings:
            if sibling.name == "h3":
                break
            block_elements.append(sibling)

        # ブロックをまとめて mini-soup として扱う
        block_html = "".join(str(el) for el in block_elements)
        block = BeautifulSoup(block_html, "html.parser")

        # strong タグから議員名・ふりがなを取得
        # strong テキスト例: "松倉 美加（まつくら みか)" or "松倉 美加"
        strongs = block.find_all("strong")
        raw_name = strongs[0].get_text(strip=True) if strongs else ""
        m_name = re.match(r"^(.+?)（(.+?)[）)]\s*$", raw_name)
        if m_name:
            name = m_name.group(1).strip()
            furigana = m_name.group(2).strip()
        else:
            name = raw_name
            furigana = ""

        # li タグから各種情報を取得
        # li テキスト例: "所属会派 : ちとせ未来クラブ"
        faction = ""
        committees = []
        for li in block.find_all("li"):
            li_text = li.get_text(strip=True)
            if li_text.startswith("所属会派"):
                faction = re.sub(r"^所属会派\s*[：:]\s*", "", li_text).strip()
            elif li_text.startswith("所属委員会"):
                val = re.sub(r"^所属委員会\s*[：:]\s*", "", li_text).strip()
                if val and val != "なし":
                    # 「、」区切りで複数委員会を分割
                    for c in re.split(r"[、,]", val):
                        c = c.strip()
                        if c:
                            committees.append(c)

        # 写真URL（figure > img から取得してローカル保存）
        photo_url = ""
        fig_img = block.find("figure")
        if fig_img:
            img_tag = fig_img.find("img")
            if img_tag and img_tag.get("src"):
                remote_url = urljoin(url, img_tag["src"])
                ext = remote_url.split(".")[-1]
                fname = f"seat_{seat_number}.{ext}"
                try:
                    img_resp = requests.get(remote_url, headers=HEADERS, timeout=10)
                    img_resp.raise_for_status()
                    (PHOTO_DIR / fname).write_bytes(img_resp.content)
                    photo_url = f"/members/chitose/{fname}"
                except Exception as e:
                    print(f"  [WARN] 写真取得失敗 seat {seat_number}: {e}")
                    photo_url = remote_url

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "faction": faction,
            "committees": committees,
            "photo_url": photo_url,
        }
        members.append(member)
        print(f"  {seat_number}: {name}（{furigana}）/ {faction}")

    members.sort(key=lambda x: x["seat_number"])
    save_json(members, "members.json")
    print(f"  合計 {len(members)} 名")


# ---------------------------------------------------------------------------
# 2. 議決結果（直近4回分）
# ---------------------------------------------------------------------------

DECISION_PAGES = [
    {"url": f"{BASE_URL}/docs/40700.html", "session": "令和7年第4回定例会"},
    {"url": f"{BASE_URL}/docs/40358.html", "session": "令和7年第3回定例会"},
    {"url": f"{BASE_URL}/docs/38954.html", "session": "令和7年第2回定例会"},
    {"url": f"{BASE_URL}/docs/37694.html", "session": "令和7年第1回定例会"},
]


def scrape_decisions():
    print("\n[2] 議決結果を収集中...")
    all_decisions = []

    for page_info in DECISION_PAGES:
        time.sleep(1)
        print(f"  {page_info['session']}...")
        soup = fetch(page_info["url"])
        if soup is None:
            continue

        # ページ内の PDF リンクと説明テキストを収集
        pdf_links = []
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if ".pdf" in href.lower() or ".PDF" in href:
                absolute_url = urljoin(page_info["url"], href)
                pdf_links.append({
                    "title": a.get_text(strip=True),
                    "url": absolute_url,
                })

        # ページ本文テキストも取得（議決日・説明文として保存）
        main_content = soup.find("div", id="contents") or soup.find("main") or soup.body
        description = ""
        if main_content:
            # スクリプト・スタイル除去
            for tag in main_content(["script", "style", "nav", "header", "footer"]):
                tag.decompose()
            description = re.sub(r"\s+", " ", main_content.get_text(separator=" ")).strip()[:500]

        entry = {
            "session": page_info["session"],
            "source_url": page_info["url"],
            "pdf_links": pdf_links,
            "description": description,
        }
        all_decisions.append(entry)

        for link in pdf_links:
            print(f"    PDF: {link['title']} -> {link['url']}")

    save_json(all_decisions, "decisions.json")


# ---------------------------------------------------------------------------
# 3. 議会だより（最新号）
# ---------------------------------------------------------------------------

def scrape_newsletter():
    print("\n[3] 議会だよりを収集中...")
    url = f"{BASE_URL}/docs/37094.html"
    soup = fetch(url)
    if soup is None:
        return

    # タイトル
    h1 = soup.find("h1")
    title = h1.get_text(strip=True) if h1 else ""

    # PDF リンク
    pdf_url = ""
    pdf_title = ""
    for a in soup.find_all("a", href=True):
        if ".pdf" in a["href"].lower():
            pdf_url = urljoin(url, a["href"])
            pdf_title = a.get_text(strip=True)
            break

    # 発行年月: タイトルや本文から抽出
    published_date = ""
    page_text = soup.get_text()
    # 「令和X年X月」形式（月まであるもの優先）
    m = re.search(r"令和\s*\d+\s*年\s*\d+\s*月", page_text)
    if m:
        published_date = m.group(0).replace(" ", "")
    # 月がなければ「令和X年第Y回定例会」から年を取得
    if not published_date:
        m = re.search(r"(令和\s*\d+\s*年)\s*第\s*\d+\s*回定例会", title or page_text)
        if m:
            published_date = m.group(1).replace(" ", "")

    newsletter = {
        "title": title,
        "pdf_url": pdf_url,
        "pdf_title": pdf_title,
        "published_date": published_date,
        "source_url": url,
    }
    print(f"  タイトル: {title}")
    print(f"  PDF: {pdf_title} -> {pdf_url}")
    print(f"  発行年月: {published_date}")
    save_json(newsletter, "newsletter.json")


# ---------------------------------------------------------------------------
# 4. 行事予定
# ---------------------------------------------------------------------------

SCHEDULE_INDEX_URL = f"{BASE_URL}/c70/1002791/1002819/1002821/index.html"


def parse_schedule_page(url: str) -> list[dict]:
    """週次行事予定ページからスケジュールを取得する。"""
    soup = fetch(url)
    if soup is None:
        return []

    events = []

    # テーブルから取得
    table = soup.find("table")
    if table:
        rows = table.find_all("tr")
        for row in rows[1:]:  # ヘッダ行をスキップ
            cols = row.find_all(["td", "th"])
            if len(cols) >= 2:
                date_text = cols[0].get_text(strip=True)
                content_text = cols[1].get_text(separator=" ", strip=True)
                if date_text and content_text:
                    events.append({
                        "date": date_text,
                        "content": content_text,
                    })
    else:
        # テーブルがない場合は dl/dt/dd または ul/li を試みる
        dl = soup.find("dl")
        if dl:
            dts = dl.find_all("dt")
            dds = dl.find_all("dd")
            for dt, dd in zip(dts, dds):
                events.append({
                    "date": dt.get_text(strip=True),
                    "content": dd.get_text(strip=True),
                })

    return events


def scrape_schedule():
    print("\n[4] 行事予定を収集中...")
    soup = fetch(SCHEDULE_INDEX_URL)
    if soup is None:
        return

    # インデックスページからサブページへのリンクを収集
    sub_links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        # 行事予定の個別ページは数字IDを持つ html
        full_url = urljoin(SCHEDULE_INDEX_URL, href)
        # index.html 自身や外部リンクは除外
        if (
            full_url.startswith(BASE_URL)
            and full_url != SCHEDULE_INDEX_URL
            and re.search(r"/\d+\.html$", full_url)
            and "行事予定" in text
        ):
            sub_links.append({"url": full_url, "label": text})

    print(f"  サブページ数: {len(sub_links)}")

    all_events = []
    for link in sub_links:
        time.sleep(1)
        print(f"  {link['label']}...")
        events = parse_schedule_page(link["url"])
        for ev in events:
            ev["period_label"] = link["label"]
        all_events.extend(events)
        print(f"    {len(events)} 件")

    # サブページが0件の場合はインデックスページ自体を解析
    if not all_events:
        print("  インデックスページから直接取得を試みます...")
        all_events = parse_schedule_page(SCHEDULE_INDEX_URL)

    save_json(all_events, "schedule.json")
    print(f"  合計 {len(all_events)} 件")


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def main():
    print("=== 千歳市議会情報スクレイパー 開始 ===")

    scrape_members()
    time.sleep(2)

    scrape_decisions()
    time.sleep(2)

    scrape_newsletter()
    time.sleep(2)

    scrape_schedule()

    print("\n=== 完了 ===")


if __name__ == "__main__":
    main()
