// The list as CSV (RFC 4180): fields separated by commas, lines ended by CRLF.

const CRLF = '\r\n';
const FORMULA_START = /^[=+\-@]/;
const NEEDS_QUOTES = /[",\n]/;

function field(value) {
  const text = String(value);
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A field a spreadsheet could take for a formula gets an apostrophe in front. */
const guard = (text) => (FORMULA_START.test(text) ? `'${text}` : text);

/** The CSV text of `todos`, in the order given. */
export function toCsv(todos) {
  const lines = [['id', 'title', 'done', 'due_date']];
  for (const todo of todos) lines.push([field(todo.id), guard(field(todo.title)), field(todo.done), field(todo.due_date ?? '')]);
  return lines.map((line) => line.join(',') + CRLF).join('');
}
