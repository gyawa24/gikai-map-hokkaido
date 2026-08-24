import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import scraper.scrape_minutes_pdf as pdf_scraper
from scraper.scrape_minutes_pdf import (
    extract_pdf_links_by_category_drilldown,
    extract_pdf_links_by_linktext_drilldown,
    extract_pdf_links_by_multi_index_html,
    extract_pdf_links_by_rikubetsu_header,
)


class FakeResponse:
    def __init__(self, text="", content=b""):
        self.text = text
        self.content = content
        self.apparent_encoding = "utf-8"
        self.encoding = "utf-8"

    def raise_for_status(self):
        return None


class PdfMinutesLinkExtractionTest(unittest.TestCase):
    @patch("scraper.scrape_minutes_pdf.requests.get")
    def test_multi_index_accepts_flat_council_links_when_enabled(self, get):
        get.return_value = FakeResponse(
            '<h1>令和8年臨時会会議録</h1>'
            '<a href="/minutes/first.pdf">第1回臨時会 令和8年1月19日</a>'
            '<a href="/minutes/second.pdf">第2回臨時会 令和8年3月26日</a>'
        )
        cfg = {
            "index_urls": {2026: "https://example.test/r8-extraordinary.html"},
            "council_tag": "h2",
            "flat_council_links": True,
        }

        records = extract_pdf_links_by_multi_index_html(cfg, [2026])

        self.assertEqual([(r["type"], r["seq"]) for r in records], [("臨時会", 1), ("臨時会", 2)])
        self.assertEqual(records[0]["url"], "https://example.test/minutes/first.pdf")

    @patch("scraper.scrape_minutes_pdf.time.sleep", return_value=None)
    @patch("scraper.scrape_minutes_pdf.requests.get")
    def test_linktext_drilldown_combines_direct_and_detail_pdfs(self, get, _sleep):
        index_html = (
            '<a href="/minutes/direct.pdf">第1回臨時会（1月16日）</a>'
            '<a href="/meetings/regular-2.html">第2回定例会（3月）</a>'
        )
        detail_html = (
            '<a href="/minutes/day-1.pdf">3月4日</a>'
            '<a href="/minutes/day-2.pdf">3月6日</a>'
        )

        def response_for(url, **_kwargs):
            return FakeResponse(detail_html if url.endswith("regular-2.html") else index_html)

        get.side_effect = response_for
        cfg = {
            "index_urls": {2026: "https://example.test/2026.html"},
            "year_from_index": True,
            "detail_pdf_filter": [".pdf"],
        }

        records = extract_pdf_links_by_linktext_drilldown(cfg, [2026])

        self.assertEqual(len(records), 3)
        self.assertEqual([(r["type"], r["seq"]) for r in records], [("臨時会", 1), ("定例会", 2), ("定例会", 2)])
        self.assertEqual(
            [r["url"] for r in records[1:]],
            ["https://example.test/minutes/day-1.pdf", "https://example.test/minutes/day-2.pdf"],
        )

    @patch("scraper.scrape_minutes_pdf.time.sleep", return_value=None)
    @patch("scraper.scrape_minutes_pdf.requests.get")
    def test_category_drilldown_prefers_explicit_pdf_meeting_identity(self, get, _sleep):
        index_html = (
            '<a href="/meetings/extra-2.html">令和6年第2回富良野市議会臨時会</a>'
        )
        detail_html = (
            '<a href="/minutes/extra-2.pdf">会議録 第1号</a>'
            '<a href="/minutes/extra-3.pdf">令和6年第3回富良野市議会臨時会 会議録 第1号</a>'
        )

        def response_for(url, **_kwargs):
            return FakeResponse(detail_html if url.endswith("extra-2.html") else index_html)

        get.side_effect = response_for
        records = extract_pdf_links_by_category_drilldown(
            {"index_urls": {2024: "https://example.test/2024.html"}},
            [2024],
        )

        self.assertEqual(
            [(record["year"], record["type"], record["seq"]) for record in records],
            [(2024, "臨時会", 2), (2024, "臨時会", 3)],
        )

    @patch("scraper.scrape_minutes_pdf.time.sleep", return_value=None)
    @patch("scraper.scrape_minutes_pdf.pdfplumber.open")
    @patch("scraper.scrape_minutes_pdf.requests.get")
    def test_rikubetsu_uses_header_meeting_identity_not_filename_issue(
        self,
        get,
        pdf_open,
        _sleep,
    ):
        index_html = (
            '<a href="/minutes/No.4(R06.03.08).pdf">regular</a>'
            '<a href="/minutes/No.1(R06.04.19).pdf">extraordinary</a>'
        )
        get.side_effect = [
            FakeResponse(index_html),
            FakeResponse(content=b"regular"),
            FakeResponse(content=b"extraordinary"),
        ]

        class FakePage:
            def __init__(self, text):
                self.text = text

            def extract_text(self):
                return self.text

        class FakePdf:
            def __init__(self, text):
                self.pages = [FakePage(text)]

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        pdf_open.side_effect = [
            FakePdf("令和６年陸別町議会３月定例会会議録（第４号）"),
            FakePdf("令和６年陸別町議会第２回臨時会会議録（第１号）"),
        ]
        records = extract_pdf_links_by_rikubetsu_header(
            {"index_urls": {2024: "https://example.test/2024/"}},
            [2024],
        )

        self.assertEqual(
            [(record["type"], record["seq"], record["date"]) for record in records],
            [("定例会", 3, "2024-03-08"), ("臨時会", 2, "2024-04-19")],
        )
        self.assertEqual(records[0]["council_name"], "令和6年3月定例会")

    @patch("scraper.scrape_minutes_pdf.pdfplumber.open")
    @patch("scraper.scrape_minutes_pdf.requests.get")
    def test_rikubetsu_unrecognized_header_fails_closed(self, get, pdf_open):
        get.side_effect = [
            FakeResponse('<a href="No.1(R06.03.05).pdf">minutes</a>'),
            FakeResponse(content=b"unknown"),
        ]

        class FakePdf:
            pages = []

            def __enter__(self):
                self.pages = [type("Page", (), {"extract_text": lambda _self: "表紙"})()]
                return self

            def __exit__(self, *_args):
                return False

        pdf_open.return_value = FakePdf()

        with self.assertRaisesRegex(RuntimeError, "会議識別に失敗"):
            extract_pdf_links_by_rikubetsu_header(
                {"index_urls": {2024: "https://example.test/2024/"}},
                [2024],
            )


class PdfMinutesExistingCouncilUpdateTest(unittest.TestCase):
    slug = "sample"
    council_id = 20261001

    def record(self, url, label, day):
        return {
            "type": "定例会",
            "year": 2026,
            "seq": 1,
            "filename": url.rsplit("/", 1)[-1],
            "link_text": label,
            "url": url,
            "sort_key": (day,),
        }

    def council(self, sources):
        return {
            "council_id": self.council_id,
            "name": "令和8年第1回定例会",
            "year": "2026",
            "japanese_year": "令和8年",
            "type_label": "全会議 > 本会議 > 定例会",
            "schedules": [
                {
                    "schedule_id": index,
                    "name": f"第{index}日",
                    "page_no": index,
                    "minutes": [{
                        "minute_id": 1,
                        "title": f"第{index}日",
                        "minute_type": "本会議",
                        "text": f"existing day {index}",
                        "source_url": source,
                    }],
                }
                for index, source in enumerate(sources, 1)
            ],
        }

    def write_existing(self, data_dir, sources, index_schedule_count):
        minutes_dir = data_dir / self.slug / "minutes"
        minutes_dir.mkdir(parents=True)
        council = self.council(sources)
        council_path = minutes_dir / f"{self.council_id}.json"
        council_path.write_text(json.dumps(council, ensure_ascii=False, indent=2), encoding="utf-8")
        index = [{
            "council_id": self.council_id,
            "name": council["name"],
            "year": council["year"],
            "japanese_year": council["japanese_year"],
            "type_label": council["type_label"],
            "file": council_path.name,
            "schedule_count": index_schedule_count,
        }]
        (minutes_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
        return minutes_dir, council_path

    def add_existing_2025_council(self, minutes_dir):
        council_id = 20251001
        council = self.council(["https://example.test/2025-day-1.pdf"])
        council.update({
            "council_id": council_id,
            "name": "令和7年第1回定例会",
            "year": "2025",
            "japanese_year": "令和7年",
        })
        council_path = minutes_dir / f"{council_id}.json"
        council_path.write_text(json.dumps(council, ensure_ascii=False, indent=2), encoding="utf-8")
        index_path = minutes_dir / "index.json"
        index = json.loads(index_path.read_text(encoding="utf-8"))
        index.append({
            "council_id": council_id,
            "name": council["name"],
            "year": council["year"],
            "japanese_year": council["japanese_year"],
            "type_label": council["type_label"],
            "file": council_path.name,
            "schedule_count": 1,
        })
        index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
        return council_id, council_path

    def run_scrape(
        self,
        data_dir,
        records,
        extracted_text="new day body",
        extraction_error=None,
        force=False,
        expect_failure=False,
    ):
        output = io.StringIO()
        with (
            patch.object(pdf_scraper, "DATA_DIR", data_dir),
            patch.dict(pdf_scraper.PDF_CONFIGS, {self.slug: {"index_url": "https://example.test/index"}}),
            patch.object(pdf_scraper, "extract_pdf_links", return_value=records),
            patch.object(
                pdf_scraper,
                "extract_pdf_text",
                side_effect=extraction_error,
                return_value=extracted_text,
            ) as extract_text,
            patch.object(pdf_scraper.time, "sleep", return_value=None),
            redirect_stdout(output),
        ):
            if expect_failure:
                with self.assertRaises(RuntimeError):
                    pdf_scraper.scrape_one(self.slug, [2026], force)
                saved = None
            else:
                saved = pdf_scraper.scrape_one(self.slug, [2026], force)
        return saved, extract_text, output.getvalue()

    def test_appends_later_discovered_day_without_replacing_existing_text(self):
        day1 = "https://example.test/day-1.pdf"
        day2 = "https://example.test/day-2.pdf"
        records = [self.record(day1, "第1日", 1), self.record(day2, "第2日", 2)]

        with tempfile.TemporaryDirectory(prefix="pdf-council-update-") as directory:
            data_dir = Path(directory)
            minutes_dir, council_path = self.write_existing(data_dir, [day1], 1)

            saved, extract_text, output = self.run_scrape(data_dir, records)

            updated = json.loads(council_path.read_text(encoding="utf-8"))
            index = json.loads((minutes_dir / "index.json").read_text(encoding="utf-8"))
            self.assertEqual(saved, 1)
            self.assertEqual([s["minutes"][0]["source_url"] for s in updated["schedules"]], [day1, day2])
            self.assertEqual(updated["schedules"][0]["minutes"][0]["text"], "existing day 1")
            self.assertEqual(updated["schedules"][1]["minutes"][0]["text"], "new day body")
            self.assertEqual(index[0]["schedule_count"], 2)
            extract_text.assert_called_once()
            self.assertIn(f"変更候補: + {day2}", output)

    def test_keeps_body_count_when_current_page_temporarily_has_fewer_days(self):
        day1 = "https://example.test/day-1.pdf"
        day2 = "https://example.test/day-2.pdf"
        records = [self.record(day1, "第1日", 1)]

        with tempfile.TemporaryDirectory(prefix="pdf-council-keep-") as directory:
            data_dir = Path(directory)
            minutes_dir, council_path = self.write_existing(data_dir, [day1, day2], 1)
            original_body = council_path.read_bytes()

            saved, extract_text, output = self.run_scrape(data_dir, records)

            index = json.loads((minutes_dir / "index.json").read_text(encoding="utf-8"))
            self.assertEqual(saved, 0)
            self.assertEqual(council_path.read_bytes(), original_body)
            self.assertEqual(index[0]["schedule_count"], 2)
            extract_text.assert_not_called()
            self.assertIn(f"保持: 今回の一覧にない既存source_url {day2}", output)

    def test_does_not_merge_when_an_existing_day_disappears_as_a_new_day_appears(self):
        day1 = "https://example.test/day-1.pdf"
        day2 = "https://example.test/day-2.pdf"
        day3 = "https://example.test/day-3.pdf"
        records = [self.record(day1, "第1日", 1), self.record(day3, "第3日", 3)]

        with tempfile.TemporaryDirectory(prefix="pdf-council-ambiguous-order-") as directory:
            data_dir = Path(directory)
            minutes_dir, council_path = self.write_existing(data_dir, [day1, day2], 2)
            original_body = council_path.read_bytes()

            saved, extract_text, output = self.run_scrape(data_dir, records)

            index = json.loads((minutes_dir / "index.json").read_text(encoding="utf-8"))
            self.assertEqual(saved, 0)
            self.assertEqual(council_path.read_bytes(), original_body)
            self.assertEqual(index[0]["schedule_count"], 2)
            extract_text.assert_not_called()
            self.assertIn("順序を安全に確定できないため更新保留", output)
            self.assertIn(f"変更候補: + {day3}", output)
            self.assertIn(f"保持: 今回の一覧にない既存source_url {day2}", output)

    def test_does_not_change_existing_council_when_new_day_extraction_fails(self):
        day1 = "https://example.test/day-1.pdf"
        day2 = "https://example.test/day-2.pdf"
        records = [self.record(day1, "第1日", 1), self.record(day2, "第2日", 2)]

        with tempfile.TemporaryDirectory(prefix="pdf-council-failure-") as directory:
            data_dir = Path(directory)
            minutes_dir, council_path = self.write_existing(data_dir, [day1], 1)
            original_body = council_path.read_bytes()

            saved, extract_text, output = self.run_scrape(
                data_dir,
                records,
                extraction_error=RuntimeError("download failed"),
                expect_failure=True,
            )

            index = json.loads((minutes_dir / "index.json").read_text(encoding="utf-8"))
            self.assertIsNone(saved)
            self.assertEqual(council_path.read_bytes(), original_body)
            self.assertEqual(index[0]["schedule_count"], 1)
            extract_text.assert_called_once()
            self.assertIn("既存会議は変更しません", output)

    def test_new_council_is_not_created_when_any_day_fails_or_is_empty(self):
        day1 = "https://example.test/day-1.pdf"
        day2 = "https://example.test/day-2.pdf"
        records = [self.record(day1, "第1日", 1), self.record(day2, "第2日", 2)]

        for case, extraction_results in (
            ("download failure", ["day 1 body", RuntimeError("download failed")]),
            ("empty body", ["day 1 body", ""]),
        ):
            with self.subTest(case=case), tempfile.TemporaryDirectory(prefix="pdf-new-council-failure-") as directory:
                data_dir = Path(directory)
                output = io.StringIO()
                with (
                    patch.object(pdf_scraper, "DATA_DIR", data_dir),
                    patch.dict(
                        pdf_scraper.PDF_CONFIGS,
                        {self.slug: {"index_url": "https://example.test/index"}},
                    ),
                    patch.object(pdf_scraper, "extract_pdf_links", return_value=records),
                    patch.object(pdf_scraper, "extract_pdf_text", side_effect=extraction_results),
                    patch.object(pdf_scraper.time, "sleep", return_value=None),
                    redirect_stdout(output),
                    self.assertRaises(RuntimeError),
                ):
                    pdf_scraper.scrape_one(self.slug, [2026], False)

                minutes_dir = data_dir / self.slug / "minutes"
                self.assertFalse((minutes_dir / f"{self.council_id}.json").exists())
                self.assertFalse((minutes_dir / "index.json").exists())
                self.assertEqual(list(minutes_dir.glob(".*.tmp")), [])
                self.assertIn("会議を保存しません", output.getvalue())

    def test_new_council_is_saved_only_after_all_days_succeed(self):
        day1 = "https://example.test/day-1.pdf"
        day2 = "https://example.test/day-2.pdf"
        records = [self.record(day1, "第1日", 1), self.record(day2, "第2日", 2)]

        with tempfile.TemporaryDirectory(prefix="pdf-new-council-success-") as directory:
            data_dir = Path(directory)
            output = io.StringIO()
            with (
                patch.object(pdf_scraper, "DATA_DIR", data_dir),
                patch.dict(
                    pdf_scraper.PDF_CONFIGS,
                    {self.slug: {"index_url": "https://example.test/index"}},
                ),
                patch.object(pdf_scraper, "extract_pdf_links", return_value=records),
                patch.object(pdf_scraper, "extract_pdf_text", side_effect=["day 1 body", "day 2 body"]),
                patch.object(pdf_scraper.time, "sleep", return_value=None),
                redirect_stdout(output),
            ):
                saved = pdf_scraper.scrape_one(self.slug, [2026], False)

            minutes_dir = data_dir / self.slug / "minutes"
            council = json.loads((minutes_dir / f"{self.council_id}.json").read_text(encoding="utf-8"))
            index = json.loads((minutes_dir / "index.json").read_text(encoding="utf-8"))
            self.assertEqual(saved, 1)
            self.assertEqual([s["minutes"][0]["text"] for s in council["schedules"]], ["day 1 body", "day 2 body"])
            self.assertEqual(index[0]["schedule_count"], 2)
            self.assertEqual(list(minutes_dir.glob(".*.tmp")), [])

    def test_force_single_year_preserves_other_year_index_entries(self):
        day1 = "https://example.test/day-1.pdf"
        records = [self.record(day1, "第1日", 1)]

        with tempfile.TemporaryDirectory(prefix="pdf-force-single-year-") as directory:
            data_dir = Path(directory)
            minutes_dir, council_path = self.write_existing(data_dir, [day1], 1)
            other_council_id, other_council_path = self.add_existing_2025_council(minutes_dir)
            other_body = other_council_path.read_bytes()

            saved, extract_text, _output = self.run_scrape(
                data_dir,
                records,
                extracted_text="force-refetched body",
                force=True,
            )

            council = json.loads(council_path.read_text(encoding="utf-8"))
            index = json.loads((minutes_dir / "index.json").read_text(encoding="utf-8"))
            self.assertEqual(saved, 1)
            self.assertEqual({entry["council_id"] for entry in index}, {self.council_id, other_council_id})
            self.assertEqual(council["schedules"][0]["minutes"][0]["text"], "force-refetched body")
            self.assertEqual(other_council_path.read_bytes(), other_body)
            extract_text.assert_called_once()

    def test_force_extraction_failure_preserves_existing_body_and_full_index(self):
        day1 = "https://example.test/day-1.pdf"
        records = [self.record(day1, "第1日", 1)]

        with tempfile.TemporaryDirectory(prefix="pdf-force-failure-") as directory:
            data_dir = Path(directory)
            minutes_dir, council_path = self.write_existing(data_dir, [day1], 1)
            other_council_id, other_council_path = self.add_existing_2025_council(minutes_dir)
            original_body = council_path.read_bytes()
            other_body = other_council_path.read_bytes()

            saved, extract_text, output = self.run_scrape(
                data_dir,
                records,
                extraction_error=RuntimeError("download failed"),
                force=True,
                expect_failure=True,
            )

            index = json.loads((minutes_dir / "index.json").read_text(encoding="utf-8"))
            self.assertIsNone(saved)
            self.assertEqual({entry["council_id"] for entry in index}, {self.council_id, other_council_id})
            self.assertEqual(council_path.read_bytes(), original_body)
            self.assertEqual(other_council_path.read_bytes(), other_body)
            extract_text.assert_called_once()
            self.assertIn("会議を保存しません", output)

    def test_malformed_existing_index_fails_closed_without_any_data_write(self):
        invalid_indexes = (
            ("invalid json", b"{not-json"),
            ("non-array", json.dumps({"council_id": self.council_id}).encode()),
            ("missing council_id", json.dumps([{"name": "broken"}]).encode()),
            (
                "duplicate council_id",
                json.dumps([
                    {"council_id": self.council_id},
                    {"council_id": self.council_id},
                ]).encode(),
            ),
        )

        for case, invalid_index in invalid_indexes:
            with self.subTest(case=case), tempfile.TemporaryDirectory(prefix="pdf-invalid-index-") as directory:
                data_dir = Path(directory)
                minutes_dir = data_dir / self.slug / "minutes"
                minutes_dir.mkdir(parents=True)
                index_path = minutes_dir / "index.json"
                council_path = minutes_dir / f"{self.council_id}.json"
                index_path.write_bytes(invalid_index)
                council_path.write_text("existing council sentinel", encoding="utf-8")
                original_index = index_path.read_bytes()
                original_council = council_path.read_bytes()
                output = io.StringIO()

                with (
                    patch.object(pdf_scraper, "DATA_DIR", data_dir),
                    patch.dict(
                        pdf_scraper.PDF_CONFIGS,
                        {self.slug: {"index_url": "https://example.test/index"}},
                    ),
                    patch.object(pdf_scraper, "extract_pdf_links") as extract_links,
                    patch.object(pdf_scraper, "extract_pdf_text") as extract_text,
                    redirect_stdout(output),
                    self.assertRaises(RuntimeError) as raised,
                ):
                    pdf_scraper.scrape_one(self.slug, [2026], False)

                self.assertEqual(index_path.read_bytes(), original_index)
                self.assertEqual(council_path.read_bytes(), original_council)
                extract_links.assert_not_called()
                extract_text.assert_not_called()
                self.assertIn("index.json を安全に読めないため更新中止", str(raised.exception))

    def test_default_years_include_the_execution_year(self):
        from datetime import date

        self.assertEqual(
            pdf_scraper.default_target_years(date(2026, 8, 23)),
            ["2024", "2025", "2026"],
        )


if __name__ == "__main__":
    unittest.main()
