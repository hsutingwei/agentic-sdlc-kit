// Byte-preserving edits of JSON text.
//
// Parsing a settings file and writing it back with JSON.stringify would change
// indentation, key order, line endings and a byte-order mark the user's file may
// have. These helpers locate values in the original text and splice in, or cut
// out, exactly one child at a time; every other byte stays as it was.
//
// Inverse pairs (what makes a byte-exact uninstall possible):
// - insertChild into a non-empty container adds `,` + gap + child after the last
//   child, where gap is the whitespace the container already uses before its first
//   child. removeChild of a child that is not the first deletes from the end of the
//   previous child to its own end: the same bytes.
// - insertChild into an empty container replaces its inner whitespace and returns
//   that whitespace as `emptyInner`; removeChild of the only child puts it back.
//
// Only strict JSON is accepted (an optional UTF-8 BOM aside): comments, trailing
// commas and other extensions are refused rather than guessed at.

export class JsonTextError extends Error {}

const WS = new Set([' ', '\t', '\n', '\r']);
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/**
 * @typedef {{ type: 'object'|'array'|'string'|'number'|'literal', start: number, end: number,
 *   members?: { key: string, start: number, value: Node }[], items?: Node[] }} Node
 * Positions are UTF-16 offsets into the text; `start` of a member is its key's opening quote.
 */

/** @returns {{ bom: boolean, root: Node }} */
export function parseJsonText(text) {
  const bom = text.charCodeAt(0) === 0xfeff;
  let i = bom ? 1 : 0;

  const fail = (what) => {
    throw new JsonTextError(`${what} at offset ${i}`);
  };
  const skipWs = () => {
    while (i < text.length && WS.has(text[i])) i++;
    if (text[i] === '/') fail('comments are not JSON');
  };
  const parseString = () => {
    const start = i++;
    while (i < text.length && text[i] !== '"') {
      if (text.charCodeAt(i) < 0x20) fail('control character in string');
      i += text[i] === '\\' ? 2 : 1;
    }
    if (i >= text.length) fail('unterminated string');
    i++;
    return { type: 'string', start, end: i };
  };
  const parseValue = () => {
    skipWs();
    const c = text[i];
    if (c === '{') {
      const node = { type: 'object', start: i, end: -1, members: [] };
      i++;
      skipWs();
      if (text[i] === '}') {
        node.end = ++i;
        return node;
      }
      for (;;) {
        skipWs();
        if (text[i] !== '"') fail('expected a key');
        const keyNode = parseString();
        const key = JSON.parse(text.slice(keyNode.start, keyNode.end));
        skipWs();
        if (text[i] !== ':') fail('expected ":"');
        i++;
        const value = parseValue();
        node.members.push({ key, start: keyNode.start, value });
        skipWs();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          node.end = ++i;
          return node;
        }
        fail('expected "," or "}"');
      }
    }
    if (c === '[') {
      const node = { type: 'array', start: i, end: -1, items: [] };
      i++;
      skipWs();
      if (text[i] === ']') {
        node.end = ++i;
        return node;
      }
      for (;;) {
        node.items.push(parseValue());
        skipWs();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          node.end = ++i;
          return node;
        }
        fail('expected "," or "]"');
      }
    }
    if (c === '"') return parseString();
    for (const lit of ['true', 'false', 'null']) {
      if (text.startsWith(lit, i)) {
        const start = i;
        i += lit.length;
        return { type: 'literal', start, end: i };
      }
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m && m[0] !== '') {
      const start = i;
      i += m[0].length;
      return { type: 'number', start, end: i };
    }
    return fail('unexpected character');
  };

  const root = parseValue();
  skipWs();
  if (i !== text.length) fail('unexpected text after the JSON value');
  return { bom, root };
}

/** Children of a container as { start, end, key? } spans. */
function children(node) {
  if (node.type === 'object') return node.members.map((m) => ({ start: m.start, end: m.value.end, key: m.key, value: m.value }));
  if (node.type === 'array') return node.items.map((v) => ({ start: v.start, end: v.end, value: v }));
  throw new JsonTextError(`expected an object or array, found ${node.type}`);
}

/** Follows object keys (the last duplicate wins, as in JSON.parse) and array indexes. */
export function nodeAt(text, path) {
  let node = parseJsonText(text).root;
  for (const step of path) {
    if (typeof step === 'number') {
      if (node.type !== 'array' || step < 0 || step >= node.items.length) return null;
      node = node.items[step];
    } else {
      if (node.type !== 'object') return null;
      const hits = node.members.filter((m) => m.key === step);
      if (hits.length === 0) return null;
      node = hits[hits.length - 1].value;
    }
  }
  return node;
}

function requireContainer(text, path) {
  const node = nodeAt(text, path);
  if (!node) throw new JsonTextError(`nothing at ${JSON.stringify(path)}`);
  children(node); // throws for scalars
  return node;
}

/** Layout the document already uses: line ending, indent unit, key separator, and whether it is pretty-printed. */
export function detectLayout(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  // Pretty-printed when it spans lines, or when nothing shows a style (`{}`): new
  // content then looks like what Claude Code itself writes.
  const pretty = /\n/.test(text.trim()) || !/[{[]\s*[^\s}\]]/.test(text);
  let indent = '  ';
  const m = /[{[][ \t]*\r?\n([ \t]+)\S/.exec(text);
  if (m) {
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const outer = /^[ \t]*/.exec(text.slice(lineStart))[0];
    if (m[1].startsWith(outer) && m[1].length > outer.length) indent = m[1].slice(outer.length);
  }
  const sep = /"(?:[^"\\]|\\.)*"([ \t]*:[ \t]*)/.exec(text);
  return { eol, pretty, indent, colon: sep ? sep[1] : ': ' };
}

const lineIndentAt = (text, pos) => /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', pos - 1) + 1))[0];

/** Serialises a value the way the document would, as a child whose line starts with `childIndent`. */
function formatChild(value, key, layout, childIndent) {
  let body = layout.pretty ? JSON.stringify(value, null, layout.indent) : JSON.stringify(value);
  if (layout.pretty) body = body.split('\n').join(layout.eol + childIndent);
  if (layout.pretty && layout.colon !== ': ') body = body.replace(/^(\s*"(?:[^"\\]|\\.)*"): /gm, `$1${layout.colon}`);
  return key === undefined ? body : `${JSON.stringify(key)}${layout.colon}${body}`;
}

/**
 * Appends a child to the object or array at `path` (a member `key` for objects).
 * @returns {{ text: string, emptyInner?: string }} emptyInner is set when the container was empty.
 */
export function insertChild(text, path, { key, value }) {
  const node = requireContainer(text, path);
  if ((node.type === 'object') !== (key !== undefined)) throw new JsonTextError('objects take a key, arrays do not');
  const layout = detectLayout(text);
  const kids = children(node);
  const open = node.start;
  const close = node.end - 1;

  if (kids.length > 0) {
    const gap = text.slice(open + 1, kids[0].start);
    const childIndent = gap.includes('\n') ? gap.slice(gap.lastIndexOf('\n') + 1) : lineIndentAt(text, open) + layout.indent;
    const at = kids[kids.length - 1].end;
    return { text: `${text.slice(0, at)},${gap}${formatChild(value, key, layout, childIndent)}${text.slice(at)}` };
  }

  const emptyInner = text.slice(open + 1, close);
  let inner;
  if (layout.pretty) {
    const outer = lineIndentAt(text, open);
    const childIndent = outer + layout.indent;
    inner = `${layout.eol}${childIndent}${formatChild(value, key, layout, childIndent)}${layout.eol}${outer}`;
  } else {
    inner = formatChild(value, key, layout, '');
  }
  return { text: `${text.slice(0, open + 1)}${inner}${text.slice(close)}`, emptyInner };
}

/** Removes child `index` of the container at `path`; when it is the only child, `emptyInner` goes back between the brackets. */
export function removeChild(text, path, index, { emptyInner = '' } = {}) {
  const node = requireContainer(text, path);
  const kids = children(node);
  if (index < 0 || index >= kids.length) throw new JsonTextError(`no child ${index} at ${JSON.stringify(path)}`);
  if (kids.length === 1) return `${text.slice(0, node.start + 1)}${emptyInner}${text.slice(node.end - 1)}`;
  if (index > 0) return text.slice(0, kids[index - 1].end) + text.slice(kids[index].end);
  return text.slice(0, kids[0].start) + text.slice(kids[1].start);
}

/** Children of the container at `path` as parsed values, with their object keys. */
export function childValues(text, path) {
  const node = nodeAt(text, path);
  if (!node || (node.type !== 'object' && node.type !== 'array')) return null;
  return children(node).map((c) => ({ key: c.key, value: JSON.parse(text.slice(c.value.start, c.value.end)) }));
}
