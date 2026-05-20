// Memo string normalization for keyword matching.
//
// Steps:
// 1. 全角英数 → 半角
// 2. 全角カナ → 半角カナ (optional, configurable)
// 3. 大文字 → 小文字
// 4. trim whitespace
//
// Used by both classifier and exclusion checker for consistent matching.

export function normalizeMemo(input: string): string {
  if (!input) return '';
  let s = input;

  // 全角英数 → 半角 (ASCII range 0x21-0x7E)
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );

  // 全角スペース → 半角スペース
  s = s.replace(/　/g, ' ');

  // 大文字 → 小文字
  s = s.toLowerCase();

  // Trim + collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

export function normalizeKeywordList(keywords: string[]): string[] {
  return keywords.map(normalizeMemo);
}
