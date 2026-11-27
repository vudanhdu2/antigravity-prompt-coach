export interface HighlightSegment {
    text: string;
    match: boolean;
}

interface NormCharMap {
    norm: string;
    starts: number[];
    ends: number[];
}

const COMBINING_RE = /[\u0300-\u036f]/g;
const COMBINING_SINGLE_RE = /^[\u0300-\u036f]+$/;

/**
 * Normalize Vietnamese text for diacritics-insensitive, case-insensitive search.
 * Preserves spaces (collapsed to single ASCII space) and maps đ/Đ -> d.
 */
export function normalizeVnSearch(input: string): string {
    if (!input) return '';
    return String(input)
        .toLowerCase()
        .normalize('NFD')
        .replace(COMBINING_RE, '')
        .replace(/đ/g, 'd')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Split query into unique normalized search tokens (max 8 tokens for fast matching).
 */
export function tokenizeVnSearch(query: string): string[] {
    const norm = normalizeVnSearch(query);
    if (!norm) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of norm.split(' ')) {
        if (!part || seen.has(part)) continue;
        seen.add(part);
        out.push(part);
        if (out.length >= 8) break;
    }
    return out;
}

/**
 * Check whether every query token appears inside the normalized haystack.
 */
export function matchesAllVnTokens(haystack: string, queryOrTokens: string | string[]): boolean {
    const tokens = Array.isArray(queryOrTokens) ? queryOrTokens : tokenizeVnSearch(queryOrTokens);
    if (tokens.length === 0) return true;
    const normHay = normalizeVnSearch(haystack);
    if (!normHay) return false;
    return tokens.every(tok => normHay.includes(tok));
}

/**
 * Compute relevance score for a candidate item (0 = no match).
 */
export function scoreVnSearchFields(
    fields: { title?: string; project?: string; preview?: string; body?: string },
    queryOrTokens: string | string[]
): number {
    const tokens = Array.isArray(queryOrTokens) ? queryOrTokens : tokenizeVnSearch(queryOrTokens);
    if (tokens.length === 0) return 1;

    const nTitle = normalizeVnSearch(fields.title || '');
    const nProject = normalizeVnSearch(fields.project || '');
    const nPreview = normalizeVnSearch(fields.preview || '');
    const nBody = normalizeVnSearch(fields.body || '');
    const combined = `${nTitle} ${nProject} ${nPreview} ${nBody}`.trim();
    if (!tokens.every(tok => combined.includes(tok))) return 0;

    const phrase = tokens.join(' ');
    let score = 10;
    if (nTitle === phrase) score += 120;
    else if (nTitle.startsWith(phrase)) score += 80;
    else if (nTitle.includes(phrase)) score += 55;
    else if (tokens.every(tok => nTitle.includes(tok))) score += 40;

    if (nProject.includes(phrase)) score += 28;
    else if (tokens.every(tok => nProject.includes(tok))) score += 18;

    if (nPreview.includes(phrase)) score += 22;
    else if (tokens.some(tok => nPreview.includes(tok))) score += 10;

    if (nBody.includes(phrase)) score += 12;
    return score;
}

function buildNormIndexMap(text: string): NormCharMap {
    let norm = '';
    const starts: number[] = [];
    const ends: number[] = [];
    let i = 0;
    while (i < text.length) {
        const cp = text.codePointAt(i) ?? text.charCodeAt(i);
        const step = cp > 0xffff ? 2 : 1;
        const ch = text.slice(i, i + step);
        if (COMBINING_SINGLE_RE.test(ch)) {
            if (ends.length > 0) {
                ends[ends.length - 1] = i + step;
            }
            i += step;
            continue;
        }
        const stripped = ch
            .toLowerCase()
            .normalize('NFD')
            .replace(COMBINING_RE, '')
            .replace(/đ/g, 'd');
        for (let k = 0; k < stripped.length; k++) {
            norm += stripped[k];
            starts.push(i);
            ends.push(i + step);
        }
        i += step;
    }
    return { norm, starts, ends };
}

function findTokenSpans(text: string, query: string): Array<[number, number]> {
    if (!text || !query.trim()) return [];
    const tokens = tokenizeVnSearch(query).sort((a, b) => b.length - a.length);
    if (tokens.length === 0) return [];

    const { norm, starts, ends } = buildNormIndexMap(text);
    if (!norm) return [];

    const rawSpans: Array<[number, number]> = [];
    for (const tok of tokens) {
        if (!tok) continue;
        let fromIdx = 0;
        let hitLimit = 0;
        while (fromIdx < norm.length && hitLimit < 40) {
            const pos = norm.indexOf(tok, fromIdx);
            if (pos < 0) break;
            const origStart = starts[pos];
            const origEnd = ends[pos + tok.length - 1];
            if (origStart !== undefined && origEnd !== undefined && origEnd > origStart) {
                rawSpans.push([origStart, origEnd]);
                hitLimit++;
            }
            fromIdx = pos + tok.length;
        }
    }
    if (rawSpans.length === 0) return [];

    rawSpans.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : b[1] - a[1]));
    const merged: Array<[number, number]> = [];
    for (const [s, e] of rawSpans) {
        if (merged.length === 0 || s > merged[merged.length - 1][1]) {
            merged.push([s, e]);
        } else if (e > merged[merged.length - 1][1]) {
            merged[merged.length - 1][1] = e;
        }
    }
    return merged;
}

/**
 * Split text into highlighted and non-highlighted segments using diacritics-insensitive token matching
 * while preserving the exact original Vietnamese accented characters.
 */
export function buildHighlightedSegments(text: string, query: string): HighlightSegment[] {
    if (!text) return [];
    const spans = findTokenSpans(text, query);
    if (spans.length === 0) return [{ text, match: false }];

    const out: HighlightSegment[] = [];
    let cursor = 0;
    for (const [start, end] of spans) {
        if (start > cursor) {
            out.push({ text: text.slice(cursor, start), match: false });
        }
        out.push({ text: text.slice(start, end), match: true });
        cursor = end;
    }
    if (cursor < text.length) {
        out.push({ text: text.slice(cursor), match: false });
    }
    return out;
}

/**
 * Extract a concise contextual snippet centered around the first matching token.
 */
export function buildMatchSnippet(text: string, query: string, maxLen = 150): string {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    if (clean.length <= maxLen) return clean;
    const spans = findTokenSpans(clean, query);
    if (spans.length === 0) {
        return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
    }
    const [firstStart, firstEnd] = spans[0];
    const lead = Math.max(24, Math.floor((maxLen - (firstEnd - firstStart)) * 0.35));
    let winStart = Math.max(0, firstStart - lead);
    let winEnd = Math.min(clean.length, winStart + maxLen);
    if (winEnd - winStart < maxLen && winStart > 0) {
        winStart = Math.max(0, winEnd - maxLen);
    }
    if (winStart > 0) {
        const sp = clean.indexOf(' ', winStart);
        if (sp > winStart && sp - winStart < 14 && sp < firstStart) {
            winStart = sp + 1;
        }
    }
    if (winEnd < clean.length) {
        const sp = clean.lastIndexOf(' ', winEnd);
        if (sp > firstEnd && winEnd - sp < 14) {
            winEnd = sp;
        }
    }
    const prefix = winStart > 0 ? '…' : '';
    const suffix = winEnd < clean.length ? '…' : '';
    return `${prefix}${clean.slice(winStart, winEnd).trim()}${suffix}`;
}
