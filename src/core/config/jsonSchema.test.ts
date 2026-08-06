import { describe, expect, it } from 'vitest';
import { type JsonSchema, validate } from './jsonSchema.js';

describe('validate', () => {
  it('flags a base-type mismatch and reports nothing valid alongside it', () => {
    const violations = validate(5, { type: 'string' });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('expected string, got number');
  });

  it('accepts integer only for whole numbers', () => {
    expect(validate(3, { type: 'integer' })).toEqual([]);
    expect(validate(3.5, { type: 'integer' })).toHaveLength(1);
    expect(validate(3.5, { type: 'number' })).toEqual([]);
  });

  it('accepts a union type list', () => {
    const schema: JsonSchema = { type: ['string', 'number'] };
    expect(validate('x', schema)).toEqual([]);
    expect(validate(1, schema)).toEqual([]);
    expect(validate(true, schema)).toHaveLength(1);
  });

  it('accepts an enum member and rejects a non-member', () => {
    const schema: JsonSchema = { type: 'string', enum: ['a', 'b'] };
    expect(validate('a', schema)).toEqual([]);
    const violations = validate('c', schema);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('"a" | "b"');
  });

  it('enforces const equality', () => {
    const schema: JsonSchema = { const: 'ship' };
    expect(validate('ship', schema)).toEqual([]);
    expect(validate('hold', schema)).toEqual([
      { path: '', message: 'expected "ship", got "hold"' },
    ]);
  });

  it('reports a missing required property at its own path', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    };
    const violations = validate({}, schema);
    expect(violations).toEqual([{ path: 'name', message: 'missing required property' }]);
  });

  it('rejects an unknown property when additionalProperties is false', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    };
    const violations = validate({ name: 'ok', extra: 1 }, schema);
    expect(violations).toEqual([{ path: 'extra', message: 'unknown property' }]);
  });

  it('validates additionalProperties when it is a nested schema', () => {
    const schema: JsonSchema = {
      type: 'object',
      additionalProperties: { type: 'number' },
    };
    expect(validate({ a: 1, b: 2 }, schema)).toEqual([]);
    expect(validate({ a: 1, b: 'x' }, schema)).toEqual([
      { path: 'b', message: 'expected number, got string' },
    ]);
  });

  it("resolves a percent-encoded $ref pointer and validates the referenced map's values", () => {
    const root: JsonSchema = {
      definitions: {
        // The generator decodes definition KEYS but percent-encodes the $ref that points at them.
        'Record<string,number>': { type: 'object', additionalProperties: { type: 'number' } },
      },
      properties: { counts: { $ref: '#/definitions/Record%3Cstring%2Cnumber%3E' } },
      type: 'object',
    };
    expect(validate({ counts: { a: 1, b: 2 } }, root)).toEqual([]);
    const violations = validate({ counts: { a: 1, b: 'two' } }, root);
    expect(violations).toEqual([{ path: 'counts.b', message: 'expected number, got string' }]);
  });

  it('reports an unresolved $ref', () => {
    expect(validate(1, { $ref: '#/definitions/Missing' })).toEqual([
      { path: '', message: 'unresolved schema reference #/definitions/Missing' },
    ]);
  });

  it('passes anyOf when at least one branch matches', () => {
    const schema: JsonSchema = { anyOf: [{ type: 'string' }, { type: 'number' }] };
    expect(validate('x', schema)).toEqual([]);
    expect(validate(7, schema)).toEqual([]);
    expect(validate(true, schema)).toHaveLength(1);
  });

  it('requires exactly one oneOf branch to match', () => {
    const schema: JsonSchema = {
      oneOf: [
        { type: 'string', enum: ['a'] },
        { type: 'string', enum: ['a', 'b'] },
      ],
    };
    // 'b' matches only the second branch.
    expect(validate('b', schema)).toEqual([]);
    // 'a' matches both branches -> oneOf failure.
    expect(validate('a', schema)).toHaveLength(1);
    expect(validate(1, schema)).toHaveLength(1);
  });

  it('aggregates allOf branch violations', () => {
    const schema: JsonSchema = {
      allOf: [
        { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        { type: 'object', properties: { age: { type: 'number' } }, required: ['age'] },
      ],
    };
    expect(validate({ name: 'x', age: 1 }, schema)).toEqual([]);
    const violations = validate({}, schema);
    expect(violations).toContainEqual({ path: 'name', message: 'missing required property' });
    expect(violations).toContainEqual({ path: 'age', message: 'missing required property' });
  });

  it('validates array items by index', () => {
    const schema: JsonSchema = { type: 'array', items: { type: 'number' } };
    const violations = validate([1, 'x', 3], schema);
    expect(violations).toEqual([{ path: '[1]', message: 'expected number, got string' }]);
  });

  it('bracket-quotes non-identifier object keys in paths', () => {
    const schema: JsonSchema = {
      type: 'object',
      additionalProperties: { type: 'number' },
    };
    const violations = validate({ 'a.b': 'nope' }, schema);
    expect(violations).toEqual([{ path: '["a.b"]', message: 'expected number, got string' }]);
  });

  it('returns no violations for a value that matches a nested object schema', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        profile: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
      required: ['profile'],
    };
    expect(validate({ profile: { name: 'production' } }, schema)).toEqual([]);
  });
});
