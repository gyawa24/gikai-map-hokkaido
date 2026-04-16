"""
北広島市議会 議員名簿スクレイパー
出力: data/kitahiroshima/members.json

データソース: 北広島市議会議員名簿PDF（令和7年9月4日現在）
https://www.city.kitahiroshima.hokkaido.jp/hotnews/files/00120900/00120977/giinmeibo.pdf
"""

import json
import re
import time
from pathlib import Path

import requests

BASE_URL = "https://www.city.kitahiroshima.hokkaido.jp"
PDF_URL = f"{BASE_URL}/hotnews/files/00120900/00120977/giinmeibo.pdf"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "kitahiroshima"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "kitahiroshima"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def build_members():
    """PDFから取得済みのデータを構造化して返す（令和7年9月4日現在）"""
    raw = [
        {
            "seat_number": 20,
            "name": "青木 崇",
            "furigana": "あおき たかし",
            "faction": "自由クラブ",
            "committees": ["建設文教常任委員会 委員長", "議会運営委員会 委員"],
        },
        {
            "seat_number": 10,
            "name": "阿部 勝義",
            "furigana": "あべ かつよし",
            "faction": "自由クラブ",
            "committees": ["民生常任委員会 副委員長", "議会広報編集委員会 委員"],
        },
        {
            "seat_number": 4,
            "name": "稲田 保子",
            "furigana": "いなだ やすこ",
            "faction": "無会派",
            "committees": ["民生常任委員会 委員"],
        },
        {
            "seat_number": 13,
            "name": "大迫 彰",
            "furigana": "おおせこ あきら",
            "faction": "公明党",
            "committees": ["総務常任委員会 副委員長"],
        },
        {
            "seat_number": 18,
            "name": "小田島 雅博",
            "furigana": "おだじま まさひろ",
            "faction": "民主市民連合",
            "committees": [
                "建設文教常任委員会 委員",
                "議会広報編集委員会 委員",
                "地域公共交通影響対策特別委員会 委員",
            ],
        },
        {
            "seat_number": 19,
            "name": "川崎 彰治",
            "furigana": "かわさき しょうじ",
            "faction": "自由クラブ",
            "committees": ["議会運営委員会 委員長", "民生常任委員会 委員"],
        },
        {
            "seat_number": 12,
            "name": "小玉 淳子",
            "furigana": "こだま じゅんこ",
            "faction": "公明党",
            "committees": [
                "建設文教常任委員会 委員",
                "議会広報編集委員会 委員長",
                "地域公共交通影響対策特別委員会 委員",
            ],
        },
        {
            "seat_number": 9,
            "name": "児玉 正輝",
            "furigana": "こだま まさてる",
            "faction": "自由クラブ",
            "committees": [
                "総務常任委員会 委員",
                "議会広報編集委員会 委員",
                "地域公共交通影響対策特別委員会 委員",
            ],
        },
        {
            "seat_number": 1,
            "name": "坂本 覚",
            "furigana": "さかもと さとる",
            "faction": "きたひろ五和会",
            "committees": ["副議長", "建設文教常任委員会 委員"],
        },
        {
            "seat_number": 3,
            "name": "桜井 芳信",
            "furigana": "さくらい よしのぶ",
            "faction": "きたひろ五和会",
            "committees": [
                "総務常任委員会 委員",
                "議会運営委員会 委員",
                "議会広報編集委員会 委員",
                "地域公共交通影響対策特別委員会 委員",
            ],
        },
        {
            "seat_number": 6,
            "name": "佐々木 百合香",
            "furigana": "ささき ゆりか",
            "faction": "市民ネットワーク北海道",
            "committees": [
                "建設文教常任委員会 委員",
                "議会広報編集委員会 副委員長",
                "地域公共交通影響対策特別委員会 委員",
            ],
        },
        {
            "seat_number": 17,
            "name": "佐藤 敏男",
            "furigana": "さとう としお",
            "faction": "民主市民連合",
            "committees": ["総務常任委員会 委員", "議会運営委員会 副委員長"],
        },
        {
            "seat_number": 22,
            "name": "島崎 圭介",
            "furigana": "しまざき けいすけ",
            "faction": "自由クラブ",
            "committees": ["議長"],
        },
        {
            "seat_number": 2,
            "name": "滝 久美子",
            "furigana": "たき くみこ",
            "faction": "きたひろ五和会",
            "committees": ["民生常任委員会 委員長"],
        },
        {
            "seat_number": 7,
            "name": "鶴谷 聡美",
            "furigana": "つるや さとみ",
            "faction": "市民ネットワーク北海道",
            "committees": ["民生常任委員会 委員", "議会運営委員会 委員"],
        },
        {
            "seat_number": 16,
            "name": "永井 桃",
            "furigana": "ながい もも",
            "faction": "日本共産党",
            "committees": ["建設文教常任委員会 副委員長"],
        },
        {
            "seat_number": 21,
            "name": "中川 昌憲",
            "furigana": "なかがわ まさのり",
            "faction": "自由クラブ",
            "committees": [
                "総務常任委員会 委員長",
                "地域公共交通影響対策特別委員会 委員長",
            ],
        },
        {
            "seat_number": 5,
            "name": "野村 幸宏",
            "furigana": "のむら ゆきひろ",
            "faction": "無会派",
            "committees": ["総務常任委員会 委員"],
        },
        {
            "seat_number": 15,
            "name": "人見 哲哉",
            "furigana": "ひとみ てつや",
            "faction": "日本共産党",
            "committees": ["民生常任委員会 委員", "議会広報編集委員会 委員"],
        },
        {
            "seat_number": 11,
            "name": "藤田 豊",
            "furigana": "ふじた ゆたか",
            "faction": "公明党",
            "committees": ["民生常任委員会 委員", "議会運営委員会 委員"],
        },
        {
            "seat_number": 8,
            "name": "松本 亜美里",
            "furigana": "まつもと あみり",
            "faction": "自由クラブ",
            "committees": ["建設文教常任委員会 委員"],
        },
        {
            "seat_number": 14,
            "name": "山本 博己",
            "furigana": "やまもと ひろみ",
            "faction": "日本共産党",
            "committees": [
                "総務常任委員会 委員",
                "議会運営委員会 委員",
                "地域公共交通影響対策特別委員会 副委員長",
            ],
        },
    ]

    # party フィールドを faction から推定
    # 国政政党はそのまま party に、地域会派は faction のみ
    national_parties = {"日本共産党", "公明党", "自由民主党", "立憲民主党", "日本維新の会", "国民民主党"}
    members = []
    for m in raw:
        faction = m["faction"]
        # 無会派メンバーで元会派が括弧内に書かれている場合の処理
        party = faction if faction in national_parties else ""
        members.append(
            {
                "seat_number": m["seat_number"],
                "name": m["name"],
                "furigana": m["furigana"],
                "party": party,
                "faction": faction,
                "committees": m["committees"],
                "photo_url": "",
            }
        )

    # 議席番号順にソート
    members.sort(key=lambda x: x["seat_number"])
    return members


def main():
    print("北広島市議会 議員名簿を収集中...")
    print("データソース: 議員名簿PDF（令和7年9月4日現在）")
    print(f"  URL: {PDF_URL}")

    members = build_members()
    print(f"  議員数: {len(members)} 名")

    output_path = OUTPUT_DIR / "members.json"
    output_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  保存完了: {output_path}")


if __name__ == "__main__":
    main()
