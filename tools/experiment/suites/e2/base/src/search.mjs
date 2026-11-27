// Matching a title against the text of a search.

const fold = (text) => text.normalize('NFKC').toLowerCase();

/** True when `title` contains `query`, whatever the letter case or the Unicode form. */
export function matches(title, query) {
  return fold(title).includes(fold(query));
}
