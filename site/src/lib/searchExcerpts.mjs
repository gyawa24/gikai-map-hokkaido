const SNIPPET_GRAPHEMES = 190;
const MAPPING_BLOCK_UNITS = 4096;
const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;
const normalize = value => String(value).normalize('NFKC').toLowerCase();

function closestHits(normalized, terms) {
  const active = terms.map(term => ({ term, next: normalized.indexOf(term), latest: -1 })).filter(item => item.next >= 0);
  if (!active.length) return [];
  if (active.length === 1) return [{ start: active[0].next, end: active[0].next + active[0].term.length }];
  let best;
  let bestWidth = Infinity;
  const minimumWidth = Math.max(...active.map(item => item.term.length));
  while (true) {
    let nextItem;
    let right = Infinity;
    for (const item of active) {
      if (item.next >= 0 && item.next + item.term.length < right) {
        nextItem = item;
        right = item.next + item.term.length;
      }
    }
    if (!nextItem) break;
    nextItem.latest = nextItem.next;
    let left = Infinity;
    for (const item of active) left = Math.min(left, item.latest);
    if (left >= 0) {
      const width = right - left;
      if (width < bestWidth) {
        bestWidth = width;
        best = active.map(item => ({ start: item.latest, end: item.latest + item.term.length }));
        if (width === minimumWidth) break;
      }
    }
    nextItem.next = normalized.indexOf(nextItem.term, nextItem.next + 1);
  }
  return best;
}

function* normalizationUnits(block) {
  let pending;
  for (const part of segmenter.segment(block)) {
    const nfkc = part.segment.normalize('NFKC');
    const joined = pending ? pending.nfkc + nfkc : '';
    const composed = joined.normalize('NFC');
    if (pending && joined !== composed) {
      pending.nfkc = composed;
      pending.end = part.index + part.segment.length;
    } else {
      if (pending) yield pending;
      pending = { start: part.index, end: part.index + part.segment.length, nfkc };
    }
  }
  if (pending) yield pending;
}

function sourceHits(text, normalizedHits, boundaries) {
  const requests = normalizedHits.flatMap((hit, index) => [
    { offset: hit.start, index, side: 'start' }, { offset: hit.end, index, side: 'end' },
  ]).sort((a, b) => a.offset - b.offset);
  const mapped = normalizedHits.map(() => ({}));
  let pending = 0;
  let sourceStart = 0;
  let normalizedStart = 0;
  while (sourceStart < text.length && pending < requests.length) {
    const limit = Math.min(text.length, sourceStart + MAPPING_BLOCK_UNITS);
    const blockEnd = limit === text.length ? limit : boundaries.containing(limit).index;
    let sourceEnd = blockEnd > sourceStart ? blockEnd : sourceStart + boundaries.containing(sourceStart).segment.length;
    let nfkc = text.slice(sourceStart, sourceEnd).normalize('NFKC');
    // Compatibility Hangul can compose across original grapheme boundaries (ㄱ + ㅏ → 가).
    while (sourceEnd < text.length) {
      const next = boundaries.containing(sourceEnd);
      const joined = nfkc + next.segment.normalize('NFKC');
      const composed = joined.normalize('NFC');
      if (joined === composed) break;
      nfkc = composed;
      sourceEnd += next.segment.length;
    }
    const block = text.slice(sourceStart, sourceEnd);
    const normalizedEnd = normalizedStart + nfkc.toLowerCase().length;
    if (requests[pending].offset <= normalizedEnd) {
      let offset = normalizedStart;
      for (const part of normalizationUnits(block)) {
        const end = offset + part.nfkc.toLowerCase().length;
        while (pending < requests.length && requests[pending].offset <= end) {
          const request = requests[pending++];
          const startInSource = sourceStart + part.start;
          const endInSource = sourceStart + part.end;
          mapped[request.index][request.side] = request.offset === offset ? startInSource
            : request.offset === end ? endInSource
              : request.side === 'start' ? startInSource : endInSource;
        }
        offset = end;
        if (pending === requests.length) break;
      }
    }
    normalizedStart = normalizedEnd;
    sourceStart = sourceEnd;
  }
  return mapped;
}

function advance(boundaries, start, end, count) {
  let offset = start;
  let used = 0;
  while (offset < end && used < count) {
    offset += boundaries.containing(offset).segment.length;
    used++;
  }
  return { end: offset, count: used };
}

function mergeOverlapping(ranges) {
  const merged = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function boundedRanges(text, hits, boundaries) {
  const anchors = mergeOverlapping(hits);
  let remaining = SNIPPET_GRAPHEMES;
  const ranges = [];
  for (const anchor of anchors) {
    if (!remaining) break;
    const used = advance(boundaries, anchor.start, anchor.end, remaining);
    ranges.push({ start: anchor.start, end: used.end });
    remaining -= used.count;
  }
  const gaps = ranges.slice(1).map((range, index) => {
    const gap = advance(boundaries, ranges[index].end, range.start, remaining + 1);
    return { index, size: gap.end === range.start ? gap.count : Infinity };
  }).sort((a, b) => a.size - b.size || a.index - b.index);
  const joined = new Set();
  for (const gap of gaps) {
    if (gap.size <= remaining) { joined.add(gap.index); remaining -= gap.size; }
  }
  const groups = [];
  for (const [index, range] of ranges.entries()) {
    if (index && joined.has(index - 1)) groups.at(-1).end = range.end;
    else groups.push({ ...range });
  }
  // Share context across separated quotations instead of letting the first one consume the budget.
  while (remaining > 0) {
    let expanded = false;
    for (const [index, group] of groups.entries()) {
      if (remaining && group.start > (groups[index - 1]?.end ?? 0)) {
        group.start = boundaries.containing(group.start - 1).index;
        remaining--;
        expanded = true;
      }
      if (remaining && group.end < (groups[index + 1]?.start ?? text.length)) {
        group.end += boundaries.containing(group.end).segment.length;
        remaining--;
        expanded = true;
      }
    }
    if (!expanded) break;
  }
  return mergeOverlapping(groups);
}

export function buildSearchExcerpts(text, terms = []) {
  const normalized = normalize(text);
  const distinctTerms = [...new Set(terms.map(normalize).filter(Boolean))];
  const normalizedHits = closestHits(normalized, distinctTerms);
  const boundaries = segmenter.segment(text);
  // Matching uses the whole normalized text, including contextual casing (e.g. final Greek sigma).
  // Normalization units below supply lengths only, never an alternative matching string.
  const hits = sourceHits(text, normalizedHits, boundaries);
  const ranges = hits.length ? boundedRanges(text, hits, boundaries)
    : text.length ? [{ start: 0, end: advance(boundaries, 0, text.length, SNIPPET_GRAPHEMES).end }] : [];
  const snippetSegments = ranges.map(({ start, end }) => ({ text: text.slice(start, end), start, end }));
  return {
    snippet: snippetSegments.map(segment => `${segment.start ? '…' : ''}${segment.text}${segment.end < text.length ? '…' : ''}`).join('\n[…別の箇所…]\n'),
    snippetSegments,
    separated: snippetSegments.length > 1,
    snippetCoverageComplete: hits.every(hit => ranges.some(range => range.start <= hit.start && range.end >= hit.end)),
  };
}

export function buildMultiTermSearchExcerpt(text, terms = []) {
  if (!segmenter) return null;
  const distinctTerms = [...new Set(terms.map(normalize).filter(Boolean))];
  if (!text || distinctTerms.length < 2 || distinctTerms.length > 8) return null;
  const normalized = normalize(text);
  const bodyTerms = distinctTerms.filter(term => normalized.includes(term));
  // Production also matches synonyms, kana and character variants. Keep its existing
  // excerpt unless multiple literal query terms can be shown from this body itself.
  if (bodyTerms.length < 2) return null;
  const { snippet, ...excerpt } = buildSearchExcerpts(text, bodyTerms);
  return { context: snippet, ...excerpt, snippetSourceLength: text.length };
}
