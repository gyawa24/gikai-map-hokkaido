"""
登別市議会 議員名簿スクレイパー
出力: data/noboribetsu/members.json
"""

import json
import re
import time
import unicodedata
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.noboribetsu-shigikai.org"
MEMBERS_URL = f"{BASE_URL}/%E8%AD%B0%E5%93%A1%E3%81%AE%E7%B4%B9%E4%BB%8B-1/"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "noboribetsu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "noboribetsu"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ja,en-US;q=0.7",
    "Accept-Encoding": "identity",
}

# 政党マッピング（会派名 → 政党名）
PARTY_FROM_FACTION = {
    "公明党":       "公明党",
    "日本共産党":   "日本共産党",
}


# IVS異体字セレクタ (U+E0100–U+E01EF, U+FE00–U+FE0F)
IVS_RE = re.compile("[\U000E0100-\U000E01EF\uFE00-\uFE0F]")


def strip_ivs(s: str) -> str:
    return IVS_RE.sub("", s)


def normalize(s: str) -> str:
    """IVSセレクタ等の異体字セレクタを除去して正規化"""
    s = strip_ivs(s)
    return unicodedata.normalize("NFKC", s).replace("\u3000", "").replace(" ", "").strip()


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = "utf-8"
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def parse_member_page(soup: BeautifulSoup, seat_num: int) -> dict:
    """議員個別ページからデータを抽出"""
    text_lines = [l.strip() for l in soup.get_text().split("\n") if l.strip()]

    name = ""
    furigana = ""
    faction = ""
    committees = []
    photo_url = ""

    # タイトルから名前取得 (例: "足立 知也 - 登別市議会ホームページ")
    title_tag = soup.find("title")
    if title_tag:
        title = strip_ivs(title_tag.get_text())
        m = re.match(r"^(.+?)\s*[-ー]\s*登別市議会", title)
        if m:
            name = m.group(1).strip()

    # 名前＋ふりがなが同一行 (例: "足立　知也あだち　ともや")
    name_norm = normalize(name)
    for line in text_lines:
        clean = strip_ivs(line)
        clean_norm = normalize(clean)
        if name_norm and name_norm in clean_norm and re.search(r"[ぁ-ん]", clean):
            # ふりがな: ひらがな（U+3041-U+309F）とスペースのみ残す（々などCJK記号は除外）
            kana_only = re.sub(r"[^\u3041-\u309F\u3000\x20]", "", clean).strip()
            kana_only = re.sub(r"[\u3000\x20]+", "\u3000", kana_only).strip("\u3000")
            if re.search(r"[ぁ-ん]", kana_only) and len(kana_only) >= 3:
                furigana = kana_only
            break

    # 会派 (例: "会派：市政クラブ" or "会派：市民・前進（会長）")
    for line in text_lines:
        m = re.search(r"会派[：:]\s*(.+)", line)
        if m:
            faction_text = m.group(1).strip()
            # 役職部分を除去
            faction = re.sub(r"（[^）]*）", "", faction_text).strip()
            break

    # 政党
    party = PARTY_FROM_FACTION.get(faction, "")

    # 所属委員会（現在のもののみ）
    in_current = False
    for line in text_lines:
        # 歴史的な経歴エントリはスキップ (H/R + 年 + 月形式)
        if re.match(r"[HhRr]\d+[\.\d]*[～~]", line):
            in_current = False
            continue

        # "所属委員会：..." にマッチ（スペースや先頭の（も許容）
        m = re.search(r"所属委員会\s*[：:]\s*(.*)", line)
        if m:
            in_current = True
            first = re.sub(r"（[^）]*）", "", m.group(1)).strip()
            if first and "委員会" in first:
                committees.append(first)
            continue

        if in_current and "委員会" in line and not re.match(r"[HhRr]\d", line):
            # 役職情報を除去
            clean_line = re.sub(r"（[^）]*）", "", line).strip()
            if clean_line and "委員会" in clean_line:
                committees.append(clean_line)
            elif clean_line:
                # 委員会以外のテキストが来たら終了
                in_current = False

    # 写真: transf/none パターン (実際の議員写真)
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if "jimcdn.com" in src and "transf/none" in src and "captcha" not in src:
            fname = f"seat_{seat_num}.jpg"
            try:
                img_resp = requests.get(src, headers=HEADERS, timeout=10)
                img_resp.raise_for_status()
                if len(img_resp.content) > 10000:  # 10KB以上なら実写真
                    (PHOTO_DIR / fname).write_bytes(img_resp.content)
                    photo_url = f"/members/noboribetsu/{fname}"
                    print(f"    写真保存: {fname} ({len(img_resp.content):,} bytes)")
                    break
            except Exception as e:
                print(f"    写真取得失敗: {e}")

    return {
        "name": name,
        "furigana": furigana,
        "faction": faction,
        "party": party,
        "committees": committees,
        "photo_url": photo_url,
    }


def scrape_members():
    print("登別市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    # 議員リンクを収集（/議員の紹介-1/歴代議長-副議長/NAME/ パターン）
    # ただし "歴代議長-副議長/" で終わるもの（一覧ページへのリンク）を除外
    member_links = []
    seen_hrefs = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        name_text = a.get_text(strip=True)
        # 個人ページ判定: "歴代議長-副議長/" の後にさらにパスセグメントがある
        if ("議員の紹介" in href or "%E8%AD%B0%E5%93%A1%E3%81%AE%E7%B4%B9%E4%BB%8B" in href) and \
                "歴代議長" in href and name_text and href not in seen_hrefs:
            # 歴代議長/副議長ページ自体を除外 (名前が含まれるもの)
            path_end = href.rstrip("/").split("/")[-1]
            if path_end in ("歴代議長-副議長", "%E6%AD%B4%E4%BB%A3%E8%AD%B0%E9%95%B7-%E5%89%AF%E8%AD%B0%E9%95%B7"):
                continue
            url = href if href.startswith("http") else BASE_URL + href
            member_links.append((name_text, url))
            seen_hrefs.add(href)

    print(f"  議員リンク {len(member_links)} 件発見")

    members = []
    for i, (link_name, url) in enumerate(member_links):
        print(f"  [{i+1}] {link_name} -> {url}")
        detail = fetch(url)
        time.sleep(0.5)

        if detail is None:
            members.append({
                "seat_number": i + 1,
                "name": link_name,
                "furigana": "",
                "party": "",
                "faction": "",
                "committees": [],
                "photo_url": "",
            })
            continue

        parsed = parse_member_page(detail, i + 1)
        # 名前はリンクテキスト（全角スペース形式）を正式名称として使用
        parsed["name"] = strip_ivs(link_name)

        member = {
            "seat_number": i + 1,
            **parsed,
        }
        members.append(member)
        print(
            f"    -> {member['name']} / {member['furigana']} / "
            f"{member['faction']} / {member['committees']}"
        )

    # JSON保存
    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(members)}名 -> {output_path}")
    return members


if __name__ == "__main__":
    scrape_members()
