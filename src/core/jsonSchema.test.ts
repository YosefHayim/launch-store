import { describe, expect, it } from 'vitest';
import { type JsonSchema, validate } from './jsonSchema.js';

describe('validate', () => {
  it('flags a base-type mismatch and reports nothing valid alongside it', () => {
    const violations = validate(5, { type: 'string' });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('expected string, got number');
  });

  it('accepts an enum member and rejects a non-member', () => {
    const schema: JsonSchema = { type: 'string', enum: ['a', 'b'] };
    expect(validate('a', schema)).toEqual([]);
    const violations = validate('c', schema);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('"a" | "b"');
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

  it('passes anyOf when at least one branch matches', () => {
    const schema: JsonSchema = { anyOf: [{ type: 'string' }, { type: 'number' }] };
    expect(validate('x', schema)).toEqual([]);
    expect(validate(7, schema)).toEqual([]);
    expect(validate(true, schema)).toHaveLength(1);
  });

  it('validates array items by index', () => {
    const schema: JsonSchema = { type: 'array', items: { type: 'number' } };
    const violations = validate([1, 'x', 3], schema);
    expect(violations).toEqual([{ path: '[1]', message: 'expected number, got string' }]);
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
