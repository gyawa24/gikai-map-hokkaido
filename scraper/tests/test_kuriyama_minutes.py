import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import scraper.kuriyama.scrape_minutes as kuriyama_scraper
from scraper.kuriyama.scrape_minutes import Meeting, Schedule


class KuriyamaMinutesSafetyTest(unittest.TestCase):
    def test_default_years_include_the_execution_year(self):
        from datetime import date

        self.assertEqual(
            kuriyama_scraper.default_target_years(date(2026, 8, 23)),
            {"2024", "2025", "2026"},
        )

    def meeting(self, *, council_id_date=(2026, 8, 10), texts=("day 1",)):
        year, month, day = council_id_date
        return Meeting(
            label="8月臨時会議",
            source_url="https://example.test/meeting.pdf",
            year=year,
            month=month,
            day=day,
            type_name="臨時会",
            schedules=[
                Schedule(
                    name=f"第{index}日",
                    url=f"https://example.test/day-{index}.pdf",
                    text=text,
                )
                for index, text in enumerate(texts, 1)
            ],
        )

    def run_scrape(self, data_dir, meeting):
        with (
            patch.object(kuriyama_scraper, "DATA_DIR", data_dir),
            patch.object(kuriyama_scraper, "extract_links", return_value=[{
                "label": meeting.label,
                "url": meeting.source_url,
            }]),
            patch.object(kuriyama_scraper, "scrape_pdf_meeting", return_value=meeting),
            patch.object(kuriyama_scraper.time, "sleep", return_value=None),
        ):
            kuriyama_scraper.scrape({meeting.year})

    def test_preserves_existing_years_when_adding_a_new_meeting(self):
        with tempfile.TemporaryDirectory(prefix="kuriyama-minutes-") as directory:
            data_dir = Path(directory)
            existing = [
                {
                    "council_id": 2026200115,
                    "name": "1月臨時会議 (2026-01-15)",
                    "year": "2026",
                    "file": "2026200115.json",
                    "schedule_count": 1,
                },
                {
                    "council_id": 2026100304,
                    "name": "3月定例会議 (2026-03-04)",
                    "year": "2026",
                    "file": "2026100304.json",
                    "schedule_count": 3,
                },
            ]
            (data_dir / "index.json").write_text(json.dumps(existing), encoding="utf-8")

            meeting = self.meeting(texts=("day 1", "day 2"))
            self.run_scrape(data_dir, meeting)

            index = json.loads((data_dir / "index.json").read_text(encoding="utf-8"))
            council = json.loads(
                (data_dir / f"{meeting.council_id}.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                [entry["council_id"] for entry in index],
                [meeting.council_id, 2026100304, 2026200115],
            )
            self.assertEqual(index[0]["schedule_count"], 2)
            self.assertEqual(
                [schedule["minutes"][0]["text"] for schedule in council["schedules"]],
                ["day 1", "day 2"],
            )
            self.assertEqual(list(data_dir.glob(".*.tmp")), [])

    def test_empty_schedule_keeps_new_meeting_unpublished(self):
        with tempfile.TemporaryDirectory(prefix="kuriyama-empty-") as directory:
            data_dir = Path(directory)
            existing = [{"council_id": 2025200115, "year": "2025"}]
            index_path = data_dir / "index.json"
            index_path.write_text(json.dumps(existing), encoding="utf-8")
            original_index = index_path.read_bytes()
            meeting = self.meeting(texts=("day 1", ""))

            with self.assertRaisesRegex(ValueError, "全日程を取得できない"):
                self.run_scrape(data_dir, meeting)

            self.assertEqual(index_path.read_bytes(), original_index)
            self.assertFalse((data_dir / f"{meeting.council_id}.json").exists())
            self.assertEqual(list(data_dir.glob(".*.tmp")), [])

    def test_malformed_existing_index_fails_before_source_fetch(self):
        with tempfile.TemporaryDirectory(prefix="kuriyama-index-") as directory:
            data_dir = Path(directory)
            index_path = data_dir / "index.json"
            index_path.write_text('{"not":"an array"}', encoding="utf-8")
            original_index = index_path.read_bytes()

            with (
                patch.object(kuriyama_scraper, "DATA_DIR", data_dir),
                patch.object(kuriyama_scraper, "extract_links") as extract_links,
                self.assertRaisesRegex(ValueError, "index.json を安全に読めないため更新中止"),
            ):
                kuriyama_scraper.scrape({2026})

            extract_links.assert_not_called()
            self.assertEqual(index_path.read_bytes(), original_index)


if __name__ == "__main__":
    unittest.main()
