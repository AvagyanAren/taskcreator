/**
 * HTTP headers may only carry ISO-8859-1 characters, so the client sends the
 * password percent-encoded. A Cyrillic (or any non-Latin) password would
 * otherwise make the browser refuse the request outright.
 */
export function decodeSuppliedPassword(raw: string): string[] {
  const candidates = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) candidates.push(decoded);
  } catch {
    /* malformed encoding — compare the raw value only */
  }
  return candidates;
}

export function passwordMatches(expected: string, supplied: string): boolean {
  if (!expected) return true;
  if (!supplied) return false;
  return decodeSuppliedPassword(supplied).some((value) => value === expected);
}
