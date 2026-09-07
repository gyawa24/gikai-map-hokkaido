import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('gijiroku_capture', ROOT / 'scripts/capture-gijiroku-council-v2.py')
CAPTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CAPTURE)


class Response:
    status_code = 200
    headers = {'Content-Type': 'text/html; charset=Shift_JIS'}

    def __init__(self, text):
        self.content = text.encode('shift_jis')


class CaptureEvidenceTests(unittest.TestCase):
    def setup_repo(self, root):
        def save(relative, data):
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
            return target
        save('data/municipalities.json', [{'slug': 'sample', 'system': 'gijiroku_com'}])
        save('site/data/sample/minutes/index.json', [{'council_id': 5, 'file': '5.json'}])
        original = save('data/sample/minutes/5.json', {'council_id': 5, 'year': '2026', 'schedules': [
            {'schedule_id': 9, 'name': 'contents', 'minutes': [{'minute_id': 1, 'minute_type': '本会議', 'text': 'original'}]}
        ]})
        parser = root / 'scraper/scrape_minutes_gijiroku.py'
        parser.parent.mkdir(parents=True, exist_ok=True)
        parser.write_bytes((ROOT / 'scraper/scrape_minutes_gijiroku.py').read_bytes())
        return original

    def responses(self, body):
        return [Response('<A onClick="winopen(\'voiweb.exe?ACT=200&KGNO=5&FINO=13&UNID=u&TITL_SUBT=meeting\')">contents</A>'),
                Response('<frame src="?HUID=7">'), Response(body)]

    def test_source_mismatch_retains_failed_manifest_and_raw_bytes_without_changing_legacy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = self.setup_repo(root)
            before = original.read_bytes()
            with patch.object(CAPTURE, 'ROOT', root), patch.object(CAPTURE.time, 'sleep'), patch('requests.get', side_effect=self.responses('changed')):
                with self.assertRaisesRegex(ValueError, 'Captured text differs'):
                    CAPTURE.capture_council('sample', 5)
            manifests = list((root / 'reports').rglob('capture-manifest.json'))
            self.assertEqual(len(manifests), 1)
            result = json.loads(manifests[0].read_text())
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(len(result['captures']), 3)
            self.assertIn('parity_failure', result['schedule_sources'][0])
            for capture in result['captures']:
                self.assertEqual(CAPTURE.digest((root / capture['snapshot_path']).read_bytes()), capture['content_sha256'])
            self.assertEqual(original.read_bytes(), before)

    def test_success_preserves_provider_identity_and_does_not_backfill_legacy_source_fino(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = self.setup_repo(root)
            before = original.read_bytes()
            with patch.object(CAPTURE, 'ROOT', root), patch.object(CAPTURE.time, 'sleep'), patch('requests.get', side_effect=self.responses('original')):
                manifest_path = CAPTURE.capture_council('sample', 5)
            result = json.loads(manifest_path.read_text())
            self.assertEqual(result['status'], 'complete')
            self.assertEqual(result['schedule_sources'][0]['fino'], 13)
            self.assertEqual(result['schedule_sources'][0]['legacy_schedule_id'], 9)
            self.assertTrue(all(c['fetched_at'] for c in result['captures']))
            self.assertEqual(original.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
