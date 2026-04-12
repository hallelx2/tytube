// Various helper functions. Mirrors pytube/helpers.py.

import { RegexMatchError } from './exceptions.js';

/**
 * Search a string for a regex pattern and return the requested capture group.
 * Throws RegexMatchError if the pattern does not match.
 */
export function regexSearch(pattern: string | RegExp, source: string, group: number): string {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  const match = regex.exec(source);
  if (!match) {
    throw new RegexMatchError('regexSearch', pattern);
  }
  const value = match[group];
  if (value === undefined) {
    throw new RegexMatchError('regexSearch', pattern);
  }
  return value;
}

const NTFS_FORBIDDEN_CHARS = (() => {
  const out: string[] = [];
  for (let i = 0; i < 32; i++) out.push(String.fromCharCode(i));
  return out;
})();

const FILENAME_FORBIDDEN_LITERALS = [
  '"', '#', '$', '%', "'", '*', ',', '.', '/', ':', ';',
  '<', '>', '?', '\\', '^', '|', '~',
];

/**
 * Sanitize a string so it is safe to use as a filename across Windows / macOS / Linux.
 * Mirrors pytube.helpers.safe_filename.
 */
export function safeFilename(s: string, maxLength = 255): string {
  const forbidden = new Set<string>([...NTFS_FORBIDDEN_CHARS, ...FILENAME_FORBIDDEN_LITERALS]);
  let out = '';
  for (const ch of s) {
    if (!forbidden.has(ch)) out += ch;
  }
  return out.slice(0, maxLength);
}

/**
 * Remove duplicate items from an array while preserving order.
 */
export function uniqueify<T>(items: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Memoize a zero-or-more-arg async function on its first invocation.
 * Caches by JSON-stringified arguments. Used in place of pytube's `@cache` decorator.
 */
export function memoize<TArgs extends readonly unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  const cache = new Map<string, Promise<TResult>>();
  return (...args: TArgs) => {
    const key = JSON.stringify(args);
    let cached = cache.get(key);
    if (!cached) {
      cached = fn(...args);
      cache.set(key, cached);
    }
    return cached;
  };
}

/**
 * Async iterable wrapper that defers generation of items.
 * Mirrors pytube.helpers.DeferredGeneratorList — used by Playlist/Channel
 * so iterating doesn't force the entire continuation chain at once.
 */
export class DeferredGeneratorList<T> implements AsyncIterable<T> {
  private readonly source: AsyncIterator<T>;
  private readonly cached: T[] = [];
  private exhausted = false;

  constructor(source: AsyncIterable<T> | AsyncIterator<T>) {
    this.source = (Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source) as AsyncIterator<T>;
  }

  async at(index: number): Promise<T | undefined> {
    while (!this.exhausted && this.cached.length <= index) {
      const next = await this.source.next();
      if (next.done) {
        this.exhausted = true;
        break;
      }
      this.cached.push(next.value);
    }
    return this.cached[index];
  }

  async length(): Promise<number> {
    await this.generateAll();
    return this.cached.length;
  }

  async toArray(): Promise<T[]> {
    await this.generateAll();
    return [...this.cached];
  }

  async generateAll(): Promise<void> {
    while (!this.exhausted) {
      const next = await this.source.next();
      if (next.done) {
        this.exhausted = true;
        break;
      }
      this.cached.push(next.value);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let i = 0;
    while (true) {
      const item = await this.at(i);
      if (item === undefined && this.exhausted && i >= this.cached.length) return;
      if (item === undefined) return;
      yield item;
      i++;
    }
  }
}
