"""
議事録未収録の自治体について、議会サイトURLを推定し、
そのHTMLから議事録システム種別（system）を判別する。

手順:
  1. 市町村ごとに候補URLパターンを生成
     - 市: www.city.{slug}.{tld}  / city.{slug}.{tld}
     - 町: www.town.{slug}.{tld}  / town.{slug}.{tld}
     - 村: www.vill.{slug}.{tld}  / vill.{slug}.{tld}
     tld: hokkaido.jp, lg.jp, jp
  2. HEADリクエストで生きているURLを探す（最初にヒットしたもの採用）
  3. トップページのHTMLを取得 → "議会"へのリンクを探して追跡
  4. 議会ページのHTMLから既知システムの痕跡を抽出
     - dnp系 (ssp.kaigiroku.net)
     - 議事録.com (gijiroku.com / www.kensakusystem.jp)
     - voiscribe
     - discuss2 / 独自システム

出力:
  data/_discovery/council_systems.json
"""

import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

ROOT = Path(__file__).parent.parent
MUNICIPALITIES_FILE = ROOT / "data" / "municipalities.json"
OUT_DIR = ROOT / "data" / "_discovery"
OUT_FILE = OUT_DIR / "council_systems.json"

REQUEST_INTERVAL = 0.6
TIMEOUT = 8
UA = "Mozilla/5.0 (compatible; gikai-map-hokkaido/discovery-v2)"
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA})


SYSTEM_SIGNATURES = [
    ("dnp_kaigiroku", re.compile(r"ssp\.kaigiroku\.net", re.I)),
    ("gijiroku_com", re.compile(r"gijiroku\.com", re.I)),
    ("kensakusystem", re.compile(r"kensakusystem\.jp", re.I)),
    ("discussvision", re.compile(r"discussvision\.net", re.I)),
    ("voiscribe", re.compile(r"voiscribe", re.I)),
    ("dbsr_m_asp", re.compile(r"dbsr_m_asp", re.I)),
    ("hougakunet", re.compile(r"hougakunet|hoogaku\.net", re.I)),
    ("jvoice_com", re.compile(r"jvoice\.com|jvoice-gikai", re.I)),
]

GIKAI_LINK_RE = re.compile(
    r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>[^<]*議会[^<]*</a>',
    re.I,
)
GIKAI_URL_HINT_RE = re.compile(r'(gikai|shigikai|tyogikai|songikai|kaigi|gityou)', re.I)
HREF_RE = re.compile(r'href=["\']([^"\'\s]+)["\']', re.I)


def type_from_name(name: str) -> str:
    last = name[-1]
    return {"市": "city", "町": "town", "村": "vill"}.get(last, "other")


def candidate_urls(slug: str, kind: str) -> list[str]:
    if kind == "other":
        return []
    prefixes = [f"www.{kind}.", f"{kind}."]
    tlds = ["hokkaido.jp", "lg.jp", "jp"]
    schemes = ["https://", "http://"]
    urls = []
    for scheme in schemes:
        for prefix in prefixes:
            for tld in tlds:
                urls.append(f"{scheme}{prefix}{slug}.{tld}/")
    return urls


def find_live_root(slug: str, kind: str) -> tuple[str | None, str]:
    for url in candidate_urls(slug, kind):
        try:
            r = SESSION.get(url, timeout=TIMEOUT, allow_redirects=True)
            if r.status_code == 200 and r.text:
                return r.url, "ok"
        except requests.RequestException:
            continue
        time.sleep(0.1)
    return None, "no_root"


def find_gikai_url(root_url: str, root_html: str, slug: str, kind: str) -> str | None:
    # 1. href URLの中に gikai 等の痕跡
    for m in HREF_RE.finditer(root_html):
        href = m.group(1)
        if href.startswith("#") or href.startswith("mailto:") or href.startswith("javascript:"):
            continue
        if GIKAI_URL_HINT_RE.search(href):
            return urljoin(root_url, href)
    # 2. リンクテキストが「議会」を含む
    for m in GIKAI_LINK_RE.finditer(root_html):
        href = m.group(1)
        if href.startswith("#") or href.startswith("mailto:") or href.startswith("javascript:"):
            continue
        return urljoin(root_url, href)
    # 3. 別サブドメイン候補（千歳のような例: shigikai.city.X.lg.jp）
    parsed = urlparse(root_url)
    host = parsed.netloc
    base = host.replace("www.", "", 1)
    for sub in ["shigikai", "gikai", "tyogikai", "songikai"]:
        for candidate in (f"https://{sub}.{base}/", f"https://www.{sub}.{base}/"):
            try:
                r = SESSION.get(candidate, timeout=TIMEOUT)
                if r.status_code == 200:
                    return r.url
            except requests.RequestException:
                continue
            time.sleep(0.1)
    return None


def follow_minutes_link(gikai_url: str, gikai_html: str) -> str | None:
    minutes_re = re.compile(r'(議事録|会議録|kaigiroku|議事日程)', re.I)
    for m in HREF_RE.finditer(gikai_html):
        href = m.group(1)
        if href.startswith("#") or href.startswith("mailto:") or href.startswith("javascript:"):
            continue
        # href周辺のテキストまたはhref自体に minutes ヒント
        if minutes_re.search(href):
            return urljoin(gikai_url, href)
    # aタグ中のtext
    a_tag_re = re.compile(
        r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>([^<]{0,200})</a>', re.I
    )
    for m in a_tag_re.finditer(gikai_html):
        href, text = m.group(1), m.group(2)
        if minutes_re.search(text):
            if href.startswith("#") or href.startswith("mailto:") or href.startswith("javascript:"):
                continue
            return urljoin(gikai_url, href)
    return None


def detect_system(html: str) -> list[str]:
    hits = []
    for name, pat in SYSTEM_SIGNATURES:
        if pat.search(html):
            hits.append(name)
    return hits


def analyze(slug: str, name: str) -> dict:
    kind = type_from_name(name)
    result = {
        "slug": slug,
        "name": name,
        "kind": kind,
        "root_url": None,
        "gikai_url": None,
        "minutes_url": None,
        "systems": [],
        "status": "unknown",
    }
    root_url, status = find_live_root(slug, kind)
    if not root_url:
        result["status"] = "no_root"
        return result

    result["root_url"] = root_url
    try:
        r = SESSION.get(root_url, timeout=TIMEOUT)
        html = r.text
    except requests.RequestException:
        result["status"] = "root_fetch_err"
        return result

    hits_root = detect_system(html)

    gikai_url = find_gikai_url(root_url, html, slug, kind)
    hits_gikai = []
    hits_minutes = []
    gikai_html = ""
    if gikai_url:
        try:
            r = SESSION.get(gikai_url, timeout=TIMEOUT, allow_redirects=True)
            gikai_html = r.text
            hits_gikai = detect_system(gikai_html)
            result["gikai_url"] = r.url
            gikai_url = r.url
        except requests.RequestException:
            pass

        # さらに 議事録 / 会議録 リンクを追跡
        minutes_url = follow_minutes_link(gikai_url, gikai_html)
        if minutes_url:
            result["minutes_url"] = minutes_url
            try:
                r = SESSION.get(minutes_url, timeout=TIMEOUT, allow_redirects=True)
                hits_minutes = detect_system(r.text)
                result["minutes_url"] = r.url
            except requests.RequestException:
                pass

    all_hits = list(dict.fromkeys(hits_root + hits_gikai + hits_minutes))
    result["systems"] = all_hits

    # PDFホスティング判定（外部システム未使用でも、PDFが多ければ「自前ホスト型」）
    pdf_count = 0
    sample_html = gikai_html
    if result.get("minutes_url") and not sample_html:
        sample_html = ""
    if result.get("minutes_url"):
        try:
            r = SESSION.get(result["minutes_url"], timeout=TIMEOUT)
            pdf_count = len(re.findall(r"\.pdf", r.text, re.I))
        except requests.RequestException:
            pass
    if not pdf_count and sample_html:
        pdf_count = len(re.findall(r"\.pdf", sample_html, re.I))
    result["pdf_links"] = pdf_count

    if all_hits:
        result["status"] = "classified"
    elif pdf_count >= 5:
        result["status"] = "pdf_hosted"
        result["systems"] = ["pdf_inhouse"]
    else:
        result["status"] = "no_signature"
    return result


def main() -> int:
    with open(MUNICIPALITIES_FILE, encoding="utf-8") as f:
        municipalities = json.load(f)

    targets = [
        m for m in municipalities
        if not (m.get("features") and "minutes" in m["features"])
        and m["slug"] != "hokkaido"
    ]

    print(f"対象: {len(targets)} 市町村", flush=True)
    print("-" * 60, flush=True)

    results = []
    for i, m in enumerate(targets, 1):
        slug = m["slug"]
        name = m["name"]
        res = analyze(slug, name)
        res["region"] = m.get("region")
        systems_str = ",".join(res["systems"]) or "-"
        root_short = (res["root_url"] or "").replace("https://", "").replace("http://", "")[:45]
        print(
            f"[{i:3d}/{len(targets)}] {slug:20s} {name:10s} "
            f"{res['status']:14s} systems={systems_str:30s} "
            f"root={root_short}",
            flush=True,
        )
        results.append(res)
        if i < len(targets):
            time.sleep(REQUEST_INTERVAL)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # 集計
    system_counts = {}
    for r in results:
        if not r["systems"]:
            system_counts["none"] = system_counts.get("none", 0) + 1
        for s in r["systems"]:
            system_counts[s] = system_counts.get(s, 0) + 1
    no_root = sum(1 for r in results if r["status"] == "no_root")
    summary = {
        "total": len(targets),
        "no_root": no_root,
        "system_counts": system_counts,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "results": results}, f, ensure_ascii=False, indent=2)

    print("-" * 60, flush=True)
    print("集計:", json.dumps(summary, ensure_ascii=False), flush=True)
    print(f"結果: {OUT_FILE.relative_to(ROOT)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
