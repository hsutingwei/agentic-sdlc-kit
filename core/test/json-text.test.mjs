import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childValues, detectLayout, insertChild, JsonTextError, nodeAt, parseJsonText, removeChild } from '../json-text.mjs';

const BOM = '\uFEFF';
const parse = (text) => JSON.parse(text.replace(/^\uFEFF/, ''));

// Documents in the styles a settings file is found in.
const DOCS = {
  'two spaces, LF': '{\n  "model": "sonnet",\n  "hooks": {\n    "Stop": [\n      { "matcher": "*", "hooks": [] }\n    ]\n  }\n}\n',
  'four spaces, CRLF': '{\r\n    "model": "sonnet",\r\n    "hooks": {\r\n        "Stop": []\r\n    }\r\n}\r\n',
  tabs: '{\n\t"env": {\n\t\t"說明": "中文 值"\n\t},\n\t"hooks": {}\n}',
  'BOM and odd spacing': `${BOM}{ "hooks" :{ "Stop" : [ ] } , "x":[1,2 , 3]  }\n\n`,
  compact: '{"hooks":{"Stop":[{"matcher":"*","hooks":[]}]},"permissions":{"deny":[]}}',
  empty: '{}\n',
  'empty with inner space': '{ \n \n}',
};

const ENTRY = { matcher: '*', hooks: [{ type: 'command', command: 'node "C:/示範 工具/asdk.mjs" hook', timeout: 10 }] };

test('parseJsonText accepts strict JSON and records spans', () => {
  for (const [name, text] of Object.entries(DOCS)) {
    const { root } = parseJsonText(text);
    assert.equal(root.type, 'object', name);
    assert.deepEqual(JSON.parse(text.slice(root.start, root.end)), parse(text), name); // spans index the original text
  }
  const { bom } = parseJsonText(DOCS['BOM and odd spacing']);
  assert.equal(bom, true);
  assert.equal(nodeAt(DOCS.compact, ['hooks', 'Stop', 0, 'matcher']).type, 'string');
  assert.equal(nodeAt(DOCS.compact, ['hooks', 'Nope']), null);
});

test('parseJsonText refuses what is not strict JSON', () => {
  for (const bad of ['{ // note\n}', '{"a":1,}', '{"a":1} x', "{'a':1}", '{"a":\u0001}', '[1 2]', '', '{"a":"\n"}']) {
    assert.throws(() => parseJsonText(bad), JsonTextError, JSON.stringify(bad));
  }
});

test('detectLayout reads the existing style', () => {
  assert.deepEqual(detectLayout(DOCS['two spaces, LF']), { eol: '\n', pretty: true, indent: '  ', colon: ': ' });
  assert.deepEqual(detectLayout(DOCS['four spaces, CRLF']), { eol: '\r\n', pretty: true, indent: '    ', colon: ': ' });
  assert.equal(detectLayout(DOCS.tabs).indent, '\t');
  assert.equal(detectLayout(DOCS.compact).pretty, false);
  assert.equal(detectLayout(DOCS.compact).colon, ':');
  assert.equal(detectLayout(DOCS.empty).pretty, true);
});

test('insert then remove restores every document byte for byte', () => {
  for (const [name, original] of Object.entries(DOCS)) {
    // An array element.
    let text = original;
    const hooksExists = nodeAt(text, ['hooks']) !== null;
    if (hooksExists && nodeAt(text, ['hooks', 'Stop'])) {
      const before = childValues(text, ['hooks', 'Stop']).length;
      const r = insertChild(text, ['hooks', 'Stop'], { value: ENTRY });
      assert.deepEqual(parse(r.text).hooks.Stop.at(-1), ENTRY, name);
      text = removeChild(r.text, ['hooks', 'Stop'], before, { emptyInner: r.emptyInner });
      assert.equal(text, original, `${name}: array element`);
    }
    // An object member, in the root and nested.
    const r1 = insertChild(text, [], { key: 'zz新', value: { hooks: { Stop: [ENTRY] } } });
    const value1 = parse(r1.text);
    assert.deepEqual(value1.zz新, { hooks: { Stop: [ENTRY] } }, name);
    const index = Object.keys(value1).indexOf('zz新');
    assert.equal(removeChild(r1.text, [], index, { emptyInner: r1.emptyInner }), original, `${name}: root member`);
  }
});

test('nested inserts into empty containers come back out in any order', () => {
  const original = DOCS['empty with inner space'];
  const a = insertChild(original, [], { key: 'hooks', value: {} });
  const b = insertChild(a.text, ['hooks'], { key: 'Stop', value: [] });
  const c = insertChild(b.text, ['hooks', 'Stop'], { value: ENTRY });
  const d = insertChild(c.text, ['hooks'], { key: 'SessionStart', value: [ENTRY] });
  assert.deepEqual(parse(d.text), { hooks: { Stop: [ENTRY], SessionStart: [ENTRY] } });

  let text = removeChild(d.text, ['hooks'], 0, { emptyInner: b.emptyInner }); // Stop first, SessionStart remains
  text = removeChild(text, ['hooks'], 0, { emptyInner: b.emptyInner });
  text = removeChild(text, [], 0, { emptyInner: a.emptyInner });
  assert.equal(text, original);
});

test('new content follows the document style', () => {
  const crlf = insertChild(DOCS['four spaces, CRLF'], ['hooks'], { key: 'SessionEnd', value: [ENTRY] }).text;
  assert.equal(crlf.replace(/\r\n/g, '').includes('\n'), false, 'no bare LF in a CRLF file');
  assert.match(crlf, /\r\n {8}"SessionEnd": \[\r\n {12}\{/);
  const compact = insertChild(DOCS.compact, ['hooks'], { key: 'SessionEnd', value: [ENTRY] }).text;
  assert.equal(compact.includes('\n'), false);
  const tabs = insertChild(DOCS.tabs, ['hooks'], { key: 'Stop', value: [] }).text;
  assert.match(tabs, /"hooks": \{\n\t\t"Stop": \[\]\n\t\}/);
});

test('removing a first child keeps the rest intact', () => {
  const text = '{\n  "a": 1,\n  "b": 2\n}';
  assert.equal(removeChild(text, [], 0), '{\n  "b": 2\n}');
  assert.throws(() => removeChild(text, [], 5), JsonTextError);
  assert.throws(() => insertChild(text, ['a'], { value: 1 }), JsonTextError);
  assert.throws(() => insertChild(text, [], { value: 1 }), /take a key/);
});
