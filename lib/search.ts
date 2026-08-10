export function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU");
}

export function matchesSearchText(
  query: string,
  ...values: Array<string | null | undefined>
): boolean {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;
  return values.some((value) =>
    value ? normalizeSearch(value).includes(normalizedQuery) : false
  );
}
