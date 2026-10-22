import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildSearchExcerpts, buildMultiTermSearchExcerpt } from '../../site/src/lib/searchExcerpts.mjs';

const normalize = text => text.normalize('NFKC').toLowerCase();
const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

function checkOriginal(text, result) {
  const boundaries = new Set([0, text.length]);
  for (const part of segmenter.segment(text)) boundaries.add(part.index);
  let characters = 0;
  let previousEnd = -1;
  for (const segment of result.snippetSegments) {
    assert.equal(segment.text, text.slice(segment.start, segment.end));
    assert.ok(boundaries.has(segment.start), `start=${segment.start}`);
    assert.ok(boundaries.has(segment.end), `end=${segment.end}`);
    assert.ok(segment.start > previousEnd);
    assert.ok(segment.end > segment.start);
    previousEnd = segment.end;
    for (const ignored of segmenter.segment(segment.text)) { void ignored; characters++; }
  }
  assert.ok(characters <= 190, `graphemes=${characters}`);
  assert.ok(result.snippetSegments.length <= 8);
  assert.equal(result.separated, result.snippetSegments.length > 1);
  assert.equal(typeof result.snippet, 'string');
}

test('a later close pair wins over the first isolated occurrence', () => {
  const text = `学校給食は別の報告です。${'前段の別件。'.repeat(70)}学校給食の無償化について答弁します。${'後続。'.repeat(90)}`;
  const result = buildSearchExcerpts(text, ['学校給食', '無償化']);
  checkOriginal(text, result);
  assert.equal(result.separated, false);
  assert.equal(result.snippetCoverageComplete, true);
  assert.ok(result.snippetSegments[0].text.includes('学校給食の無償化'));
  assert.ok(!result.snippet.includes('学校給食は別の報告'));
});

test('distant terms remain separate quotations in original order and share a total budget', () => {
  const text = `${'序文。'.repeat(60)}学校給食の施設整備。${'別の話題。'.repeat(80)}保育料の無償化。${'末尾。'.repeat(60)}`;
  const result = buildSearchExcerpts(text, ['無償化', '学校給食']);
  checkOriginal(text, result);
  assert.equal(result.separated, true);
  assert.equal(result.snippetCoverageComplete, true);
  assert.equal(result.snippetSegments.length, 2);
  assert.ok(result.snippetSegments[0].text.includes('学校給食'));
  assert.ok(result.snippetSegments[1].text.includes('無償化'));
  assert.ok(result.snippet.includes('別の箇所'));
});

test('eight distant terms each retain their own source location without a hit-array cap', () => {
  const terms = ['除雪', '学校', '給食', '図書館', '公園', '交通', '福祉', '半導体'];
  const text = terms.map(term => `${'あ'.repeat(900)}${term}`).join('') + '末尾。'.repeat(90);
  const result = buildSearchExcerpts(text, terms);
  checkOriginal(text, result);
  assert.equal(result.snippetSegments.length, 8);
  assert.equal(result.snippetCoverageComplete, true);
  for (const term of terms) assert.ok(result.snippetSegments.some(segment => segment.text.includes(term)));
});

test('duplicate and overlapping terms and shared NFKC expansions do not duplicate excerpts', () => {
  for (const [text, terms] of [
    ['学校給食を検討します。', ['学校給食', '給食', '学校給食']],
    ['㍻の会議録です。', ['平', '成']],
    ['ＡＩを活用します。', ['AI', 'ＡＩ', 'ai']],
  ]) {
    const result = buildSearchExcerpts(text, terms);
    checkOriginal(text, result);
    assert.equal(result.snippetSegments.length, 1);
    assert.equal(result.snippetCoverageComplete, true);
    assert.equal(result.snippetSegments[0].text, text);
  }
});

test('title-only terms are not invented in body snippets or counted as uncovered body terms', () => {
  const text = `本文には${'説明。'.repeat(100)}除雪の記録があります。`;
  const result = buildSearchExcerpts(text, ['山田議員', '除雪']);
  checkOriginal(text, result);
  assert.equal(result.snippetCoverageComplete, true);
  assert.ok(result.snippet.includes('除雪'));
  assert.ok(!result.snippet.includes('山田議員'));
  const titleOnly = buildSearchExcerpts(text, ['山田議員']);
  checkOriginal(text, titleOnly);
  assert.equal(titleOnly.snippetSegments[0].start, 0);
  assert.equal(titleOnly.snippetCoverageComplete, true);
});

test('all original Unicode graphemes survive mapping and context boundaries', () => {
  const text = `${'😀e\u0301ｶﾞ👩‍💻'.repeat(530)}ＡＩ ﬁ ㍻ ｶﾞ e\u0301 👩‍💻 😀 ΟΣ${'👨‍👩‍👧‍👦𠀀'.repeat(140)}`;
  const terms = ['ai', 'fi', '平成', 'ガ', 'é', '👩‍💻', '😀', 'ος'];
  const result = buildSearchExcerpts(text, terms);
  checkOriginal(text, result);
  assert.equal(result.snippetCoverageComplete, true);
  for (const literal of ['ＡＩ', 'ﬁ', '㍻', 'ｶﾞ', 'e\u0301', 'ΟΣ']) assert.ok(result.snippet.includes(literal), literal);
});

test('normalization contractions across a 4096-unit mapping block preserve exact later offsets', () => {
  for (const boundary of ['e\u0301', 'ｶﾞ', '👩‍💻', '\u1100\u1161', '\r\n', '㍻']) {
    const text = `${'前'.repeat(4095)}${boundary}${'中'.repeat(4090)}学校給食と無償化${'後'.repeat(300)}`;
    const result = buildSearchExcerpts(text, ['学校給食', '無償化']);
    checkOriginal(text, result);
    assert.equal(result.snippetCoverageComplete, true, boundary);
    assert.ok(result.snippet.includes('学校給食と無償化'), boundary);
  }
});

test('context-sensitive Greek casing uses whole-text matching, not separately lowercased graphemes', () => {
  const text = `${'前文。'.repeat(90)}Ο${'続'.repeat(300)}ΟΣ と給食${'後文。'.repeat(90)}`;
  const result = buildSearchExcerpts(text, ['ος', '給食']);
  checkOriginal(text, result);
  assert.equal(result.snippetCoverageComplete, true);
  assert.ok(result.snippet.includes('ΟΣ と給食'));
  assert.equal(result.separated, false);
});

test('compatibility Hangul composition across separate source graphemes and mapping blocks stays aligned', () => {
  for (const prefix of ['', '前'.repeat(4095), '前'.repeat(8191)]) {
    for (const original of ['ㄱㅏ', 'ㄱㅏᆨ', 'ﾡￂᆨ']) {
      const text = `${prefix}${original}${'中'.repeat(300)}学校給食と無償化。${'後'.repeat(300)}`;
      const result = buildSearchExcerpts(text, [normalize(original), '学校給食', '無償化']);
      checkOriginal(text, result);
      assert.equal(result.snippetCoverageComplete, true);
      assert.ok(result.snippetSegments.some(segment => segment.text.includes(original)));
      assert.ok(result.snippetSegments.some(segment => segment.text.includes('学校給食と無償化')));
    }
  }
});

test('a normalized query that alone exceeds the display budget reports incomplete coverage', () => {
  const text = '前文。平成'.repeat(70) + '平成'.repeat(160) + '末尾。';
  const result = buildSearchExcerpts(text, ['㍻'.repeat(160)]);
  checkOriginal(text, result);
  assert.equal(result.snippetCoverageComplete, false);
  assert.ok(result.snippetSegments.length > 0);
});

test('empty, one-term and no-body-hit inputs stay deterministic', () => {
  assert.deepEqual(buildSearchExcerpts('', ['語']), { snippet: '', snippetSegments: [], separated: false, snippetCoverageComplete: true });
  for (const terms of [[], ['ない語'], ['給食'], ['給食', '給食']]) {
    const text = '給食はここです。'.repeat(70);
    const result = buildSearchExcerpts(text, terms);
    checkOriginal(text, result);
    assert.deepEqual(buildSearchExcerpts(text, terms), result);
  }
});

test('high-frequency matches do not hide a close pair at the very end of a long document', () => {
  const text = `${'雪'.repeat(200000)}除雪と給食。`;
  const result = buildSearchExcerpts(text, ['雪', '給食']);
  assert.equal(result.snippetCoverageComplete, true);
  assert.equal(result.separated, false);
  assert.ok(result.snippetSegments[0].text.includes('除雪と給食。'));
  assert.equal(result.snippetSegments[0].text, text.slice(result.snippetSegments[0].start, result.snippetSegments[0].end));
});

test('deterministic mixed-script documents keep selected body terms and original grapheme boundaries', () => {
  const parts = ['あ', 'e\u0301', 'Ａ', 'ﬁ', '㍻', 'ｶﾞ', '😀', '👩‍💻', '\u1100\u1161', 'Ο', '\r\n'];
  for (let seed = 1; seed <= 8; seed++) {
    let value = seed;
    let text = '';
    for (let index = 0; index < 2500; index++) {
      value = (value * 1664525 + 1013904223) >>> 0;
      text += parts[value % parts.length];
    }
    text += '学校給食と無償化は同じ位置です。';
    const result = buildSearchExcerpts(text, ['学校給食', '無償化', 'ガ', 'fi']);
    checkOriginal(text, result);
    assert.equal(result.snippetCoverageComplete, true);
    for (const term of ['学校給食', '無償化', 'ガ', 'fi']) assert.ok(result.snippetSegments.some(segment => normalize(segment.text).includes(term)));
  }
});

test('production gate preserves single-term, normalized duplicate, synonym and metadata-only fallbacks', () => {
  for (const [text, terms] of [
    ['学校給食の無償化。', ['学校給食']],
    ['ＡＩを活用します。', ['AI', 'ＡＩ', 'ai']],
    ['学校給食の施設。', ['学校給食', '無償化']],
    ['學校でごみ削減。', ['学校', 'ゴミ']],
    ['学校給食の施設。', ['学校給食', '山田議員']],
    ['', ['学校給食', '無償化']],
  ]) assert.equal(buildMultiTermSearchExcerpt(text, terms), null);
});

test('production gate includes only literal body terms, preserving original body and display offsets', () => {
  const text = `${'前文。'.repeat(100)}学校給食と無償化。${'後文。'.repeat(100)}`;
  const result = buildMultiTermSearchExcerpt(text, ['山田議員', '学校給食', '無償化']);
  checkOriginal(text, { ...result, snippet: result.context });
  assert.equal(result.snippetCoverageComplete, true);
  assert.equal(result.snippetSourceLength, text.length);
  assert.ok(!result.context.includes('山田議員'));
  assert.ok(result.context.includes('学校給食と無償化'));
});

test('production literal gate supports NFKC forms without rewriting source text', () => {
  const text = `${'前文。'.repeat(100)}ＡＩ と ｶﾞ${'後文。'.repeat(100)}`;
  const result = buildMultiTermSearchExcerpt(text, ['ai', 'ガ']);
  checkOriginal(text, { ...result, snippet: result.context });
  assert.ok(result.context.includes('ＡＩ と ｶﾞ'));
});

test('without Intl.Segmenter the module still imports and the production gate preserves the legacy fallback', () => {
  const moduleUrl = new URL('../../site/src/lib/searchExcerpts.mjs', import.meta.url);
  const script = `
    import assert from 'node:assert/strict';
    Intl.Segmenter = undefined;
    const { buildMultiTermSearchExcerpt } = await import(${JSON.stringify(moduleUrl.href)});
    assert.equal(buildMultiTermSearchExcerpt('学校給食の無償化。', ['学校給食', '無償化']), null);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
