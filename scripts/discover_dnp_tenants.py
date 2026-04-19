"""
議事録未収録の自治体について、DNP Discuss (ssp.kaigiroku.net) に
テナントが存在するかを判定する。

使い方:
  python scripts/discover_dnp_tenants.py

出力:
  data/_discovery/dnp_candidates.json
"""

import json
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
MUNICIPALITIES_FILE = ROOT / "data" / "municipalities.json"
OUT_DIR = ROOT / "data" / "_discovery"
OUT_FILE = OUT_DIR / "dnp_candidates.json"

REQUEST_INTERVAL = 1.5
UA = "Mozilla/5.0 (compatible; gikai-map-hokkaido/discovery)"


def fetch_tenant_id(slug: str) -> tuple[int | None, str]:
    url = f"https://ssp.kaigiroku.net/tenant/{slug}/js/tenant.js"
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=10)
        if r.status_code == 404:
            return None, "404"
        r.raise_for_status()
        m = re.search(r"tenant_id\s*=\s*(\d+)", r.text)
        if m:
            return int(m.group(1)), "ok"
        return None, "no_tenant_id_in_js"
    except requests.HTTPError as e:
        return None, f"http_{e.response.status_code}"
    except Exception as e:
        return None, f"err:{type(e).__name__}"


def main() -> int:
    with open(MUNICIPALITIES_FILE, encoding="utf-8") as f:
        municipalities = json.load(f)

    targets = [
        m for m in municipalities
        if not (m.get("features") and "minutes" in m["features"])
    ]

    print(f"対象: {len(targets)} 市町村", flush=True)
    print(f"所要時間目安: 約 {len(targets) * REQUEST_INTERVAL / 60:.1f} 分", flush=True)
    print("-" * 60, flush=True)

    results = []
    dnp_count = 0
    for i, m in enumerate(targets, 1):
        slug = m["slug"]
        name = m["name"]
        tenant_id, status = fetch_tenant_id(slug)
        hit = tenant_id is not None
        if hit:
            dnp_count += 1
        mark = "✓" if hit else "·"
        print(
            f"[{i:3d}/{len(targets)}] {mark} {slug:20s} {name:10s} "
            f"tenant_id={tenant_id} ({status})",
            flush=True,
        )
        results.append({
            "slug": slug,
            "name": name,
            "region": m.get("region"),
            "tenant_id": tenant_id,
            "status": status,
            "is_dnp": hit,
        })
        if i < len(targets):
            time.sleep(REQUEST_INTERVAL)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "total": len(targets),
            "dnp_candidates": dnp_count,
            "results": results,
        }, f, ensure_ascii=False, indent=2)

    print("-" * 60, flush=True)
    print(f"DNP候補: {dnp_count} / {len(targets)}", flush=True)
    print(f"結果: {OUT_FILE.relative_to(ROOT)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
