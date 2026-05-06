#!/usr/bin/env python3
"""
画像系PDFのOCR下書きを生成する。

公開用 data/{slug}/minutes/ には書き込まず、data/{slug}/ocr_drafts/ に隔離する。
OCR誤認識を含みうるため、ここで生成したJSONは品質評価を通してから公開データへ昇格する。
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; gikai-map-hokkaido/1.0)"}


def require_command(name: str) -> None:
    if not shutil.which(name):
        raise RuntimeError(f"{name} is required")


def download_pdf(url: str) -> bytes:
    r = requests.get(url, headers=HEADERS, timeout=60)
    r.raise_for_status()
    return r.content


def native_text_chars(pdf_bytes: bytes) -> int:
    try:
        import io

        import pdfplumber

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            text = "\n".join((page.extract_text() or "") for page in pdf.pages)
        return len(re.sub(r"\s+", "", text))
    except Exception:
        return 0


def normalize_for_parser(text: str) -> str:
    # OCR由来の発言者見出しだけを既存segments抽出に寄せる。本文語句は補正しない。
    replacements = [
        (r"^[OＯ0]\s*([〇○])", r"\1"),
        (r"^([〇○])?\s*議\s+長", r"\1議長"),
        (r"^([〇○])?\s*副\s+議\s+長", r"\1副議長"),
        (r"^([〇○])?\s*委\s+員\s+長", r"\1委員長"),
        (r"^([〇○])?\s*町\s+長", r"\1町長"),
        (r"^([〇○])?\s*村\s+長", r"\1村長"),
        (r"^([〇○])?\s*副\s+町\s+長", r"\1副町長"),
        (r"^([〇○])?\s*副\s+村\s+長", r"\1副村長"),
        (r"^([〇○])?\s*教\s+育\s+長", r"\1教育長"),
        (r"^([〇○])?\s*課\s+長", r"\1課長"),
    ]
    out = text.replace("\r\n", "\n")
    for pattern, repl in replacements:
        out = re.sub(pattern, repl, out, flags=re.MULTILINE)
    out = re.sub(r"\n{4,}", "\n\n\n", out)
    return out.strip()


def count_speaker_candidates(text: str) -> int:
    patterns = [
        r"^[〇○]?\s*(?:議長|副議長|委員長|町長|村長|副町長|副村長|教育長|[^。\n]{1,20}課長)\b",
        r"^[0-9０-９]+\s*番\s+[^\n]{1,20}(?:君|議員)\b",
    ]
    return sum(
        len(re.findall(pattern, text, flags=re.MULTILINE))
        for pattern in patterns
    )


def suspicious_terms(slug: str, text: str) -> list[str]:
    terms_by_slug = {
        "yubetsu": ["湖別町", "清別町", "江別町", "痛別町", "鴻別町"],
        "shosanbetsu": ["初山別材", "初山別相", "初山別柑"],
    }
    terms = terms_by_slug.get(slug, [])
    return sorted({term for term in terms if term in text})


def run_ocr(pdf_bytes: bytes, *, dpi: int, psm: int, lang: str, max_pages: int | None) -> list[dict]:
    require_command("pdftoppm")
    require_command("tesseract")

    with tempfile.TemporaryDirectory(prefix="gikai-ocr-draft-") as tmp:
        tmp_path = Path(tmp)
        pdf_path = tmp_path / "source.pdf"
        pdf_path.write_bytes(pdf_bytes)

        cmd = ["pdftoppm", "-r", str(dpi), "-png"]
        if max_pages:
            cmd.extend(["-f", "1", "-l", str(max_pages)])
        cmd.extend(["source.pdf", "page"])
        subprocess.run(cmd, cwd=tmp, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        pages = []
        for page_no, image_path in enumerate(sorted(tmp_path.glob("page-*.png")), 1):
            out_base = image_path.with_suffix("")
            subprocess.run(
                ["tesseract", image_path.name, out_base.name, "-l", lang, "--psm", str(psm)],
                cwd=tmp,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            txt_path = out_base.with_suffix(".txt")
            raw_text = txt_path.read_text(encoding="utf-8", errors="ignore").strip()
            normalized_text = normalize_for_parser(raw_text)
            pages.append(
                {
                    "page": page_no,
                    "raw_text": raw_text,
                    "normalized_text": normalized_text,
                    "raw_chars": len(raw_text),
                    "normalized_chars": len(normalized_text),
                    "speaker_candidate_count": count_speaker_candidates(normalized_text),
                }
            )
        return pages


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slug", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--id", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--psm", type=int, default=11)
    parser.add_argument("--lang", default="jpn+eng")
    parser.add_argument("--max-pages", type=int, default=None)
    args = parser.parse_args()

    started = time.time()
    pdf_bytes = download_pdf(args.url)
    native_chars = native_text_chars(pdf_bytes)
    pages = run_ocr(pdf_bytes, dpi=args.dpi, psm=args.psm, lang=args.lang, max_pages=args.max_pages)

    raw_text = "\n\n".join(page["raw_text"] for page in pages if page["raw_text"])
    normalized_text = "\n\n".join(page["normalized_text"] for page in pages if page["normalized_text"])
    draft = {
        "schema": "ocr_draft.v1",
        "status": "draft_not_for_publication",
        "municipality": args.slug,
        "draft_id": args.id,
        "title": args.title,
        "source_url": args.url,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "notice": "OCR由来の下書きです。誤認識を含むため、公開用minutesへ昇格する前に原文PDFとの照合が必要です。",
        "ocr": {
            "engine": "tesseract",
            "dpi": args.dpi,
            "psm": args.psm,
            "lang": args.lang,
            "max_pages": args.max_pages,
            "seconds": round(time.time() - started, 1),
            "pdf_bytes": len(pdf_bytes),
            "native_text_chars": native_chars,
        },
        "metrics": {
            "pages": len(pages),
            "raw_chars": len(raw_text),
            "normalized_chars": len(normalized_text),
            "speaker_candidate_count": count_speaker_candidates(normalized_text),
            "suspicious_terms": suspicious_terms(args.slug, normalized_text),
        },
        "raw_text": raw_text,
        "normalized_text": normalized_text,
        "pages": pages,
    }

    out_dir = DATA_DIR / args.slug / "ocr_drafts"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.id}.json"
    out_path.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out_path.relative_to(ROOT)}")
    print(json.dumps(draft["metrics"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
