// Smart keyword matcher that prevents English-keyword false positives.
//
// Problem (= discovered 2026-05-12):
//   keyword "ANA" → substring match → "Posthog Cloud (= an analytics SaaS)"
//   の "ana" に誤発火、 travel category に分類される。
//
// Fix:
//   - ASCII-only keywords → word-boundary regex match
//   - Japanese / CJK / mixed keywords → substring match (= 既存挙動)
//
// Word boundary regex (\b) only works for word chars (= [A-Za-z0-9_]),
// not CJK. So we split by charset and use appropriate strategy.

const ASCII_ONLY_RE = /^[\x00-\x7F]+$/;
const REGEX_SPECIAL_RE = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(s: string): string {
  return s.replace(REGEX_SPECIAL_RE, '\\$&');
}

/**
 * Test if a keyword matches in a normalized memo.
 *
 * For ASCII-only keywords (= "ANA", "Suica", "Amazon"): require word boundary.
 *   - "ANA 機内食" → matches (= space boundary)
 *   - "analytics" → no match (= mid-word)
 *   - "ANA"      → matches (= start/end boundary)
 *
 * For non-ASCII keywords (= "新幹線", "コーヒー"): substring match.
 *   - "新幹線のぞみ" → matches
 *   - "新幹線" alone → matches
 */
export function keywordMatches(normalizedMemo: string, normalizedKeyword: string): boolean {
  if (!normalizedKeyword) return false;

  if (ASCII_ONLY_RE.test(normalizedKeyword)) {
    // ASCII keyword → word-boundary regex
    const re = new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`, 'i');
    return re.test(normalizedMemo);
  } else {
    // CJK / mixed keyword → substring match (= original behavior)
    return normalizedMemo.includes(normalizedKeyword);
  }
}

/**
 * Find first matching keyword from a pre-normalized list against a pre-normalized memo.
 * Returns the index of the first match, or -1 if no match.
 *
 * Use this in classifier loops for efficient single-pass matching.
 */
export function findFirstMatchingKeyword(normalizedMemo: string, normalizedKeywords: string[]): number {
  for (let i = 0; i < normalizedKeywords.length; i++) {
    if (keywordMatches(normalizedMemo, normalizedKeywords[i])) {
      return i;
    }
  }
  return -1;
}
