"""
函館市議会 議員名簿スクレイパー
出力: data/hakodate/members.json

参照ページ:
  - 議員名簿（50音順）: https://www.city.hakodate.hokkaido.jp/docs/2014022600191/
  - 投開票結果: https://www.city.hakodate.hokkaido.jp/docs/2023053000030/
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.hakodate.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/docs/2014022600191/"
ELECTION_URL = f"{BASE_URL}/docs/2023053000030/"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "hakodate"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "hakodate"
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


def scrape_votes() -> dict[str, int]:
    """投開票結果ページから氏名→得票数のマップを返す"""
    print("  得票数を取得中...")
    soup = fetch(ELECTION_URL)
    if soup is None:
        print("  [WARN] 得票数ページ取得失敗")
        return {}

    votes = {}
    # 候補者データは h4 + p の組み合わせ
    # <h4>届出番号N　氏名（政党）　当/落</h4>
    # <p>得票数　N,NNN票</p>
    for h4 in soup.find_all("h4"):
        h4_text = h4.get_text(strip=True)
        m = re.search(r'届出番号\d+[　\s]+(.+?)（', h4_text)
        if not m:
            continue
        name_raw = m.group(1).strip()
        name_norm = re.sub(r'[　\s]+', '', name_raw)

        # 次のpタグを探して得票数を取得
        next_p = h4.find_next_sibling("p")
        if next_p:
            p_text = next_p.get_text(strip=True)
            vm = re.search(r'([\d,]+(?:\.\d+)?)\s*票', p_text)
            if vm:
                try:
                    v = int(float(vm.group(1).replace(',', '')))
                    votes[name_norm] = v
                except ValueError:
                    pass

    print(f"  -> 得票数 {len(votes)} 件取得")
    return votes


_KANJI_VARIANTS = str.maketrans({
    '髙': '高',  # 髙橋→高橋
    '澤': '沢',  # 金澤→金沢
    '﨑': '崎',  # 川﨑→川崎
    '濵': '浜',
    '濱': '浜',
    '邉': '辺',
    '邊': '辺',
})


def normalize_name(name: str) -> str:
    """氏名の空白・全角スペースを除去し、異字体を正規化する"""
    return re.sub(r'[　\s]+', '', name).translate(_KANJI_VARIANTS)


def match_votes(member_name: str, member_furigana: str, votes_map: dict[str, int]) -> int | None:
    """
    選挙結果の得票数マップからメンバーに対応する得票数を探す。
    選挙登録名は「高橋ちあき」「はまの幸子」など漢字/かなが混在する。
    メンバーの氏名とふりがなを使って照合する。
    """
    # 正規化済み氏名・ふりがな
    name_norm = normalize_name(member_name)
    furi_norm = normalize_name(member_furigana)

    # 1. 完全一致
    if name_norm in votes_map:
        return votes_map[name_norm]

    # 2. ふりがな完全一致
    if furi_norm in votes_map:
        return votes_map[furi_norm]

    # ふりがなを姓・名に分解（空白区切り）
    furi_parts = re.split(r'[　\s]+', member_furigana.strip())
    furi_sei = furi_parts[0] if furi_parts else ''
    furi_mei = furi_parts[1] if len(furi_parts) > 1 else ''

    for k_raw, v in votes_map.items():
        k = normalize_name(k_raw)  # 異字体を正規化
        # 3. 選挙名のかな部分がふりがなに含まれるか確認
        kana_part = re.sub(r'[^\u3040-\u309f]', '', k)   # ひらがな部分のみ
        kanji_part = re.sub(r'[\u3040-\u309f\u30a0-\u30ff]', '', k)  # かな除去＝漢字部分

        # かな部分が姓か名のふりがなと一致
        kana_matches = kana_part and (
            kana_part == furi_sei or
            kana_part == furi_mei or
            kana_part in furi_norm
        )
        # 漢字部分がメンバー氏名に含まれる
        kanji_matches = kanji_part and kanji_part in name_norm

        if kana_matches and kanji_matches:
            return v
        if kana_matches and not kanji_part:
            # かなのみの選挙名：ふりがなが一致
            return v
        if kanji_matches and not kana_part:
            # 漢字のみの選挙名：氏名が完全一致に近い
            if kanji_part == name_norm:
                return v

    return None


def scrape_members():
    print("函館市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    votes_map = scrape_votes()

    members = []
    seat_num = 0

    # 各議員はh3タグで始まる: 荒木　明美（あらき　あけみ）
    h3_tags = soup.find_all("h3")
    print(f"  h3タグ {len(h3_tags)} 件発見")

    for h3 in h3_tags:
        text = h3.get_text(strip=True)
        # 氏名（ふりがな）形式か確認
        m = re.match(r'^(.+?)（(.+?)）\s*$', text)
        if not m:
            # 括弧なしの場合もある
            name_text = text.strip()
            furigana = ""
        else:
            name_text = m.group(1).strip()
            furigana = m.group(2).strip()

        # 議員名として妥当かチェック
        # ふりがながない、またはひらがなを含まない場合はスキップ
        if len(name_text) < 2:
            continue
        if not furigana or not re.search(r'[ぁ-ん]', furigana):
            continue

        seat_num += 1
        print(f"  [{seat_num}] {name_text}（{furigana}）")

        member = {
            "seat_number": seat_num,
            "name": name_text,
            "furigana": furigana,
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        }

        # h3の次の兄弟要素を順に処理
        current = h3.next_sibling
        photo_saved = False
        current_section = None

        while current is not None:
            # 次のh3に達したら終了
            if hasattr(current, 'name') and current.name == 'h3':
                break

            if hasattr(current, 'name') and current.name == 'h4':
                current_section = current.get_text(strip=True)
                current = current.next_sibling
                continue

            if hasattr(current, 'name') and current.name == 'p':
                # pタグ内にimgがある場合（写真）
                img = current.find('img')
                if img and not photo_saved:
                    src = img.get('src', '')
                    if src:
                        img_url = src if src.startswith('http') else BASE_URL + '/docs/2014022600191/' + src
                        ext = img_url.split('.')[-1].split('?')[0] or 'jpg'
                        fname = f"seat_{seat_num}.{ext}"
                        try:
                            img_resp = requests.get(img_url, headers=HEADERS, timeout=10)
                            img_resp.raise_for_status()
                            (PHOTO_DIR / fname).write_bytes(img_resp.content)
                            member["photo_url"] = f"/members/hakodate/{fname}"
                            photo_saved = True
                            print(f"    写真保存: {fname}")
                        except Exception as e:
                            print(f"    [WARN] 写真取得失敗: {e}")
                    current = current.next_sibling
                    continue

                if current_section == '会派':
                    val = current.get_text(strip=True)
                    if val:
                        member["faction"] = val

                elif current_section == '所属委員会等':
                    # brタグで区切られた複数委員会を処理
                    parts = []
                    for child in current.children:
                        if hasattr(child, 'name') and child.name == 'br':
                            continue
                        text = child.get_text(strip=True) if hasattr(child, 'get_text') else str(child).strip()
                        if text:
                            parts.extend([c.strip() for c in re.split(r'[、,]', text) if c.strip()])
                    member["committees"] = parts

                current = current.next_sibling
                continue

            current = current.next_sibling

        # 得票数
        v = match_votes(name_text, furigana, votes_map)
        if v is not None:
            member["votes"] = v

        # 写真URLが取れなかった場合はフィールドを省略
        if not member["photo_url"]:
            del member["photo_url"]

        members.append(member)
        time.sleep(0.3)

    # 会派から政党を推定
    FACTION_TO_PARTY = {
        '新市政クラブ': '無所属系',
        '民主・市民ネット': '立憲民主党',
        '公明党': '公明党',
        '日本共産党': '日本共産党',
        '無所属': '無所属',
    }
    for m in members:
        faction = m.get('faction', '')
        for key, party in FACTION_TO_PARTY.items():
            if key in faction:
                m['party'] = party
                break

    if members:
        out_path = OUTPUT_DIR / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n-> 保存: {out_path} ({len(members)}名)")
    else:
        print("  議員データが取得できませんでした。")


if __name__ == "__main__":
    scrape_members()
