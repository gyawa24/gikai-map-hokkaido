import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from scraper import scrape_minutes_gijiroku as scraper


def meeting(fino=10, name="03月01日-01号", council_id=100):
    return {"kgno": council_id, "fino": fino, "unid": "x", "council_title": "令和8年第1回定例会", "schedule_name": name}


def council():
    return {
        "council_id": 100, "name": "令和8年第1回定例会", "year": "2026",
        "japanese_year": "令和8年", "type_label": "全会議 > 本会議 > 定例会",
        "schedules": [{"schedule_id": 7, "name": "03月01日-01号", "page_no": 1,
                       "minutes": [{"minute_id": 1, "title": "03月01日-01号", "minute_type": "本会議", "text": "既存の正常な本文"}]}],
    }


class GijirokuMinutesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name)
        self.out = self.data / "sample" / "minutes"
        self.out.mkdir(parents=True)
        for patcher in [patch.object(scraper, "DATA_DIR", self.data), patch.object(scraper.time, "sleep"), patch("sys.stdout", new=io.StringIO())]:
            patcher.start()
            self.addCleanup(patcher.stop)

    def seed(self):
        body = council()
        index = [{**{key: body[key] for key in ("council_id", "name", "year", "japanese_year", "type_label")}, "file": "100.json", "schedule_count": 1, "checked": True}]
        self.write("100.json", body)
        self.write("index.json", index)
        return self.snapshot()

    def write(self, name, value):
        (self.out / name).write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")

    def snapshot(self):
        return {file.name: file.read_bytes() for file in self.out.iterdir()}

    def run_scrape(self, meetings, body=None, error=None, force=False):
        with patch.object(scraper, "list_meetings_for_year", return_value=meetings), patch.object(scraper, "fetch_body_text", return_value=body, side_effect=error) as fetch:
            result = scraper.scrape_one("sample", [2026], force)
            return result, fetch

    def test_force_failure_preserves_existing_body_and_index(self):
        before = self.seed()
        with self.assertRaisesRegex(RuntimeError, "failed"):
            self.run_scrape([meeting()], error=RuntimeError("timeout"), force=True)
        self.assertEqual(before, self.snapshot())

    def test_empty_new_body_never_enters_publication_index(self):
        with self.assertRaisesRegex(RuntimeError, "failed"):
            self.run_scrape([meeting()], body="  ")
        self.assertEqual({}, self.snapshot())

    def test_added_schedule_preserves_existing_text_and_id(self):
        self.seed()
        result, fetch = self.run_scrape([meeting(), meeting(5, "02月28日-01号")], body="追加日程の本文")
        self.assertEqual(1, result)
        fetch.assert_called_once()
        saved = json.loads((self.out / "100.json").read_text())
        by_name = {s["name"]: s for s in saved["schedules"]}
        self.assertEqual(council()["schedules"][0], by_name["03月01日-01号"])
        self.assertEqual(8, by_name["02月28日-01号"]["schedule_id"])
        index = json.loads((self.out / "index.json").read_text())
        self.assertEqual(2, index[0]["schedule_count"])
        self.assertTrue(index[0]["checked"])

    def test_added_schedule_failure_preserves_whole_existing_council(self):
        before = self.seed()
        with self.assertRaisesRegex(RuntimeError, "failed"):
            self.run_scrape([meeting(), meeting(20, "03月02日-02号")], error=RuntimeError("timeout"))
        self.assertEqual(before, self.snapshot())

    def test_partial_new_council_is_not_saved(self):
        with self.assertRaisesRegex(RuntimeError, "failed"):
            self.run_scrape([meeting(), meeting(20, "03月02日-02号")], error=["正常な本文", RuntimeError("timeout")])
        self.assertEqual({}, self.snapshot())

    def test_missing_existing_schedule_does_not_delete_it(self):
        before = self.seed()
        with self.assertRaisesRegex(RuntimeError, "failed"):
            self.run_scrape([meeting(20, "03月02日-02号")], body="新しい本文")
        self.assertEqual(before, self.snapshot())

    def test_force_keeps_untargeted_years(self):
        self.seed()
        old = {**json.loads((self.out / "index.json").read_text())[0], "council_id": 90, "year": "2025", "file": "90.json"}
        self.write("index.json", [old, json.loads((self.out / "index.json").read_text())[0]])
        self.run_scrape([meeting()], body="公式の更新本文", force=True)
        entries = json.loads((self.out / "index.json").read_text())
        self.assertIn(old, entries)
        self.assertEqual(7, json.loads((self.out / "100.json").read_text())["schedules"][0]["schedule_id"])

    def test_malformed_existing_index_is_not_replaced_even_with_force(self):
        self.seed()
        (self.out / "index.json").write_text("{broken")
        before = self.snapshot()
        with self.assertRaises(ValueError):
            self.run_scrape([meeting()], body="新本文", force=True)
        self.assertEqual(before, self.snapshot())

    def test_main_reports_failed_slug_with_nonzero_exit(self):
        with patch("sys.argv", ["scrape", "--slug", "sample"]), patch.object(scraper, "load_municipalities", return_value={}), patch.object(scraper, "scrape_one", side_effect=RuntimeError("failed")), patch("sys.stderr", new=io.StringIO()):
            self.assertEqual(1, scraper.main())

    def test_missing_body_frame_is_an_error(self):
        with patch.object(scraper, "get_shiftjis", return_value="<html></html>"):
            with self.assertRaisesRegex(ValueError, "HUID"):
                scraper.fetch_body_text("sample", meeting(), 2026)


if __name__ == "__main__":
    unittest.main()
