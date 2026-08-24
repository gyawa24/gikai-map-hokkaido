import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import scraper.lib.dnp_minutes as dnp_minutes
import scraper.scrape_minutes as standalone_minutes
from scraper.lib.dnp_minutes import (
    fetch_councils,
    resolve_council_year,
    sync_existing_council_year,
)


class DnpCouncilYearTest(unittest.TestCase):
    def test_resolves_fullwidth_reiwa_year(self):
        self.assertEqual(
            resolve_council_year("令和 ８年  ３月 定例会議", "2025", "令和7年"),
            ("2026", "令和8年"),
        )

    def test_resolves_reiwa_first_year(self):
        self.assertEqual(
            resolve_council_year("令和元年 第1回定例会", "2018", "平成30年"),
            ("2019", "令和1年"),
        )

    def test_falls_back_when_name_has_no_year(self):
        self.assertEqual(
            resolve_council_year("第1回定例会", "2025", "令和7年"),
            ("2025", "令和7年"),
        )

    @patch("scraper.lib.dnp_minutes.time.sleep", return_value=None)
    @patch("scraper.lib.dnp_minutes.post")
    def test_selects_name_year_even_when_view_year_is_stale(self, post, _sleep):
        post.return_value = {
            "councils": [
                {
                    "view_years": [
                        {
                            "view_year": "2025",
                            "japanese_year": "令和7年",
                            "council_type": [
                                {
                                    "council_type_name1": "定例会",
                                    "councils": [
                                        {
                                            "council_id": 318,
                                            "name": "令和 ８年  ３月 定例会議",
                                        }
                                    ],
                                }
                            ],
                        }
                    ]
                }
            ]
        }

        councils = fetch_councils(1, {"2026"}, ["定例会"], 0)

        self.assertEqual(len(councils), 1)
        self.assertEqual(councils[0]["year"], "2026")
        self.assertEqual(councils[0]["japanese_year"], "令和8年")

    def test_syncs_only_existing_file_year_metadata(self):
        with tempfile.TemporaryDirectory(prefix="dnp-year-test-") as directory:
            target = Path(directory) / "318.json"
            original = {
                "council_id": 318,
                "name": "令和 ８年  ３月 定例会議",
                "year": "2025",
                "japanese_year": "令和7年",
                "schedules": [{"schedule_id": 1, "minutes": [{"text": "原文"}]}],
            }
            target.write_text(json.dumps(original, ensure_ascii=False), encoding="utf-8")

            self.assertTrue(sync_existing_council_year(target, "2026", "令和8年"))
            updated = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(updated["year"], "2026")
            self.assertEqual(updated["japanese_year"], "令和8年")
            self.assertEqual(updated["schedules"], original["schedules"])
            self.assertFalse(sync_existing_council_year(target, "2026", "令和8年"))


class DnpIndexPreservationTest(unittest.TestCase):
    @staticmethod
    def council_info(council_id: int, year: str) -> dict:
        reiwa_year = int(year) - 2018
        return {
            "council_id": council_id,
            "name": f"令和{reiwa_year}年第1回定例会",
            "year": year,
            "japanese_year": f"令和{reiwa_year}年",
            "type_label": "全会議 > 本会議 > 定例会",
        }

    @classmethod
    def council_data(cls, council_id: int, year: str, text: str = "原文") -> dict:
        return {
            **cls.council_info(council_id, year),
            "schedules": [
                {
                    "schedule_id": 1,
                    "name": "第1日",
                    "page_no": 1,
                    "minutes": [{"minute_id": 1, "text": text}],
                }
            ],
        }

    @classmethod
    def index_entry(cls, council_id: int, year: str, **extra) -> dict:
        return {
            **cls.council_info(council_id, year),
            "file": f"{council_id}.json",
            "schedule_count": 1,
            **extra,
        }

    @staticmethod
    def write_json(path: Path, value) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")

    def test_orders_same_year_councils_by_descending_council_id(self):
        entries = [
            self.index_entry(100, "2026"),
            self.index_entry(300, "2026"),
            self.index_entry(200, "2026"),
            self.index_entry(999, "2025"),
        ]
        index_by_id = {str(entry["council_id"]): entry for entry in entries}

        ordered = dnp_minutes.ordered_council_index(index_by_id)

        self.assertEqual(
            [entry["council_id"] for entry in ordered],
            [300, 200, 100, 999],
        )

    def test_atomic_json_write_preserves_destination_on_partial_failure(self):
        with tempfile.TemporaryDirectory(prefix="dnp-atomic-write-") as directory:
            target = Path(directory) / "index.json"
            target.write_text('[{"council_id": 1}]', encoding="utf-8")
            original = target.read_bytes()

            def partial_dump(_data, handle, **_kwargs):
                handle.write("{partial")
                raise OSError("disk full")

            with patch.object(dnp_minutes.json, "dump", side_effect=partial_dump):
                with self.assertRaises(OSError):
                    dnp_minutes.write_json_atomic(target, [{"council_id": 2}])

            self.assertEqual(target.read_bytes(), original)
            self.assertEqual(list(target.parent.glob(".*.tmp")), [])

    def test_malformed_index_fails_closed_before_both_fetch_paths(self):
        invalid_indexes = (
            ("invalid json", b"{not-json"),
            ("non-array", json.dumps({"council_id": 1}).encode()),
            ("missing council_id", json.dumps([{"name": "broken"}]).encode()),
            (
                "duplicate council_id",
                json.dumps([{"council_id": 1}, {"council_id": 1}]).encode(),
            ),
        )

        for route in ("library", "standalone"):
            for case, invalid_index in invalid_indexes:
                with (
                    self.subTest(route=route, case=case),
                    tempfile.TemporaryDirectory(prefix="dnp-invalid-index-") as directory,
                ):
                    root = Path(directory)
                    output_dir = (
                        root / "minutes"
                        if route == "library"
                        else root / "data" / "sample" / "minutes"
                    )
                    output_dir.mkdir(parents=True)
                    index_path = output_dir / "index.json"
                    index_path.write_bytes(invalid_index)
                    original_index = index_path.read_bytes()

                    if route == "library":
                        with (
                            patch.object(dnp_minutes, "fetch_councils") as fetch_councils_mock,
                            redirect_stdout(StringIO()),
                            self.assertRaises(ValueError),
                        ):
                            dnp_minutes.run_scrape(
                                slug="sample",
                                tenant_id=1,
                                output_dir=output_dir,
                                target_keywords=["定例会"],
                                target_years={"2026"},
                                request_interval=0,
                            )
                    else:
                        with (
                            patch.object(standalone_minutes, "ROOT", root),
                            patch.object(standalone_minutes, "fetch_councils") as fetch_councils_mock,
                            redirect_stdout(StringIO()),
                            self.assertRaises(ValueError),
                        ):
                            standalone_minutes.scrape_city("sample", 1, {"2026"})

                    fetch_councils_mock.assert_not_called()
                    self.assertEqual(index_path.read_bytes(), original_index)

    def test_empty_council_list_response_fails_closed_with_or_without_index(self):
        empty_payloads = ({}, [], {"councils": []})

        for route in ("library", "standalone"):
            for payload in empty_payloads:
                for with_index in (False, True):
                    with (
                        self.subTest(route=route, payload=payload, with_index=with_index),
                        tempfile.TemporaryDirectory(prefix="dnp-empty-list-") as directory,
                    ):
                        root = Path(directory)
                        output_dir = (
                            root / "minutes"
                            if route == "library"
                            else root / "data" / "sample" / "minutes"
                        )
                        output_dir.mkdir(parents=True)
                        index_path = output_dir / "index.json"
                        if with_index:
                            self.write_json(index_path, [self.index_entry(101, "2025")])
                            original_index = index_path.read_bytes()

                        if route == "library":
                            with (
                                patch.object(dnp_minutes, "post", return_value=payload),
                                patch.object(dnp_minutes.time, "sleep", return_value=None),
                                redirect_stdout(StringIO()),
                                self.assertRaises(ValueError),
                            ):
                                dnp_minutes.run_scrape(
                                    slug="sample",
                                    tenant_id=1,
                                    output_dir=output_dir,
                                    target_keywords=["定例会"],
                                    target_years={"2026"},
                                    request_interval=0,
                                )
                        else:
                            with (
                                patch.object(standalone_minutes, "ROOT", root),
                                patch.object(standalone_minutes, "post", return_value=payload),
                                patch.object(standalone_minutes.time, "sleep", return_value=None),
                                redirect_stdout(StringIO()),
                                self.assertRaises(ValueError),
                            ):
                                standalone_minutes.scrape_city("sample", 1, {"2026"})

                        if with_index:
                            self.assertEqual(index_path.read_bytes(), original_index)
                        else:
                            self.assertFalse(index_path.exists())

    def test_empty_council_list_requires_explicit_allow_empty(self):
        for route in ("library", "standalone"):
            with self.subTest(route=route):
                module = dnp_minutes if route == "library" else standalone_minutes
                with (
                    patch.object(module, "post", return_value={"councils": []}),
                    patch.object(module.time, "sleep", return_value=None),
                    redirect_stdout(StringIO()),
                ):
                    if route == "library":
                        councils = dnp_minutes.fetch_councils(
                            1,
                            {"2026"},
                            ["定例会"],
                            0,
                            allow_empty=True,
                        )
                    else:
                        councils = standalone_minutes.fetch_councils(
                            1,
                            {"2026"},
                            allow_empty=True,
                        )
                self.assertEqual(councils, [])

    def test_library_single_year_update_preserves_existing_other_year(self):
        old_id = 101
        new_id = 202
        old_entry = self.index_entry(old_id, "2025", marker="keep")
        new_info = self.council_info(new_id, "2026")
        new_data = self.council_data(new_id, "2026", "新規原文")

        with tempfile.TemporaryDirectory(prefix="dnp-lib-index-keep-") as directory:
            output_dir = Path(directory) / "minutes"
            self.write_json(output_dir / "index.json", [old_entry])
            self.write_json(output_dir / f"{old_id}.json", self.council_data(old_id, "2025"))

            with (
                patch.object(dnp_minutes, "fetch_councils", return_value=[new_info]),
                patch.object(dnp_minutes, "scrape_council", return_value=new_data),
                redirect_stdout(StringIO()),
            ):
                dnp_minutes.run_scrape(
                    slug="sample",
                    tenant_id=1,
                    output_dir=output_dir,
                    target_keywords=["定例会"],
                    target_years={"2026"},
                    request_interval=0,
                )

            index = json.loads((output_dir / "index.json").read_text(encoding="utf-8"))
            by_id = {entry["council_id"]: entry for entry in index}
            self.assertEqual(set(by_id), {old_id, new_id})
            self.assertEqual(by_id[old_id]["marker"], "keep")
            self.assertEqual(by_id[new_id]["schedule_count"], 1)
            self.assertTrue((output_dir / f"{new_id}.json").exists())

    def test_library_fetch_failure_preserves_prior_target_index_entry(self):
        old_entry = self.index_entry(101, "2025")
        failed_entry = self.index_entry(202, "2026", marker="stale-but-preserved")
        failed_info = self.council_info(202, "2026")

        with tempfile.TemporaryDirectory(prefix="dnp-lib-index-failure-") as directory:
            output_dir = Path(directory) / "minutes"
            self.write_json(output_dir / "index.json", [failed_entry, old_entry])

            with (
                patch.object(dnp_minutes, "fetch_councils", return_value=[failed_info]),
                patch.object(dnp_minutes, "scrape_council", side_effect=RuntimeError("API failure")),
                redirect_stdout(StringIO()),
                self.assertRaises(RuntimeError),
            ):
                dnp_minutes.run_scrape(
                    slug="sample",
                    tenant_id=1,
                    output_dir=output_dir,
                    target_keywords=["定例会"],
                    target_years={"2026"},
                    request_interval=0,
                )

            index = json.loads((output_dir / "index.json").read_text(encoding="utf-8"))
            self.assertEqual(index, [failed_entry, old_entry])
            self.assertFalse((output_dir / "202.json").exists())

    def test_standalone_single_year_update_preserves_existing_other_year(self):
        old_id = 101
        new_id = 202
        old_entry = self.index_entry(old_id, "2025", marker="keep")
        new_info = self.council_info(new_id, "2026")
        schedule = {"schedule_id": 1, "name": "第1日", "page_no": 1}

        with tempfile.TemporaryDirectory(prefix="dnp-cli-index-keep-") as directory:
            root = Path(directory)
            output_dir = root / "data" / "sample" / "minutes"
            self.write_json(output_dir / "index.json", [old_entry])
            self.write_json(output_dir / f"{old_id}.json", self.council_data(old_id, "2025"))

            with (
                patch.object(standalone_minutes, "ROOT", root),
                patch.object(standalone_minutes, "fetch_councils", return_value=[new_info]),
                patch.object(standalone_minutes, "fetch_schedules", return_value=[schedule]),
                patch.object(
                    standalone_minutes,
                    "fetch_minutes",
                    return_value=[{"minute_id": 1, "text": "新規原文"}],
                ),
                redirect_stdout(StringIO()),
            ):
                standalone_minutes.scrape_city("sample", 1, {"2026"})

            index = json.loads((output_dir / "index.json").read_text(encoding="utf-8"))
            by_id = {entry["council_id"]: entry for entry in index}
            self.assertEqual(set(by_id), {old_id, new_id})
            self.assertEqual(by_id[old_id]["marker"], "keep")
            self.assertEqual(by_id[new_id]["schedule_count"], 1)

    def test_standalone_force_failure_preserves_body_and_full_index(self):
        old_entry = self.index_entry(101, "2025")
        target_entry = self.index_entry(202, "2026", marker="keep-on-failure")
        target_info = self.council_info(202, "2026")

        with tempfile.TemporaryDirectory(prefix="dnp-cli-index-failure-") as directory:
            root = Path(directory)
            output_dir = root / "data" / "sample" / "minutes"
            target_path = output_dir / "202.json"
            self.write_json(output_dir / "index.json", [target_entry, old_entry])
            self.write_json(target_path, self.council_data(202, "2026", "既存原文"))
            original_body = target_path.read_bytes()

            with (
                patch.object(standalone_minutes, "ROOT", root),
                patch.object(standalone_minutes, "fetch_councils", return_value=[target_info]),
                patch.object(
                    standalone_minutes,
                    "fetch_schedules",
                    side_effect=RuntimeError("API failure"),
                ),
                redirect_stdout(StringIO()),
                self.assertRaises(RuntimeError),
            ):
                standalone_minutes.scrape_city("sample", 1, {"2026"}, force=True)

            index = json.loads((output_dir / "index.json").read_text(encoding="utf-8"))
            self.assertEqual(index, [target_entry, old_entry])
            self.assertEqual(target_path.read_bytes(), original_body)

    def test_empty_dnp_responses_fail_closed_before_publication(self):
        info = self.council_info(202, "2026")
        schedule = {"schedule_id": 1, "name": "第1日", "page_no": 1}
        empty_cases = (
            ("no schedules", [], None),
            ("no minutes", [schedule], []),
            ("no text", [schedule], [{"minute_id": 1, "text": "  "}]),
        )

        for route in ("library", "standalone"):
            for case, schedules, minutes in empty_cases:
                with (
                    self.subTest(route=route, case=case),
                    tempfile.TemporaryDirectory(prefix="dnp-empty-response-") as directory,
                ):
                    root = Path(directory)
                    output_dir = (
                        root / "minutes"
                        if route == "library"
                        else root / "data" / "sample" / "minutes"
                    )
                    output_dir.mkdir(parents=True)

                    if route == "library":
                        with (
                            patch.object(dnp_minutes, "fetch_councils", return_value=[info]),
                            patch.object(dnp_minutes, "fetch_schedules", return_value=schedules),
                            patch.object(dnp_minutes, "fetch_minutes", return_value=minutes),
                            redirect_stdout(StringIO()),
                            self.assertRaises(RuntimeError),
                        ):
                            dnp_minutes.run_scrape(
                                slug="sample",
                                tenant_id=1,
                                output_dir=output_dir,
                                target_keywords=["定例会"],
                                target_years={"2026"},
                                request_interval=0,
                            )
                    else:
                        with (
                            patch.object(standalone_minutes, "ROOT", root),
                            patch.object(standalone_minutes, "fetch_councils", return_value=[info]),
                            patch.object(standalone_minutes, "fetch_schedules", return_value=schedules),
                            patch.object(standalone_minutes, "fetch_minutes", return_value=minutes),
                            redirect_stdout(StringIO()),
                            self.assertRaises(RuntimeError),
                        ):
                            standalone_minutes.scrape_city("sample", 1, {"2026"})

                    self.assertFalse((output_dir / "202.json").exists())
                    self.assertFalse((output_dir / "index.json").exists())


if __name__ == "__main__":
    unittest.main()
