"""
旭川市議会 議員名簿スクレイパー
出力: data/asahikawa/members.json

議席順名簿: https://www.city.asahikawa.hokkaido.jp/council/6100/6120/d077435.html
委員会名簿: https://www.city.asahikawa.hokkaido.jp/council/6100/6120/d066335.html
選挙結果:  https://www.city.asahikawa.hokkaido.jp/kurashi/461/463/4633/d053594.html
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.asahikawa.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/council/6100/6120/d077435.html"
COMMITTEES_URL = f"{BASE_URL}/council/6100/6120/d066335.html"
ELECTION_URL = f"{BASE_URL}/kurashi/461/463/4633/d053594.html"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "asahikawa"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "asahikawa"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def scrape_committees() -> dict[str, list[str]]:
    """委員会名簿から {議員名: [委員会名, ...]} の辞書を返す"""
    print("委員会名簿を収集中...")
    soup = fetch(COMMITTEES_URL)
    if soup is None:
        print("  委員会ページ取得失敗")
        return {}

    member_committees: dict[str, list[str]] = {}

    # h3 タグを委員会セクションの区切りとして使用
    for h3 in soup.find_all("h3"):
        h3_text = h3.get_text(strip=True)
        committee_name = re.sub(r"[（(].*", "", h3_text).strip()
        if "委員会" not in committee_name:
            continue

        # h3 の後の兄弟要素を走査（次のh3またはh2まで）
        for sib in h3.find_next_siblings():
            if sib.name in ("h2", "h3"):
                break
            text = sib.get_text(strip=True)
            if not text:
                continue
            # 役職キーワード（「委員会」の「委員」とは区別する）で分割
            # 「委員長」「副委員長」「委員」（「会」が続かない場合）で分割
            parts = re.split(r"(?:委員長|副委員長|委員(?!会))\s*", text)
            for part in parts:
                part = part.strip().replace("　", " ")
                if not part:
                    continue
                # カンマ・読点区切りで個別名前を取得
                names = re.split(r"[、,，]", part)
                for name in names:
                    name = name.strip()
                    # 名前として有効かチェック（2〜15文字、数字や記号・URLなどを含まない）
                    if (2 <= len(name) <= 15
                            and not re.search(r"[\d０-９\u3000-\u303f：:/]", name)
                            and not re.search(r"(〒|電話|ファクス|メール|受付|お問い|局|課|市|丁目)", name)):
                        member_committees.setdefault(name, [])
                        if committee_name not in member_committees[name]:
                            member_committees[name].append(committee_name)

    print(f"  委員会情報: {len(member_committees)} 名分取得")
    return member_committees


def scrape_votes() -> dict[str, int]:
    """選挙結果ページから {候補者名（スペースなし）: 得票数} の辞書を返す"""
    print("選挙得票数を収集中...")
    soup = fetch(ELECTION_URL)
    if soup is None:
        print("  選挙結果ページ取得失敗")
        return {}

    votes: dict[str, int] = {}

    # テーブル形式（順位 | 候補者氏名 | 得票数 | 当落）
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        header = [td.get_text(strip=True) for td in rows[0].find_all(["td", "th"])]
        if "候補者氏名" not in header and "氏名" not in header:
            continue
        name_idx = next((i for i, h in enumerate(header) if "氏名" in h), None)
        vote_idx = next((i for i, h in enumerate(header) if "得票" in h), None)
        if name_idx is None or vote_idx is None:
            continue
        for row in rows[1:]:
            cells = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
            if len(cells) <= max(name_idx, vote_idx):
                continue
            name = cells[name_idx].replace("　", " ").strip()
            vote_str = re.sub(r"[,，]", "", cells[vote_idx])
            try:
                votes[name] = int(float(vote_str))
            except ValueError:
                pass

    print(f"  得票数情報: {len(votes)} 名分取得")
    return votes


FACTION_TO_PARTY: dict[str, str] = {
    "自民党・市民会議": "自由民主党",
    "公明党": "公明党",
    "日本共産党": "日本共産党",
    "民主・市民連合": "立憲民主党",
    "旭川市民連合": "",
    "無所属": "無所属",
}


def faction_to_party(faction: str) -> str:
    """会派名から政党名を推定する"""
    if faction in FACTION_TO_PARTY:
        return FACTION_TO_PARTY[faction]
    if "自民" in faction:
        return "自由民主党"
    if "公明" in faction:
        return "公明党"
    if "共産" in faction:
        return "日本共産党"
    if "立憲" in faction or "民主" in faction:
        return "立憲民主党"
    return ""


def normalize_name(name: str) -> str:
    """氏名を正規化（全角スペース→半角スペース、余分なスペース除去）"""
    return re.sub(r"\s+", " ", name.replace("　", " ")).strip()


def scrape_members():
    print("旭川市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    # 委員会・得票数データを先取り
    committees_map = scrape_committees()
    votes_map = scrape_votes()

    members = []

    # h2 タグを議員セクションの区切りとして利用
    # パターン: "議席番号1 横山 啓一（よこやま けいいち）"
    h2_tags = soup.find_all("h2")

    for h2 in h2_tags:
        h2_text = h2.get_text(strip=True)
        # 議席番号で始まるセクションだけ対象
        seat_m = re.match(r"議席番号(\d+)\s+(.+)", h2_text)
        if not seat_m:
            continue

        seat_number = int(seat_m.group(2) if seat_m.group(1) == "" else seat_m.group(1))
        name_furigana = seat_m.group(2).strip()

        # "横山 啓一（よこやま けいいち）" を分離
        name_m = re.match(r"(.+?)(?:[（(]([ぁ-んァ-ンー\s　]+)[）)])?$", name_furigana)
        if name_m:
            raw_name = normalize_name(name_m.group(1))
            furigana = normalize_name(name_m.group(2) or "")
        else:
            raw_name = normalize_name(name_furigana)
            furigana = ""

        member = {
            "seat_number": seat_number,
            "name": raw_name,
            "furigana": furigana,
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        }

        # h2 の次の兄弟要素からセクション終端まで走査
        faction = ""
        img_url = ""
        section_texts = []

        # h2 直後の要素を収集（次の h2 まで）
        for sibling in h2.find_next_siblings():
            if sibling.name == "h2":
                break
            # 画像を収集
            if not img_url:
                img_tag = sibling.find("img") if hasattr(sibling, "find") else None
                if img_tag is None and sibling.name == "img":
                    img_tag = sibling
                if img_tag and img_tag.get("src"):
                    src = img_tag["src"]
                    if re.search(r"\.(jpg|jpeg|png|gif|webp)", src, re.I):
                        img_url = src
            # テキストを収集
            section_texts.append(sibling.get_text("\n"))

        full_section = "\n".join(section_texts)

        # 会派等を抽出（ページは "会派等 無所属" のようにスペース区切り）
        faction_m = re.search(r"会派等[\s\u00a0]+([^\n\r]+)", full_section)
        if faction_m:
            faction = faction_m.group(1).strip()
            member["faction"] = faction
            member["party"] = faction_to_party(faction)

        # 写真をダウンロード
        if img_url:
            remote_url = img_url if img_url.startswith("http") else BASE_URL + "/council/6100/6120/" + img_url.lstrip("./")
            ext = remote_url.split(".")[-1].split("?")[0] or "jpg"
            fname = f"seat_{seat_number}.{ext}"
            try:
                img_resp = requests.get(remote_url, headers=HEADERS, timeout=10)
                img_resp.raise_for_status()
                (PHOTO_DIR / fname).write_bytes(img_resp.content)
                member["photo_url"] = f"/members/asahikawa/{fname}"
                print(f"  [{seat_number}] {raw_name} -> 写真保存: {fname}")
            except Exception as e:
                print(f"  [WARN] 写真取得失敗 seat {seat_number}: {e}")

        # 委員会情報を付与（名前マッチング）
        # 名前のスペースなしバージョンでも検索
        name_nospace = raw_name.replace(" ", "")
        for key, cmts in committees_map.items():
            key_nospace = key.replace(" ", "")
            if key_nospace == name_nospace or key == raw_name:
                member["committees"] = cmts
                break

        # 得票数を付与（名前のバリエーションを試みる）
        furigana_nospace = furigana.replace(" ", "")
        furi_parts = furigana.split(" ") if furigana else []
        name_parts = raw_name.split(" ")
        matched_vote = None

        for key, v in votes_map.items():
            key_nospace = key.replace(" ", "")
            key_parts = key.split(" ")

            # 1) 漢字名スペースなし一致
            if key_nospace == name_nospace:
                matched_vote = v
                break
            # 2) ふりがな全体スペースなし一致（選挙ページが全ひらがな名の場合）
            if furigana_nospace and key_nospace == furigana_nospace:
                matched_vote = v
                break
            # 3) 選挙名=「ひらがな苗字 漢字名」→ ふりがな苗字+漢字名で照合
            if (len(key_parts) == 2 and len(name_parts) == 2 and len(furi_parts) == 2
                    and key_parts[0] == furi_parts[0]
                    and key_parts[1] == name_parts[1]):
                matched_vote = v
                break
            # 4) 選挙名=「漢字苗字 ひらがな名」→ 漢字苗字+ふりがな名で照合
            if (len(key_parts) == 2 and len(name_parts) == 2 and len(furi_parts) == 2
                    and key_parts[0] == name_parts[0]
                    and key_parts[1] == furi_parts[1]):
                matched_vote = v
                break
            # 5) 選挙名の苗字先頭1文字+ふりがな名が一致（異体字カバー）
            if (len(key_parts) == 2 and len(name_parts) == 2 and len(furi_parts) == 2
                    and len(key_parts[0]) >= 1 and len(name_parts[0]) >= 1
                    and key_parts[0][0] == name_parts[0][0]
                    and key_parts[1] == furi_parts[1]):
                matched_vote = v
                break

        if matched_vote is not None:
            member["votes"] = matched_vote

        members.append(member)
        time.sleep(0.3)

    if members:
        out_path = OUTPUT_DIR / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n-> 保存: {out_path} ({len(members)}名)")
    else:
        print("  議員データが取得できませんでした。")
        print(f"  対象URL: {MEMBERS_URL}")


if __name__ == "__main__":
    scrape_members()
