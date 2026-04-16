"""
岩見沢市議会 議員名簿スクレイパー

岩見沢市議会の公式サイトは議員一覧を PDF のみで公開している。
https://www.city.iwamizawa.hokkaido.jp/soshiki/gikai_jimukyoku/iwamizawashigikai/4/3501.html
→ 第21期岩見沢市議会議員名簿（50音順） (shashin.pdf)
→ 各委員会等の所属名簿 (iinkai.pdf)
→ 各会派等の役員名簿 (R070417_02.pdf)

PDF はレイアウトが複雑で安定したテキスト抽出が難しいため、
この場では PDF をダウンロードして最新 PDF が取得可能かを確認した上で、
人間がレビューした構造化データを出力する。
PDF が更新されたら `PDF_LAST_CHECKED` を更新し、この構造化データを
手動で見直すこと。

出力: site/data/iwamizawa/members.json と data/iwamizawa/members.json
"""

import json
from pathlib import Path

import requests

BASE_URL = "https://www.city.iwamizawa.hokkaido.jp"
ROSTER_PAGE = f"{BASE_URL}/soshiki/gikai_jimukyoku/iwamizawashigikai/4/3501.html"
PDF_URLS = {
    "roster": f"{BASE_URL}/material/files/group/42/shashin.pdf",
    "committees": f"{BASE_URL}/material/files/group/42/iinkai.pdf",
    "factions": f"{BASE_URL}/material/files/group/42/R070417_02.pdf",
}
PDF_LAST_CHECKED = "2025-10-17"

ROOT = Path(__file__).parent.parent.parent
OUT_DIRS = [ROOT / "site" / "data" / "iwamizawa", ROOT / "data" / "iwamizawa"]
for d in OUT_DIRS:
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


# 第21期岩見沢市議会議員（令和7年5月16日現在、22名、50音順）
# 出典: shashin.pdf + iinkai.pdf + R070417_02.pdf
# 議長: 峯 泰教 / 副議長: 豊岡 義博
MEMBERS_DATA = [
    {
        "name": "新井 優也", "furigana": "あらい ゆうや",
        "party": "", "faction": "市民クラブ",
        "committees": ["総務常任委員会"],
    },
    {
        "name": "伊澤 幸信", "furigana": "いざわ ゆきのぶ",
        "party": "自由民主党", "faction": "市民クラブ",
        "committees": ["経済建設常任委員会"],
    },
    {
        "name": "石黒 武美", "furigana": "いしぐろ たけみ",
        "party": "", "faction": "新緑風会",
        "committees": ["民生常任委員会"],
    },
    {
        "name": "猪口 満雅", "furigana": "いのぐち みつまさ",
        "party": "公明党", "faction": "公明党",
        "committees": ["総務常任委員会"],
    },
    {
        "name": "上田 久司", "furigana": "うえだ ひさし",
        "party": "日本共産党", "faction": "日本共産党議員団",
        "committees": ["民生常任委員会"],
    },
    {
        "name": "枝廣 晴基", "furigana": "えだひろ はるき",
        "party": "", "faction": "市民クラブ",
        "committees": ["経済建設常任委員会"],
    },
    {
        "name": "太田 博之", "furigana": "おおた ひろゆき",
        "party": "", "faction": "新緑風会",
        "committees": ["経済建設常任委員会"],
    },
    {
        "name": "河合 清秀", "furigana": "かわい せいしゅう",
        "party": "", "faction": "新緑風会",
        "committees": ["民生常任委員会"],
    },
    {
        "name": "木村 光宏", "furigana": "きむら みつひろ",
        "party": "", "faction": "市民クラブ",
        "committees": ["総務常任委員会"],
    },
    {
        "name": "斉須 正友", "furigana": "さいす まさとも",
        "party": "公明党", "faction": "公明党",
        "committees": ["経済建設常任委員会"],
    },
    {
        "name": "坂井 秋子", "furigana": "さかい あきこ",
        "party": "", "faction": "市民クラブ",
        "committees": ["民生常任委員会"],
    },
    {
        "name": "坂井 照美", "furigana": "さかい てるみ",
        "party": "立憲民主党", "faction": "民優会",
        "committees": ["経済建設常任委員会"],
    },
    {
        "name": "武田 貞行", "furigana": "たけだ さだゆき",
        "party": "", "faction": "市民クラブ",
        "committees": ["総務常任委員会"],
    },
    {
        "name": "豊岡 義博", "furigana": "とよおか よしひろ",
        "party": "", "faction": "市民クラブ",
        "committees": ["経済建設常任委員会"],
    },
    {
        "name": "野尻 清", "furigana": "のじり きよし",
        "party": "", "faction": "市民クラブ",
        "committees": ["民生常任委員会"],
    },
    {
        "name": "日向 清一", "furigana": "ひなた きよかず",
        "party": "", "faction": "民優会",
        "committees": ["総務常任委員会"],
    },
    {
        "name": "平野 義文", "furigana": "ひらの よしふみ",
        "party": "", "faction": "市民クラブ",
        "committees": ["民生常任委員会"],
    },
    {
        "name": "松本 一郎", "furigana": "まつもと いちろう",
        "party": "", "faction": "新緑風会",
        "committees": ["総務常任委員会"],
    },
    {
        "name": "峯 泰教", "furigana": "みね やすのり",
        "party": "自由民主党", "faction": "市民クラブ",
        "committees": ["総務常任委員会"],
    },
    {
        "name": "宮下 透", "furigana": "みやした とおる",
        "party": "自由民主党", "faction": "市民クラブ",
        "committees": ["経済建設常任委員会"],
    },
    {
        "name": "山田 靖廣", "furigana": "やまだ やすひろ",
        "party": "日本共産党", "faction": "日本共産党議員団",
        "committees": ["総務常任委員会"],
    },
    {
        "name": "大和 勝", "furigana": "やまと まさる",
        "party": "", "faction": "民優会",
        "committees": ["民生常任委員会"],
    },
]


def verify_pdfs():
    """PDF が公開されているかチェック（更新時に気づけるように）"""
    print("PDF の到達性を確認中...")
    all_ok = True
    for key, url in PDF_URLS.items():
        try:
            resp = requests.head(url, headers=HEADERS, timeout=15, allow_redirects=True)
            ok = resp.status_code == 200
            print(f"  [{ 'OK' if ok else 'NG' }] {key}: {resp.status_code} {url}")
            all_ok = all_ok and ok
        except Exception as e:
            print(f"  [ERROR] {key}: {e}")
            all_ok = False
    return all_ok


def build_members():
    members = []
    for i, m in enumerate(MEMBERS_DATA, start=1):
        members.append({
            "seat_number": i,
            "name": m["name"],
            "furigana": m["furigana"],
            "party": m["party"],
            "faction": m["faction"],
            "committees": m["committees"],
        })
    return members


def main():
    print("岩見沢市議会 議員名簿スクレイパー")
    print(f"出典: {ROSTER_PAGE}")
    print(f"PDF 最終確認日: {PDF_LAST_CHECKED}")
    print()
    verify_pdfs()
    print()

    members = build_members()
    for d in OUT_DIRS:
        out = d / "members.json"
        out.write_text(
            json.dumps(members, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"書き込み: {out} ({len(members)} 名)")

    print()
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
