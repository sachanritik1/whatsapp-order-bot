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
  return phrases.some((phrase) => {
    const normalizedPhrase = normalizeText(phrase);
    if (normalizedPhrase.length === 0) {
      return false;
    }

    let from = 0;
    while (from <= normalized.length - normalizedPhrase.length) {
      const index = normalized.indexOf(normalizedPhrase, from);
      if (index < 0) {
        return false;
      }

      const beforeOk = index === 0 || normalized[index - 1] === " ";
      const afterIndex = index + normalizedPhrase.length;
      const afterOk = afterIndex === normalized.length || normalized[afterIndex] === " ";
      if (beforeOk && afterOk) {
        return true;
      }

      from = index + 1;
    }

    return false;
  });
};
