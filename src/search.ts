/** Friendly Vietnamese matching for names, codes and album titles. */
export function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi')
    .trim()
    .replace(/\s+/g, ' ');
}

export function matchesSearch(value: string, query: string) {
  return normalizeSearch(value).includes(normalizeSearch(query));
}
