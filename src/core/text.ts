/**
 * Characters that change how text is displayed without being visible themselves: control
 * characters (including terminal escape sequences), format characters (bidirectional overrides,
 * zero-width characters, soft hyphens, tag characters…), line and paragraph separators, and the
 * Hangul fillers, which are letters that display as blank space.
 */
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}ᅟᅠㅤﾠ]/gu;

/**
 * Removes characters that can alter how text is displayed (see `HIDDEN_CHARACTERS`). Applied to
 * anything that comes from a contract, a node or an RPC endpoint before it is shown. Line breaks
 * and tabs are kept unless `singleLine` is set.
 */
export function sanitizeText(text: string, options: { singleLine?: boolean } = {}): string {
  return text.replace(HIDDEN_CHARACTERS, (char) =>
    !options.singleLine && (char === '\n' || char === '\t') ? char : '',
  );
}

/**
 * Cleans a label read from a contract (e.g. a token symbol) before showing it. Token contracts can
 * return any string, including control characters that could alter a terminal's output.
 */
export function sanitizeLabel(text: string, maxLength = 24): string {
  const printable = sanitizeText(text, { singleLine: true }).trim();
  const cleaned = printable.length > maxLength ? `${printable.slice(0, maxLength)}…` : printable;
  return cleaned || '?';
}
