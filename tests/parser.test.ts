import { describe, expect, it } from 'vitest';
import { findObjectFromStartpoint, throttlingArraySplit } from '../src/parser.js';
import { HTMLParseError } from '../src/exceptions.js';

describe('findObjectFromStartpoint', () => {
  it('balances simple object literals', () => {
    const src = 'var x = {a: 1, b: 2};';
    const start = src.indexOf('{');
    expect(findObjectFromStartpoint(src, start)).toBe('{a: 1, b: 2}');
  });

  it('balances nested objects', () => {
    const src = 'var x = {a: {b: {c: 1}}, d: 2};';
    const start = src.indexOf('{');
    expect(findObjectFromStartpoint(src, start)).toBe('{a: {b: {c: 1}}, d: 2}');
  });

  it('balances arrays', () => {
    const src = 'var x = [1, [2, [3, 4]], 5];';
    const start = src.indexOf('[');
    expect(findObjectFromStartpoint(src, start)).toBe('[1, [2, [3, 4]], 5]');
  });

  it('ignores braces inside strings', () => {
    const src = 'var x = {a: "this } is { not", b: 1};';
    const start = src.indexOf('{');
    expect(findObjectFromStartpoint(src, start)).toBe('{a: "this } is { not", b: 1}');
  });

  it('handles escaped quotes inside strings', () => {
    const src = 'var x = {a: "she said \\"hi\\"", b: 1};';
    const start = src.indexOf('{');
    expect(findObjectFromStartpoint(src, start)).toBe('{a: "she said \\"hi\\"", b: 1}');
  });

  it('throws on a non-object/array start', () => {
    expect(() => findObjectFromStartpoint('hello', 0)).toThrow(HTMLParseError);
  });

  it('balances function bodies (used by cipher source extraction)', () => {
    const src = 'fn=function(a){a=a.split("");a.reverse();return a.join("")}';
    const start = src.indexOf('{');
    const result = findObjectFromStartpoint(src, start);
    expect(result).toBe('{a=a.split("");a.reverse();return a.join("")}');
  });
});

describe('throttlingArraySplit', () => {
  it('splits a simple array of integers', () => {
    expect(throttlingArraySplit('[1,2,3,4]')).toEqual(['1', '2', '3', '4']);
  });

  it('preserves function literals as single elements', () => {
    const arr = '[1,function(a){a.reverse()},2]';
    const parts = throttlingArraySplit(arr);
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe('1');
    expect(parts[1]).toBe('function(a){a.reverse()}');
    expect(parts[2]).toBe('2');
  });
});
