import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSchema, isDateTime, SchemaError } from '../validate.mjs';

const paths = (result) => result.errors.map((e) => e.path);

test('type checks distinguish integer, number, object, array and null', () => {
  const v = compileSchema({ type: 'object', properties: { i: { type: 'integer' }, n: { type: 'number' }, a: { type: 'array' }, o: { type: 'object' }, z: { type: 'null' } } });
  assert.equal(v({ i: 1, n: 1.5, a: [], o: {}, z: null }).valid, true);
  assert.deepEqual(paths(v({ i: 1.5, n: Number.NaN, a: {}, o: [], z: 0 })), ['/i', '/n', '/a', '/o', '/z']);
  assert.equal(compileSchema({ type: 'object' })(null).valid, false);
});

test('required, additionalProperties and nested paths use JSON Pointer', () => {
  const v = compileSchema({
    type: 'object',
    required: ['a'],
    additionalProperties: false,
    properties: { a: { type: 'object', properties: { 'x/y': { type: 'string' } } } },
  });
  const r = v({ b: 1 });
  assert.deepEqual(r.errors, [
    { path: '/a', message: 'is required' },
    { path: '/b', message: 'is not an allowed property' },
  ]);
  assert.deepEqual(paths(v({ a: { 'x/y': 1 } })), ['/a/x~1y']);
});

test('string length counts code points, so CJK and emoji count as one', () => {
  const v = compileSchema({ type: 'string', minLength: 2, maxLength: 3 });
  assert.equal(v('待辦').valid, true);
  assert.equal(v('😀😀😀').valid, true);
  assert.equal(v('待辦事項').valid, false);
  assert.equal(v('a').valid, false);
});

test('pattern uses unicode mode', () => {
  const v = compileSchema({ type: 'string', pattern: '^\\p{Script=Han}+$' });
  assert.equal(v('待辦').valid, true);
  assert.equal(v('todo').valid, false);
});

test('enum, const and uniqueItems compare structurally', () => {
  assert.equal(compileSchema({ enum: [{ a: 1 }, 'x'] })({ a: 1 }).valid, true);
  assert.equal(compileSchema({ const: [1, 2] })([2, 1]).valid, false);
  const unique = compileSchema({ type: 'array', uniqueItems: true });
  assert.equal(unique([{ a: 1 }, { a: 1 }]).valid, false);
  assert.equal(unique([{ a: 1 }, { a: 2 }]).valid, true);
});

test('numeric bounds', () => {
  const v = compileSchema({ type: 'number', exclusiveMinimum: 0, maximum: 10 });
  assert.equal(v(0).valid, false);
  assert.equal(v(0.5).valid, true);
  assert.equal(v(10).valid, true);
  assert.equal(v(10.1).valid, false);
});

test('maxLength applies only to strings in a union type', () => {
  const v = compileSchema({ type: ['string', 'number'], maxLength: 2 });
  assert.equal(v(12345).valid, true);
  assert.equal(v('abc').valid, false);
});

test('$ref resolves local $defs', () => {
  const v = compileSchema({ $defs: { id: { type: 'string', pattern: '^D-' } }, type: 'array', items: { $ref: '#/$defs/id' } });
  assert.equal(v(['D-1']).valid, true);
  assert.deepEqual(paths(v(['D-1', 'X'])), ['/1']);
});

test('if/then applies only when the condition holds', () => {
  const v = compileSchema({
    type: 'object',
    if: { required: ['status'], properties: { status: { const: 'ended' } } },
    then: { required: ['ended_at'] },
  });
  assert.equal(v({ status: 'active' }).valid, true);
  assert.equal(v({}).valid, true);
  assert.deepEqual(paths(v({ status: 'ended' })), ['/ended_at']);
});

test('unsupported keywords are rejected instead of ignored', () => {
  assert.throws(() => compileSchema({ type: 'object', patternProperties: {} }), SchemaError);
  assert.throws(() => compileSchema({ properties: { a: { oneOf: [] } } }), /unsupported keyword "oneOf"/);
  assert.throws(() => compileSchema({ format: 'email' }), /unsupported format/);
  assert.throws(() => compileSchema({ $ref: 'other.json#/x' }), /unresolvable \$ref/);
  assert.throws(() => compileSchema({ pattern: '(' }), /invalid pattern/);
  assert.throws(() => compileSchema({ minLength: -1 }), /non-negative integer/);
});

test('date-time requires a time zone and a real calendar date', () => {
  assert.equal(isDateTime('2026-11-02T09:00:00+08:00'), true);
  assert.equal(isDateTime('2026-11-02T01:15:03.250Z'), true);
  assert.equal(isDateTime('2028-02-29T00:00:00Z'), true);
  assert.equal(isDateTime('2026-02-29T00:00:00Z'), false);
  assert.equal(isDateTime('2026-11-02T09:00:00'), false);
  assert.equal(isDateTime('2026-11-02 09:00:00Z'), false);
  assert.equal(isDateTime('2026-13-01T00:00:00Z'), false);
  assert.equal(isDateTime('2026-11-02T24:00:00Z'), false);
});
