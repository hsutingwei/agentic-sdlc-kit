// Matching a title against the text of a search.

/** True when `title` contains `query`, whatever the letter case. */
export function matches(title, query) {
  return title.toLowerCase().includes(query);
}
