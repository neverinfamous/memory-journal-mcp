// @ts-nocheck
type AtomTag = 'dot' | 'word' | 'digit' | 'space' | 'alpha' | 'class' | 'group' | { lit: string };

interface GroupFrame {
  entryTags: AtomTag[];
  activeTags: AtomTag[];
  exitTags: AtomTag[];
  hasQuantifier: boolean;
  hasAlternation: boolean;
  hasDot: boolean;
  sawAtomSinceSep: boolean;
  lastAtomTag: AtomTag | null;
}

const SINGLE_SPACE_RE = /^\s$/;

function litMatchesTag(ch: string, tag: AtomTag): boolean {
  const lc = ch.toLowerCase();
  if (tag === 'digit') return ch >= '0' && ch <= '9';
  if (tag === 'alpha') return lc >= 'a' && lc <= 'z';
  if (tag === 'word') return (lc >= 'a' && lc <= 'z') || (ch >= '0' && ch <= '9') || ch === '_';
  if (tag === 'space') return SINGLE_SPACE_RE.test(ch);
  return true;
}

function tagsOverlap(a: AtomTag, b: AtomTag): boolean {
  if (a === 'dot' || b === 'dot' || a === 'class' || b === 'class' || a === 'group' || b === 'group') return true;
  if (typeof a === 'object' && typeof b === 'object') return a.lit.toLowerCase() === b.lit.toLowerCase();
  if (typeof a === 'object') return litMatchesTag(a.lit, b);
  if (typeof b === 'object') return litMatchesTag(b.lit, a);
  if (a === 'word' || b === 'word') return a !== 'space' && b !== 'space';
  return a === b;
}

function mergeUniqueTags(target: AtomTag[], additions: readonly AtomTag[]): void {
  for (const tag of additions) {
    const exists = target.some((t) =>
      typeof t === 'object' && typeof tag === 'object' ? t.lit.toLowerCase() === tag.lit.toLowerCase() : t === tag,
    );
    if (!exists) target.push(tag);
  }
}

const HEX_RE = /^[0-9a-fA-F]+$/;

function parseEscapeAtom(
  pattern: string,
  i: number,
): { ok: boolean; nextIdx: number; zeroWidth?: boolean; tag: AtomTag | null } {
  if (i + 1 >= pattern.length) return { ok: false, nextIdx: i, tag: null };
  const esc = pattern[i + 1] ?? '';
  if ((esc >= '1' && esc <= '9') || esc === 'k' || esc === 'B' || esc === '0' || esc === 'c' || esc === 'p' || esc === 'P') {
    return { ok: false, nextIdx: i, tag: null };
  }
  if (esc === 'b') return { ok: true, nextIdx: i + 2, zeroWidth: true, tag: null };
  if (esc === 'd') return { ok: true, nextIdx: i + 2, tag: 'digit' };
  if (esc === 's') return { ok: true, nextIdx: i + 2, tag: 'space' };
  if (esc === 'w') return { ok: true, nextIdx: i + 2, tag: 'word' };
  if (esc === 'D' || esc === 'W' || esc === 'S') return { ok: true, nextIdx: i + 2, tag: 'dot' };
  if (esc === 'n') return { ok: true, nextIdx: i + 2, tag: { lit: '\n' } };
  if (esc === 'r') return { ok: true, nextIdx: i + 2, tag: { lit: '\r' } };
  if (esc === 't') return { ok: true, nextIdx: i + 2, tag: { lit: '\t' } };
  if (esc === 'v') return { ok: true, nextIdx: i + 2, tag: { lit: '\v' } };
  if (esc === 'f') return { ok: true, nextIdx: i + 2, tag: { lit: '\f' } };
  if (esc === 'x') {
    const hex = pattern.slice(i + 2, i + 4);
    if (hex.length !== 2 || !HEX_RE.test(hex)) return { ok: false, nextIdx: i, tag: null };
    return { ok: true, nextIdx: i + 4, tag: { lit: String.fromCharCode(parseInt(hex, 16)) } };
  }
  if (esc === 'u') {
    if (pattern[i + 2] === '{') return { ok: false, nextIdx: i, tag: null };
    const hex = pattern.slice(i + 2, i + 6);
    if (hex.length !== 4 || !HEX_RE.test(hex)) return { ok: false, nextIdx: i, tag: null };
    return { ok: true, nextIdx: i + 6, tag: { lit: String.fromCharCode(parseInt(hex, 16)) } };
  }
  return { ok: true, nextIdx: i + 2, tag: { lit: esc } };
}

function classifyCharClass(body: string): AtomTag {
  if (body.startsWith('^')) return 'dot';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') {
      const esc = body[i + 1];
      if (esc === 'S' || esc === 'W' || esc === 'D') return 'dot';
      i++;
    }
  }
  if (body === '0-9' || body === '\\d') return 'digit';
  if (body === 'A-Z' || body === 'a-z' || body === 'A-Za-z' || body === 'a-zA-Z') return 'alpha';
  return 'class';
}

function scanCharClass(pattern: string, start: number): { endIdx: number; tag: AtomTag } {
  let i = start + 1;
  if (i < pattern.length && pattern[i] === '^') i++;
  while (i < pattern.length) {
    if (pattern[i] === '\\') { i += 2; continue; }
    if (pattern[i] === ']') return { endIdx: i + 1, tag: classifyCharClass(pattern.slice(start + 1, i)) };
    i++;
  }
  return { endIdx: -1, tag: 'class' };
}

function parseBraceQuantifier(pattern: string, start: number): { endIdx: number; nullable: boolean } | null {
  const closeIdx = pattern.indexOf('}', start + 1);
  if (closeIdx === -1) return null;
  const body = pattern.slice(start + 1, closeIdx);
  const comma = body.indexOf(',');
  const minStr = comma === -1 ? body : body.slice(0, comma);
  const maxStr = comma === -1 ? minStr : body.slice(comma + 1);
  if (!/^\d+$/.test(minStr) || (maxStr !== '' && !/^\d+$/.test(maxStr))) return null;
  const minVal = Number(minStr);
  const maxVal = maxStr === '' ? minVal : Number(maxStr);
  if (minVal > 100 || maxVal > 100 || (maxStr !== '' && maxVal < minVal)) return null;
  return { endIdx: closeIdx + 1, nullable: minVal === 0 };
}

const isQuantifierChar = (ch: string): boolean => ch === '*' || ch === '+' || ch === '?' || ch === '{';

function newGroupFrame(inheritedTags: readonly AtomTag[]): GroupFrame {
  return {
    entryTags: [...inheritedTags],
    activeTags: [...inheritedTags],
    exitTags: [],
    hasQuantifier: false,
    hasAlternation: false,
    hasDot: false,
    sawAtomSinceSep: false,
    lastAtomTag: null,
  };
}

function applyQuantifierToken(pattern: string, i: number, top: GroupFrame): number {
  if (top.lastAtomTag === null) return -1;
  top.hasQuantifier = true;
  let nullable = pattern[i] === '*' || pattern[i] === '?';
  let nextIdx = i + 1;
  if (pattern[i] === '{') {
    const brace = parseBraceQuantifier(pattern, i);
    if (!brace) return -1;
    nullable = brace.nullable;
    nextIdx = brace.endIdx;
  }
  if (pattern[nextIdx] === '?') nextIdx++;
  if (isQuantifierChar(pattern[nextIdx] ?? '')) return -1;
  for (const prevTag of top.activeTags) {
    if (tagsOverlap(prevTag, top.lastAtomTag)) return -1;
  }
  if (!nullable) top.activeTags = [top.lastAtomTag];
  else mergeUniqueTags(top.activeTags, [top.lastAtomTag]);
  top.lastAtomTag = null;
  return nextIdx;
}

function closeRegexGroup(stack: GroupFrame[], nextCh: string): boolean {
  if (stack.length <= 1) return false;
  const closed = stack.pop();
  const parent = stack[stack.length - 1];
  if (!closed || !parent || !closed.sawAtomSinceSep) return false;
  if (closed.hasQuantifier) parent.hasQuantifier = true;
  if (closed.hasAlternation) parent.hasAlternation = true;
  if (closed.hasDot) parent.hasDot = true;
  const unsafeGroup = closed.hasQuantifier || closed.hasAlternation || closed.hasDot;
  if (unsafeGroup && isQuantifierChar(nextCh)) return false;

  parent.sawAtomSinceSep = true;
  if (isQuantifierChar(nextCh)) {
    parent.lastAtomTag = 'class';
  } else {
    mergeUniqueTags(closed.exitTags, closed.activeTags);
    parent.activeTags = closed.exitTags;
    parent.lastAtomTag = null;
  }
  return true;
}

/** [INTENT]: Linear O(N) static validator rejecting nested, overlapping, backreferencing, lookaround, or unbounded ReDoS regexes. */
export function isSafeRegexPattern(pattern: string, maxLen = 500): boolean {
  if (!pattern || pattern.length > maxLen) return false;
  const stack: GroupFrame[] = [newGroupFrame([])];
  let totalQuantifiers = 0, totalAlternations = 0, totalWildcards = 0, i = 0;

  while (i < pattern.length) {
    const ch = pattern[i] ?? '';
    const top = stack[stack.length - 1];
    if (!top) return false;
    if (ch === '\\') {
      const esc = parseEscapeAtom(pattern, i);
      if (!esc.ok) return false;
      i = esc.nextIdx;
      if (esc.zeroWidth) { if (isQuantifierChar(pattern[i] ?? '')) return false; continue; }
      if (esc.tag === 'dot') { if (++totalWildcards > 2) return false; top.hasDot = true; }
      top.lastAtomTag = esc.tag; top.sawAtomSinceSep = true;
    } else if (ch === '[') {
      const cls = scanCharClass(pattern, i);
      if (cls.endIdx === -1) return false;
      if (cls.tag === 'dot') { if (++totalWildcards > 2) return false; top.hasDot = true; }
      top.lastAtomTag = cls.tag; top.sawAtomSinceSep = true; i = cls.endIdx;
    } else if (ch === '(') {
      if (pattern[i + 1] === '?') { if (pattern[i + 2] !== ':') return false; i += 3; }
      else { i++; }
      stack.push(newGroupFrame(top.activeTags));
      continue;
    } else if (ch === ')') {
      if (!closeRegexGroup(stack, pattern[i + 1] ?? '')) return false;
      i++;
      continue;
    } else if (ch === '|') {
      if (!top.sawAtomSinceSep || ++totalAlternations > 16) return false;
      mergeUniqueTags(top.exitTags, top.activeTags);
      top.activeTags = [...top.entryTags]; top.hasAlternation = true; top.sawAtomSinceSep = false; top.lastAtomTag = null; i++;
      continue;
    } else if (isQuantifierChar(ch)) {
      if (++totalQuantifiers > 16) return false;
      const nextIdx = applyQuantifierToken(pattern, i, top);
      if (nextIdx === -1) return false;
      i = nextIdx;
      continue;
    } else {
      if (ch === '.') {
        if (++totalWildcards > 2) return false;
        top.hasDot = true; top.lastAtomTag = 'dot'; top.sawAtomSinceSep = true;
      } else if (ch === '^' || ch === '$') {
        i++; if (isQuantifierChar(pattern[i] ?? '')) return false; continue;
      } else {
        top.lastAtomTag = { lit: ch }; top.sawAtomSinceSep = true;
      }
      i++;
    }
    const atom = top.lastAtomTag;
    if (!isQuantifierChar(pattern[i] ?? '') && atom !== null && top.activeTags.length > 0) {
      top.activeTags = top.activeTags.filter((t) => tagsOverlap(t, atom));
    }
  }
  return stack.length === 1;
}

const isAsciiWordCode = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;

const sameWordRange = (lo: number, hi: number): boolean =>
  lo <= hi && ((lo >= 48 && hi <= 57) || (lo >= 65 && hi <= 90) || (lo >= 97 && hi <= 122));

function isPureWordCharClass(body: string): boolean {
  if (!body || body.startsWith('^')) return false;
  let i = 0;
  while (i < body.length) {
    const ch = body[i] ?? '';
    if (ch === '\\') {
      const next = body[i + 1] ?? '';
      if (next !== 'd' && next !== 'w') return false;
      i += 2; continue;
    }
    if (i + 2 < body.length && body[i + 1] === '-') {
      if (!sameWordRange(body.charCodeAt(i), body.charCodeAt(i + 2))) return false;
      i += 3; continue;
    }
    if (!isAsciiWordCode(body.charCodeAt(i))) return false;
    i++;
  }
  return true;
}

function parseLeadingQuantifier(
  pattern: string,
  qIdx: number,
  limitEnd: number,
): { endIdx: number; unbounded: boolean; nullable: boolean } | null {
  if (qIdx >= limitEnd) return null;
  const ch = pattern[qIdx] ?? '';
  let unbounded = ch === '*' || ch === '+';
  let nullable = ch === '*' || ch === '?';
  let endIdx = qIdx + 1;
  if (ch === '{') {
    const brace = parseBraceQuantifier(pattern, qIdx);
    if (!brace || brace.endIdx > limitEnd) return null;
    nullable = brace.nullable;
    unbounded = pattern.slice(qIdx, brace.endIdx).endsWith(',}');
    endIdx = brace.endIdx;
  } else if (!unbounded && !nullable) {
    return null;
  }
  if (endIdx < limitEnd && pattern[endIdx] === '?') endIdx++;
  return { endIdx, unbounded, nullable };
}

function findMatchingGroupEnd(pattern: string, openIdx: number, limitEnd: number): number {
  let depth = 1, inClass = false, i = openIdx + 1;
  while (i < limitEnd && depth > 0) {
    const ch = pattern[i] ?? '';
    if (ch === '\\') { i += 2; continue; }
    if (inClass) { if (ch === ']') inClass = false; i++; continue; }
    if (ch === '[') inClass = true;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    i++;
  }
  return depth === 0 ? i : -1;
}

function splitTopLevelBranches(pattern: string, start: number, end: number): Array<readonly [number, number]> {
  const branches: Array<readonly [number, number]> = [];
  let depth = 0, inClass = false, bStart = start;
  for (let i = start; i < end; i++) {
    const ch = pattern[i] ?? '';
    if (ch === '\\') { i++; continue; }
    if (inClass) { if (ch === ']') inClass = false; continue; }
    if (ch === '[') inClass = true;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === '|' && depth === 0) { branches.push([bStart, i]); bStart = i + 1; }
  }
  branches.push([bStart, end]);
  return branches;
}

interface LeadingInspectResult {
  unsafe: boolean;
  nullable: boolean;
  wordBarrier: boolean;
  anchored: boolean;
  wordOnly: boolean;
}

function inspectLeadingSlice(
  pattern: string,
  start: number,
  end: number,
  atTail: boolean,
  inheritedBarrier = false,
): LeadingInspectResult {
  let nullable = false;
  let allWordBarrier = true;
  let allAnchored = true;
  let allWordOnly = true;
  for (const [bStart, bEnd] of splitTopLevelBranches(pattern, start, end)) {
    const res = inspectLeadingBranch(pattern, bStart, bEnd, atTail, inheritedBarrier);
    if (res.unsafe) return { unsafe: true, nullable: false, wordBarrier: false, anchored: false, wordOnly: false };
    if (res.nullable) nullable = true;
    if (!res.wordBarrier) allWordBarrier = false;
    if (!res.anchored) allAnchored = false;
    if (!res.wordOnly) allWordOnly = false;
  }
  return { unsafe: false, nullable, wordBarrier: allWordBarrier, anchored: allAnchored && !nullable, wordOnly: allWordOnly };
}

function inspectLeadingBranch(
  pattern: string,
  start: number,
  end: number,
  atTail: boolean,
  inheritedBarrier = false,
): LeadingInspectResult {
  let p = start;
  let nullable = true;
  let hasBarrier = inheritedBarrier;
  let wordOnly = true;
  while (p < end) {
    const ch = pattern[p] ?? '';
    if (ch === '^') {
      if (!hasBarrier && nullable) return { unsafe: false, nullable: false, wordBarrier: true, anchored: true, wordOnly: false };
      wordOnly = false; p++; continue;
    }
    if (ch === '$') { wordOnly = false; p++; continue; }
    if (ch === '(') {
      const gEnd = findMatchingGroupEnd(pattern, p, end);
      if (gEnd === -1) return { unsafe: true, nullable: false, wordBarrier: false, anchored: false, wordOnly: false };
      const q = parseLeadingQuantifier(pattern, gEnd, end);
      if (!hasBarrier && q?.unbounded) return { unsafe: true, nullable: false, wordBarrier: false, anchored: false, wordOnly: false };
      const innerStart = pattern.startsWith('(?:', p) ? p + 3 : p + 1;
      const groupEndIdx = q ? q.endIdx : gEnd;
      const inner = inspectLeadingSlice(
        pattern,
        innerStart,
        gEnd - 1,
        atTail && groupEndIdx === end,
        hasBarrier && !q?.unbounded,
      );
      if (inner.unsafe || (q?.unbounded && !inner.wordOnly)) {
        return { unsafe: true, nullable: false, wordBarrier: false, anchored: false, wordOnly: false };
      }
      if (!inner.wordOnly) wordOnly = false;
      if (!q?.nullable && !inner.nullable) {
        if (!hasBarrier && nullable && inner.anchored) return { unsafe: false, nullable: false, wordBarrier: true, anchored: true, wordOnly: false };
        nullable = false;
        if (inner.wordBarrier) hasBarrier = true;
      }
      p = groupEndIdx;
      continue;
    }
    const atom = parseLeadingAtom(pattern, p, end);
    if (atom.zeroWidth) { wordOnly = false; p = atom.nextIdx; continue; }
    if (!atom.wordOnly) wordOnly = false;
    const q = parseLeadingQuantifier(pattern, atom.nextIdx, end);
    if (q?.unbounded && !atom.wordOnly && (!hasBarrier || !atTail || q.endIdx < end)) {
      return { unsafe: true, nullable: false, wordBarrier: false, anchored: false, wordOnly: false };
    }
    if (!q?.nullable) {
      nullable = false;
      if (atom.wordOnly) hasBarrier = true;
    }
    p = q ? q.endIdx : atom.nextIdx;
  }
  return { unsafe: false, nullable, wordBarrier: hasBarrier, anchored: false, wordOnly };
}

function parseLeadingAtom(pattern: string, i: number, end: number): { nextIdx: number; wordOnly: boolean; zeroWidth: boolean } {
  const ch = pattern[i] ?? '';
  if (ch === '\\') {
    const esc = parseEscapeAtom(pattern, i);
    const wordOnly = esc.ok && (esc.tag === 'digit' || esc.tag === 'word' || (esc.tag !== null && typeof esc.tag === 'object' && isAsciiWordCode(esc.tag.lit.charCodeAt(0))));
    return { nextIdx: Math.min(end, esc.nextIdx), wordOnly, zeroWidth: Boolean(esc.zeroWidth) };
  }
  if (ch === '[') {
    const cls = scanCharClass(pattern, i);
    const wordOnly = cls.endIdx !== -1 && isPureWordCharClass(pattern.slice(i + 1, cls.endIdx - 1));
    return { nextIdx: cls.endIdx === -1 ? end : cls.endIdx, wordOnly, zeroWidth: false };
  }
  if (ch === '.') return { nextIdx: i + 1, wordOnly: false, zeroWidth: false };
  return { nextIdx: i + 1, wordOnly: isAsciiWordCode(ch.charCodeAt(0)), zeroWidth: false };
}

/** [INTENT]: Guard custom `--issue-pattern` wrapped inside `(?:^|[^\w])(${pattern})\b` against quadratic leading loops. */
export function isSafeCustomIssuePattern(pattern: string, maxLen = 500): boolean {
  if (!isSafeRegexPattern(pattern, maxLen)) return false;
  return !inspectLeadingSlice(pattern, 0, pattern.length, true).unsafe;
}
