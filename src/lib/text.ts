const TOKEN_SPLIT = /[^a-z0-9]+/g;

export const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const tokenize = (value: string): ReadonlyArray<string> =>
  normalizeText(value)
    .split(TOKEN_SPLIT)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);

export const overlapScore = (
  queryTokens: ReadonlyArray<string>,
  candidateTokens: ReadonlyArray<string>
): number => {
  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const candidateSet = new Set(candidateTokens);
  const matches = queryTokens.filter((token) => candidateSet.has(token)).length;

  return matches / Math.max(queryTokens.length, candidateTokens.length);
};

export const containsAny = (
  text: string,
  phrases: ReadonlyArray<string>
): boolean => {
  const normalized = normalizeText(text);
  return phrases.some((phrase) => normalized.includes(normalizeText(phrase)));
};
