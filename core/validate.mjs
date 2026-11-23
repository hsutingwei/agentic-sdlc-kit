// Dependency-free validator for the kit's JSON contracts.
//
// It implements a documented subset of JSON Schema 2020-12 (see core/README.md).
// A schema that uses any keyword outside the subset is rejected when compiled,
// instead of the keyword being silently ignored: a contract must never look
// stricter than what is actually enforced.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schemas');

const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'examples', 'default']);
const SUPPORTED = new Set([
  '$ref',
  '$defs',
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'minProperties',
  'maxProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'allOf',
  'if',
  'then',
  'else',
]);
const TYPES = new Set(['null', 'boolean', 'string', 'number', 'integer', 'array', 'object']);
const FORMATS = { 'date-time': isDateTime };

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
  }
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const escapePointer = (key) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const NON_NEGATIVE_INT = new Set(['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties']);

/** RFC 3339 date-time with a mandatory time zone, checked for real calendar dates. */
export function isDateTime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/i.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 60) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return false;
  if (m[9] !== undefined && (Number(m[9]) > 23 || Number(m[10]) > 59)) return false;
  return true;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function matchesType(value, type) {
  switch (type) {
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    default:
      return false;
  }
}

function resolveRef(root, ref, at) {
  const m = /^#\/\$defs\/([^/]+)$/.exec(ref);
  const target = m && isPlainObject(root.$defs) ? root.$defs[m[1]] : undefined;
  if (target === undefined) throw new SchemaError(`${at}: unresolvable $ref "${ref}" (only "#/$defs/<name>" is supported)`);
  return target;
}

function checkSchema(node, at, root) {
  if (typeof node === 'boolean') return;
  if (!isPlainObject(node)) throw new SchemaError(`${at}: a schema must be an object or a boolean`);

  for (const [key, value] of Object.entries(node)) {
    if (ANNOTATIONS.has(key)) continue;
    if (!SUPPORTED.has(key)) throw new SchemaError(`${at}: unsupported keyword "${key}"`);
    const here = `${at}/${escapePointer(key)}`;

    if (NON_NEGATIVE_INT.has(key) && !(Number.isInteger(value) && value >= 0)) {
      throw new SchemaError(`${here}: must be a non-negative integer`);
    }
    switch (key) {
      case '$ref':
        if (typeof value !== 'string') throw new SchemaError(`${here}: must be a string`);
        resolveRef(root, value, here);
        break;
      case '$defs':
      case 'properties':
        if (!isPlainObject(value)) throw new SchemaError(`${here}: must be an object`);
        for (const [name, sub] of Object.entries(value)) checkSchema(sub, `${here}/${escapePointer(name)}`, root);
        break;
      case 'type': {
        const list = Array.isArray(value) ? value : [value];
        if (list.length === 0 || !list.every((t) => TYPES.has(t))) throw new SchemaError(`${here}: unknown type`);
        break;
      }
      case 'enum':
        if (!Array.isArray(value) || value.length === 0) throw new SchemaError(`${here}: must be a non-empty array`);
        break;
      case 'required':
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
          throw new SchemaError(`${here}: must be an array of strings`);
        }
        break;
      case 'additionalProperties':
      case 'items':
      case 'if':
      case 'then':
      case 'else':
        checkSchema(value, here, root);
        break;
      case 'allOf':
        if (!Array.isArray(value) || value.length === 0) throw new SchemaError(`${here}: must be a non-empty array`);
        value.forEach((sub, i) => checkSchema(sub, `${here}/${i}`, root));
        break;
      case 'pattern':
        try {
          new RegExp(value, 'u');
        } catch (err) {
          throw new SchemaError(`${here}: invalid pattern: ${err.message}`);
        }
        break;
      case 'format':
        if (!Object.hasOwn(FORMATS, value)) throw new SchemaError(`${here}: unsupported format "${value}"`);
        break;
      case 'minimum':
      case 'maximum':
      case 'exclusiveMinimum':
      case 'exclusiveMaximum':
        if (typeof value !== 'number') throw new SchemaError(`${here}: must be a number`);
        break;
      case 'uniqueItems':
        if (typeof value !== 'boolean') throw new SchemaError(`${here}: must be a boolean`);
        break;
      default:
        break;
    }
  }
}

function validateNode(schema, value, ptr, root, errors) {
  const at = ptr === '' ? '/' : ptr;
  const fail = (message) => errors.push({ path: at, message });

  if (schema === true) return;
  if (schema === false) return fail('is not allowed');

  if (schema.$ref !== undefined) validateNode(resolveRef(root, schema.$ref, at), value, ptr, root, errors);

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) return fail(`must be of type ${types.join(' or ')}`);
  }
  if (Object.hasOwn(schema, 'const') && !deepEqual(value, schema.const)) {
    fail(`must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum !== undefined && !schema.enum.some((v) => deepEqual(v, value))) {
    fail(`must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }

  if (typeof value === 'string') {
    const length = [...value].length; // code points, as JSON Schema specifies
    if (schema.minLength !== undefined && length < schema.minLength) fail(`must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && length > schema.maxLength) fail(`must be at most ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
      fail(`must match pattern ${schema.pattern}`);
    }
    if (schema.format !== undefined && !FORMATS[schema.format](value)) fail(`must be a valid ${schema.format}`);
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`must be <= ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      fail(`must be > ${schema.exclusiveMinimum}`);
    }
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      fail(`must be < ${schema.exclusiveMaximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`must have at most ${schema.maxItems} items`);
    if (schema.uniqueItems === true) {
      for (let i = 1; i < value.length; i++) {
        if (value.slice(0, i).some((prev) => deepEqual(prev, value[i]))) {
          fail(`must not contain duplicate items (index ${i})`);
          break;
        }
      }
    }
    if (schema.items !== undefined) {
      value.forEach((item, i) => validateNode(schema.items, item, `${ptr}/${i}`, root, errors));
    }
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      fail(`must have at least ${schema.minProperties} properties`);
    }
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
      fail(`must have at most ${schema.maxProperties} properties`);
    }
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(value, name)) errors.push({ path: `${ptr}/${escapePointer(name)}`, message: 'is required' });
    }
    const props = schema.properties ?? {};
    for (const key of keys) {
      const child = `${ptr}/${escapePointer(key)}`;
      if (Object.hasOwn(props, key)) validateNode(props[key], value[key], child, root, errors);
      else if (schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) errors.push({ path: child, message: 'is not an allowed property' });
        else validateNode(schema.additionalProperties, value[key], child, root, errors);
      }
    }
  }

  for (const sub of schema.allOf ?? []) validateNode(sub, value, ptr, root, errors);

  if (schema.if !== undefined) {
    const probe = [];
    validateNode(schema.if, value, ptr, root, probe);
    const branch = probe.length === 0 ? schema.then : schema.else;
    if (branch !== undefined) validateNode(branch, value, ptr, root, errors);
  }
}

/**
 * Checks a schema against the supported subset and returns a validator function.
 * @returns {(value: unknown) => { valid: boolean, errors: Array<{ path: string, message: string }> }}
 */
export function compileSchema(schema) {
  checkSchema(schema, '#', schema);
  return (value) => {
    const errors = [];
    validateNode(schema, value, '', schema, errors);
    return { valid: errors.length === 0, errors };
  };
}

/** Names of the contracts shipped in core/schemas, without the .schema.json suffix. */
export function listContracts() {
  return readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.schema.json'))
    .map((f) => f.slice(0, -'.schema.json'.length))
    .sort();
}

export function loadSchema(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name) || !listContracts().includes(name)) {
    throw new SchemaError(`unknown contract "${name}" (known: ${listContracts().join(', ')})`);
  }
  return JSON.parse(readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), 'utf8'));
}

const compiled = new Map();

/** Validates `value` against one of the shipped contracts. */
export function validateContract(name, value) {
  if (!compiled.has(name)) compiled.set(name, compileSchema(loadSchema(name)));
  return compiled.get(name)(value);
}
