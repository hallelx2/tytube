import { describe, expect, it } from 'vitest';
import { regexSearch, safeFilename, uniqueify, DeferredGeneratorList } from '../src/helpers.js';
import { RegexMatchError } from '../src/exceptions.js';

describe('regexSearch', () => {
  it('returns the requested capture group', () => {
    expect(regexSearch(/(\d+)-(\d+)/, '12-34', 1)).toBe('12');
    expect(regexSearch(/(\d+)-(\d+)/, '12-34', 2)).toBe('34');
  });

  it('throws RegexMatchError on no match', () => {
    expect(() => regexSearch(/x/, 'abc', 0)).toThrow(RegexMatchError);
  });
});

describe('safeFilename', () => {
  it('strips forbidden chars', () => {
    expect(safeFilename('a/b\\c:d?e*f"g<h>i|j')).toBe('abcdefghij');
  });

  it('preserves spaces and unicode', () => {
    expect(safeFilename('Hello world ☀')).toBe('Hello world ☀');
  });

  it('truncates to maxLength', () => {
    expect(safeFilename('abcdefghij', 4)).toBe('abcd');
  });
});

describe('uniqueify', () => {
  it('removes duplicates while preserving order', () => {
    expect(uniqueify([3, 1, 2, 1, 3, 4])).toEqual([3, 1, 2, 4]);
  });
});

describe('DeferredGeneratorList', () => {
  async function* gen() {
    yield 'a';
    yield 'b';
    yield 'c';
  }

  it('lazily yields items by index', async () => {
    const dgl = new DeferredGeneratorList(gen());
    expect(await dgl.at(0)).toBe('a');
    expect(await dgl.at(2)).toBe('c');
    expect(await dgl.at(5)).toBeUndefined();
  });

  it('iterates fully', async () => {
    const dgl = new DeferredGeneratorList(gen());
    const collected: string[] = [];
    for await (const x of dgl) collected.push(x);
    expect(collected).toEqual(['a', 'b', 'c']);
  });

  it('reports length after exhausting', async () => {
    const dgl = new DeferredGeneratorList(gen());
    expect(await dgl.length()).toBe(3);
  });
});
