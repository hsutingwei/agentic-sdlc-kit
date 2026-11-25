// Text helpers shared by the modules that show or hand over changes.

/**
 * Shortens lines longer than `max` characters to their first `keep` characters and a note
 * saying how many were left out. A diff with generated data (for example a 60,000-character
 * string in a test) stays readable for a person and cheap for a model.
 */
export function shortenLongLines(text, { max = 300, keep = 200, where = 'whole line in the full file' } = {}) {
  return text
    .split('\n')
    .map((line) => (line.length > max ? `${line.slice(0, keep)} … (${line.length - keep} more characters, ${where})` : line))
    .join('\n');
}
