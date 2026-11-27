// The list as CSV (RFC 4180): fields separated by commas, lines ended by CRLF.

const CRLF = '\r\n';
const FORMULA_START = /^[=+\-@]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** A title a spreadsheet could take for a formula gets an apostrophe in front. */
const guard = (title) => (FORMULA_START.test(title) ? `'${title}` : title);

function field(value) {
  const text = String(value);
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The CSV text of `todos`, in the order given. */
export function toCsv(todos) {
  const lines = [['id', 'title', 'done', 'due_date']];
  for (const todo of todos) lines.push([todo.id, guard(todo.title), todo.done, todo.due_date ?? '']);
  return lines.map((line) => line.map(field).join(',') + CRLF).join('');
}
