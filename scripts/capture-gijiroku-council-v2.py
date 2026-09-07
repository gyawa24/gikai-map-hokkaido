#!/usr/bin/env python3
"""Capture one published council, or reproduce parsing from saved response bytes."""
import argparse
import base64
import datetime
import hashlib
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlencode
import uuid

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from scraper.scrape_minutes_gijiroku import (  # noqa: E402
    HEADERS, REQUEST_INTERVAL, base_url, clean_body_html, parse_meetings_html,
)


def digest(content):
    return hashlib.sha256(content).hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')


def parse_response(raw, role):
    # requests.Response.text with encoding='shift_jis' uses replacement decoding.
    html = raw.decode('shift_jis', errors='replace')
    if role == 'list':
        return {'text': None, 'meetings': parse_meetings_html(html)}
    if role == 'frameset':
        match = re.search(r'HUID=(\d+)', html)
        if not match:
            raise ValueError('HUID is missing from the captured frameset')
        return {'text': None, 'huid': match.group(1)}
    if role == 'body':
        return {'text': clean_body_html(html)}
    raise ValueError(f'Unsupported capture role: {role}')


def write_immutable(file, content):
    file.parent.mkdir(parents=True, exist_ok=True)
    try:
        with file.open('xb') as handle:
            handle.write(content)
    except FileExistsError:
        if file.read_bytes() != content:
            raise ValueError(f'Immutable file differs: {file}')


def save_json(file, data):
    write_immutable(file, (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))


def capture_council(slug, council_id):
    import requests
    registry = json.loads((ROOT / 'data/municipalities.json').read_text())
    municipality = next((m for m in registry if m['slug'] == slug), None)
    if not municipality or municipality.get('system') != 'gijiroku_com' or municipality.get('minutes_access') == 'restricted':
        raise ValueError('A registered, non-restricted gijiroku.com municipality is required')
    legacy_path = ROOT / 'data' / slug / 'minutes' / f'{council_id}.json'
    legacy_bytes = legacy_path.read_bytes()
    legacy = json.loads(legacy_bytes)
    if legacy.get('council_id') != council_id:
        raise ValueError('Legacy council ID differs')
    index_path = ROOT / 'site/data' / slug / 'minutes/index.json'
    index_bytes = index_path.read_bytes()
    matches = [m for m in json.loads(index_bytes) if m.get('council_id') == council_id]
    if len(matches) != 1 or matches[0].get('file', f'{council_id}.json') != f'{council_id}.json':
        raise ValueError('Council must appear exactly once in the public index')
    year = int(legacy['year'])
    if not legacy.get('schedules'):
        raise ValueError('Legacy schedules are empty')
    for schedule in legacy['schedules']:
        if len(schedule.get('minutes', [])) != 1 or schedule['minutes'][0].get('minute_type') != '本会議':
            raise ValueError('This capture supports exactly one whole-document minute per legacy schedule')
    output = ROOT / 'reports/council-record-v2' / slug / str(council_id)
    run_dir = output / 'runs' / f"{now().replace(':', '-')}-{uuid.uuid4()}"
    manifest = {'format': 'gijiroku-capture-manifest/1', 'municipality_id': slug, 'council_id': council_id,
                'legacy_input': {'path': str(legacy_path.relative_to(ROOT)), 'sha256': digest(legacy_bytes)},
                'publication_index': {'path': str(index_path.relative_to(ROOT)), 'sha256': digest(index_bytes)},
                'parser': {'name': 'gijiroku-legacy-html', 'version': '1.0.0',
                           'source_path': 'scraper/scrape_minutes_gijiroku.py',
                           'source_sha256': digest((ROOT / 'scraper/scrape_minutes_gijiroku.py').read_bytes())},
                'captures': [], 'schedule_sources': [], 'status': 'capturing'}
    base = base_url(slug, {slug: municipality}) + 'cgi/voiweb.exe?'
    last_response = None

    def fetch_response(url, role, external_ids):
        nonlocal last_response
        if last_response is not None:
            time.sleep(max(0, REQUEST_INTERVAL - (time.monotonic() - last_response)))
        observed = now()
        response = requests.get(url, headers=HEADERS, timeout=30, allow_redirects=False)
        raw = response.content
        fetched = now()
        last_response = time.monotonic()
        sha = digest(raw)
        snapshot = output / 'snapshots' / f'{sha}.html'
        write_immutable(snapshot, raw)
        capture = {'role': role, 'request': {'method': 'GET', 'url': url}, 'external_ids': external_ids,
                   'observed_at': observed, 'fetched_at': fetched, 'http_status': response.status_code,
                   'content_sha256': sha, 'byte_size': len(raw), 'encoding': 'shift_jis',
                   'mime_type': response.headers.get('Content-Type', 'text/html'),
                   'etag': response.headers.get('ETag'), 'last_modified': response.headers.get('Last-Modified'),
                   'snapshot_path': str(snapshot.relative_to(ROOT))}
        manifest['captures'].append(capture)
        if response.status_code < 200 or response.status_code >= 300:
            raise ValueError(f'HTTP {response.status_code}: {role}')
        parsed = parse_response(raw, role)
        print(f"Captured {role}: {sha}", flush=True)
        return capture, parsed

    try:
        query = urlencode({'ACT': '100', 'KTYP': '0,1,2,3', 'SORT': '0', 'FYY': str(year), 'FMM': '',
                           'FDD': '', 'TYY': str(year), 'TMM': '', 'TDD': '', 'KGTP': '1'})
        listing, parsed = fetch_response(base + query, 'list', {'kgno': council_id, 'year': year})
        meetings = [m for m in parsed['meetings'] if m['kgno'] == council_id]
        if len(meetings) != len(legacy['schedules']):
            raise ValueError('Discovered FINO count differs from legacy document count')
        seen = set()
        for schedule in legacy['schedules']:
            candidates = [m for m in meetings if (m['fino'] == schedule['source_fino'] if 'source_fino' in schedule
                                                 else m['schedule_name'] == schedule['name'])]
            if len(candidates) != 1 or candidates[0]['fino'] in seen:
                raise ValueError(f"Cannot uniquely match legacy schedule {schedule['schedule_id']}")
            meeting = candidates[0]
            seen.add(meeting['fino'])
            if meeting['schedule_name'] != schedule['name']:
                raise ValueError('Provider document label differs from legacy label')
            external = {'kgno': council_id, 'fino': meeting['fino'], 'unid': meeting['unid']}
            url = (f"{base}ACT=200&KTYP=0,1,2,3&KGTP=1&FYY={year}&TYY={year}"
                   f"&KGNO={council_id}&FINO={meeting['fino']}&UNID={meeting['unid']}")
            frame, frame_data = fetch_response(url, 'frameset', external)
            huid = frame_data['huid']
            url = (f"{base}ACT=203&KTYP=0,1,2,3&KGTP=1&FYY={year}&TYY={year}"
                   f"&FINO={meeting['fino']}&HATSUGENMODE=1&HYOUJIMODE=0&HUID={huid}&STYLE=0")
            body, body_data = fetch_response(url, 'body', {**external, 'huid': huid})
            mapping = {'legacy_schedule_id': schedule['schedule_id'], **external, 'huid': huid,
                       'list_sha256': listing['content_sha256'], 'frameset_sha256': frame['content_sha256'],
                       'body_sha256': body['content_sha256']}
            manifest['schedule_sources'].append(mapping)
            expected = schedule['minutes'][0]['text']
            if body_data['text'] != expected:
                mapping['parity_failure'] = {'legacy_text_sha256': digest(expected.encode('utf-8')),
                                             'captured_text_sha256': digest(body_data['text'].encode('utf-8'))}
                raise ValueError(f"Captured text differs at legacy schedule {schedule['schedule_id']}; no text was changed")
        manifest['status'] = 'complete'
    except Exception as error:
        manifest['status'] = 'failed'
        manifest['failure'] = {'message': str(error), 'failed_at': now()}
        raise
    finally:
        save_json(run_dir / 'capture-manifest.json', manifest)
        print(f"Manifest: {run_dir / 'capture-manifest.json'}", flush=True)
    return run_dir / 'capture-manifest.json'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--parse-stdin', action='store_true')
    parser.add_argument('--slug')
    parser.add_argument('--council', type=int)
    args = parser.parse_args()
    if args.parse_stdin:
        data = json.load(sys.stdin)
        results = [parse_response(base64.b64decode(item['bytes_base64'], validate=True), item['role']) for item in data['captures']]
        print(json.dumps({'results': results}, ensure_ascii=False))
    else:
        if not args.slug or args.council is None:
            parser.error('--slug and --council are required')
        capture_council(args.slug, args.council)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
