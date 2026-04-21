"""
残り136自治体の議事録URLをさらに深く探す。

やること:
  1. no_root(28件): URLパターンを広範囲に試行
     - www.{kind}.{slug}.{tld}
     - 独自ドメイン候補（{slug}-town.jp, {slug}.jp）
  2. no_signature(105件) + pdf_hosted(3件): 既知の議会ページを起点に
     - 議事録ハブページへのリンクを辿る（会議録/議事録テキスト・URL含む）
     - 年度サブディレクトリ（R7, R6, r07, r06, 2024年度 等）を探す
     - PDFの有無・ファイル名サンプルを記録
  3. 既存の戦略（filename_pattern / multi_index_html / linktext_pattern / pdf_header）と
     マッチする可能性を自動判定

出力: data/_discovery/minutes_pages_v2.json
  各slugについて:
    - status: (newly_classifiable | needs_manual | no_minutes_public)
    - found_root_url, found_minutes_url, year_subdirs
    - pdf_samples: [{filename, year_hint, in_url_pattern}]
    - strategy_candidate: (html_sections | filename_pattern | pdf_header | multi_index_html | linktext_pattern | none)
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
DISCOVERY_FILE = ROOT / "data" / "_discovery" / "council_systems.json"
OUT_FILE = ROOT / "data" / "_discovery" / "minutes_pages_v2.json"

UA = "Mozilla/5.0 (compatible; gikai-map-hokkaido/deep-discovery)"
TIMEOUT = 10
REQUEST_INTERVAL = 0.5

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA})

HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)
A_TAG_RE = re.compile(
    r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>([\s\S]{1,300}?)</a>', re.I
)
YEAR_HINT = re.compile(r"(令和|平成|reiwa|heisei|r0?[0-9]|h[23][0-9]|20[12][0-9])", re.I)
MINUTES_LINK_RE = re.compile(r"(会議録|議事録|kaigiroku|gijiroku|会議記録)", re.I)


def fetch(url: str) -> tuple[int, str] | None:
    try:
        r = SESSION.get(url, timeout=TIMEOUT, allow_redirects=True)
        enc = r.apparent_encoding or "utf-8"
        r.encoding = enc
        return r.status_code, r.text
    except Exception:
        return None


def type_from_name(name: str) -> str:
    last = name[-1]
    return {"市": "city", "町": "town", "村": "vill"}.get(last, "")


def extended_root_candidates(slug: str, kind: str) -> list[str]:
    """初回の discovery で外れた slug 向けに、より多様なドメインパターンを試す。"""
    out = []
    if kind:
        for prefix in [f"www.{kind}.", f"{kind}.", ""]:
            for tld in ["hokkaido.jp", "lg.jp", "jp"]:
                out.append(f"https://{prefix}{slug}.{tld}/")
    # 独自ドメイン推定
    for dom in [f"{slug}.jp", f"{slug}-town.jp", f"{slug}town.jp", f"www.{slug}.jp"]:
        out.append(f"https://{dom}/")
        out.append(f"http://{dom}/")
    # 重複除去
    seen = set()
    deduped = []
    for u in out:
        if u not in seen:
            seen.add(u)
            deduped.append(u)
    return deduped


def find_live_root(slug: str, kind: str) -> str | None:
    for u in extended_root_candidates(slug, kind):
        res = fetch(u)
        if res and res[0] == 200:
            return u
        time.sleep(0.1)
    return None


def follow_minutes_links(base_url: str, max_depth: int = 2) -> list[tuple[str, str]]:
    """議会・会議録関連のリンクを深さ max_depth まで辿る。

    Returns: [(url, fetched_html), ...]
    """
    visited = {base_url}
    queue = [(base_url, 0)]
    collected: list[tuple[str, str]] = []

    while queue:
        url, depth = queue.pop(0)
        res = fetch(url)
        time.sleep(0.2)
        if not res or res[0] != 200:
            continue
        html = res[1]
        collected.append((url, html))
        if depth >= max_depth:
            continue
        # 議事録っぽいリンクを抽出
        for m in A_TAG_RE.finditer(html):
            href = m.group(1)
            text_raw = re.sub(r"<[^>]+>", "", m.group(2)).strip()
            if not href or href.startswith("#") or href.startswith("javascript:"):
                continue
            # minutes or gikai hint in text or URL
            looks_like = (
                MINUTES_LINK_RE.search(text_raw)
                or MINUTES_LINK_RE.search(href)
                or YEAR_HINT.search(text_raw)
            )
            if not looks_like:
                continue
            full = urljoin(url, href)
            # 同一ドメイン内のみ
            if urlparse(full).netloc != urlparse(base_url).netloc:
                continue
            if full in visited:
                continue
            visited.add(full)
            queue.append((full, depth + 1))
            if len(visited) > 40:  # 無限ループ防止
                break
    return collected


def classify_page(url: str, html: str) -> dict:
    """ページ内容から戦略候補を判定する。"""
    pdfs = []
    for m in re.finditer(
        r'<a[^>]+href=["\']([^"\']+\.pdf[^"\']*)["\'][^>]*>([\s\S]{0,200}?)</a>',
        html,
        re.I,
    ):
        href = m.group(1)
        fn = href.rsplit("/", 1)[-1]
        text = re.sub(r"<[^>]+>", "", m.group(2)).strip()[:60]
        pdfs.append({"filename": fn, "url": urljoin(url, href), "link_text": text})

    # 見出し（h2/h3/h4）の年度 / 種別を抽出
    headers = []
    for m in re.finditer(r"<(h[1-6])[^>]*>([^<]{1,80})</\1>", html, re.I):
        t = m.group(2).strip()
        if t and (
            any(k in t for k in ["令和", "平成", "定例", "臨時"])
            or re.search(r"R[67]|r0?[67]", t)
        ):
            headers.append({"tag": m.group(1).lower(), "text": t[:60]})

    # 年度サブリンク
    year_links = []
    for m in A_TAG_RE.finditer(html):
        href = m.group(1)
        text = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        if YEAR_HINT.search(text) or YEAR_HINT.search(href):
            full = urljoin(url, href)
            if full != url and "." in full and urlparse(full).netloc == urlparse(url).netloc:
                if ".pdf" not in full.lower():
                    year_links.append({"text": text[:40], "url": full[:150]})

    # 戦略推定
    strategy = "unknown"
    reasons = []

    # リンクテキストに令和N年第N回定例会 が入っているか
    linktext_with_full = [
        p for p in pdfs
        if re.search(r"令和\d+年", p["link_text"]) and re.search(r"第\d+回", p["link_text"])
    ]
    if len(linktext_with_full) >= 2:
        strategy = "linktext_pattern"
        reasons.append(f"{len(linktext_with_full)}件のPDFがリンクテキストに令和N年第N回を含む")

    # h3 定例会 / h4 令和N年 の構造
    has_h3_teirei = any("定例会" in h["text"] or "臨時会" in h["text"] for h in headers if h["tag"] == "h3")
    has_h4_reiwa = any(re.search(r"令和\d+年", h["text"]) for h in headers if h["tag"] == "h4")
    if strategy == "unknown" and has_h3_teirei and has_h4_reiwa:
        strategy = "html_sections"
        reasons.append("h3=種別 / h4=年度 の構造あり（naie型）")

    # h2 年度 / h3 種別 / h4 council の 3階層
    has_h2_reiwa = any(re.search(r"令和\d+年", h["text"]) for h in headers if h["tag"] == "h2")
    has_h4_council = any(re.search(r"第\d+回", h["text"]) for h in headers if h["tag"] == "h4")
    if strategy == "unknown" and has_h2_reiwa and has_h4_council:
        strategy = "nested_html_sections"
        reasons.append("h2/h3/h4の3階層（nanporo型）")

    # 年度別サブディレクトリ(/r07/ /r06/ etc) が年度リンクとして検出
    year_subdir_count = sum(1 for y in year_links if re.search(r"/r0?[5-8]/|/R[5-8]/|/H3[01]/|/20(2[4-6])", y["url"]))
    if strategy == "unknown" and year_subdir_count >= 2 and len(pdfs) < 3:
        strategy = "multi_index_html"
        reasons.append(f"{year_subdir_count}個の年度別サブディレクトリリンク")

    # ファイル名に規則ある（R7-3-10-1tei.pdf, R7.4tei1.pdf, 20250310-R07-1teirei.pdf 等）
    if strategy == "unknown" and len(pdfs) >= 3:
        fn_patterns = [
            (r"R\d+-\d+-\d+-\d+(tei|rin)", "makkari型"),
            (r"R\d+\.\d+(tei|rin)\d*", "yoichi型"),
            (r"\d{8}[-_]R\d+[-_]\d+(teirei|rinji)", "mukawa型"),
            (r"(teireikai|rinjikai)R\d+\.\d+", "honbetsu型 (pdf_headerでもOK)"),
        ]
        for pat, name in fn_patterns:
            matches = sum(1 for p in pdfs if re.search(pat, p["filename"], re.I))
            if matches >= 2:
                strategy = "filename_pattern"
                reasons.append(f"{matches}件の PDFファイル名が {name} パターンに一致")
                break

    return {
        "pdfs_count": len(pdfs),
        "pdf_samples": pdfs[:8],
        "headers_sample": headers[:15],
        "year_links_sample": year_links[:10],
        "strategy_candidate": strategy,
        "strategy_reasons": reasons,
    }


def analyze_slug(slug: str, name: str, prev: dict) -> dict:
    kind = type_from_name(name)
    result = {
        "slug": slug,
        "name": name,
        "prev_status": prev.get("status"),
        "prev_root_url": prev.get("root_url"),
        "prev_minutes_url": prev.get("minutes_url"),
        "pages_explored": [],
        "best_candidate": None,
    }

    # Step1: ルートURL確定
    root_url = prev.get("root_url")
    if not root_url:
        root_url = find_live_root(slug, kind)
        result["found_root_url"] = root_url

    if not root_url:
        result["final_status"] = "no_root_still"
        return result

    # Step2: 議事録関連ページを深さ2で辿る
    start = prev.get("minutes_url") or prev.get("gikai_url") or root_url
    pages = follow_minutes_links(start, max_depth=2)
    for url, html in pages:
        cls = classify_page(url, html)
        if cls["pdfs_count"] > 0 or cls["strategy_candidate"] != "unknown":
            result["pages_explored"].append({"url": url, **cls})

    # ベスト候補（最も strategy_candidate が決まっている + PDF数が多い）
    scored = [
        p for p in result["pages_explored"]
        if p["strategy_candidate"] != "unknown"
    ]
    if scored:
        scored.sort(key=lambda p: (p["strategy_candidate"] != "unknown", p["pdfs_count"]), reverse=True)
        result["best_candidate"] = scored[0]
        result["final_status"] = "newly_classifiable"
    elif any(p["pdfs_count"] >= 3 for p in result["pages_explored"]):
        result["final_status"] = "has_pdfs_unclassified"
    elif not result["pages_explored"]:
        result["final_status"] = "no_minutes_page"
    else:
        result["final_status"] = "needs_manual_review"

    return result


def main():
    with open(MUNICIPALITIES_FILE, encoding="utf-8") as f:
        munis = json.load(f)
    with open(DISCOVERY_FILE, encoding="utf-8") as f:
        discovery = json.load(f)

    done = {m["slug"] for m in munis if "minutes" in (m.get("features") or [])}
    prev_map = {r["slug"]: r for r in discovery["results"]}

    targets = []
    for m in munis:
        if m["slug"] in done:
            continue
        if m["slug"] == "hokkaido":
            continue
        if m.get("level") != "municipality":
            continue
        targets.append(m)

    print(f"対象: {len(targets)} 自治体", flush=True)

    results = []
    for i, m in enumerate(targets, 1):
        slug = m["slug"]
        name = m["name"]
        prev = prev_map.get(slug, {})
        print(f"[{i:3d}/{len(targets)}] {slug:20s} {name:10s} ...", flush=True)
        try:
            r = analyze_slug(slug, name, prev)
        except Exception as e:
            r = {"slug": slug, "name": name, "error": str(e)}
        status = r.get("final_status", "?")
        cand = r.get("best_candidate", {}).get("strategy_candidate", "-") if r.get("best_candidate") else "-"
        print(f"           → {status}, strategy={cand}", flush=True)
        results.append(r)

    # サマリ集計
    by_status = {}
    by_strategy = {}
    for r in results:
        s = r.get("final_status", "error")
        by_status[s] = by_status.get(s, 0) + 1
        if r.get("best_candidate"):
            c = r["best_candidate"]["strategy_candidate"]
            by_strategy[c] = by_strategy.get(c, 0) + 1

    out = {
        "summary": {"total": len(results), "by_status": by_status, "by_strategy": by_strategy},
        "results": results,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print("=" * 60, flush=True)
    print("status:", by_status, flush=True)
    print("strategy:", by_strategy, flush=True)
    print(f"結果: {OUT_FILE.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    sys.exit(main() or 0)
