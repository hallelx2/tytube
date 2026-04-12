// JavaScript object/array parser. Mirrors pytube/parser.py.
// Used by extract.ts and cipher.ts to slice JS source out of base.js
// and watch HTML by walking balanced braces, brackets, strings, and regex literals.

import { HTMLParseError } from './exceptions.js';

const CONTEXT_CLOSERS: Record<string, string> = {
  '{': '}',
  '[': ']',
  '"': '"',
  '/': '/', // javascript regex
};

const REGEX_PRECEDING_CHARS: ReadonlySet<string> = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';',
]);

/**
 * Walks `html` from `startPoint` and returns the substring containing the
 * fully balanced JS object/array starting there. Properly tracks string and
 * regex contexts so braces inside strings don't break balancing.
 */
export function findObjectFromStartpoint(source: string, startPoint: number): string {
  const html = source.slice(startPoint);
  const first = html[0];
  if (first !== '{' && first !== '[') {
    throw new HTMLParseError(`Invalid start point. Start of HTML:\n${html.slice(0, 20)}`);
  }

  const stack: string[] = [first];
  let lastChar: string | null = '{';
  let currChar: string | null = null;
  let i = 1;

  while (i < html.length) {
    if (stack.length === 0) break;

    if (currChar !== null && currChar !== ' ' && currChar !== '\n') {
      lastChar = currChar;
    }
    currChar = html[i] ?? null;
    if (currChar === null) break;
    const currContext = stack[stack.length - 1]!;

    // Closing the current context
    if (currChar === CONTEXT_CLOSERS[currContext]) {
      stack.pop();
      i += 1;
      continue;
    }

    if (currContext === '"' || currContext === '/') {
      // Inside a string or regex literal: skip escaped chars
      if (currChar === '\\') {
        i += 2;
        continue;
      }
    } else {
      // Outside of string/regex: opening chars push a new context
      if (currChar in CONTEXT_CLOSERS) {
        const isRegexLike =
          currChar === '/' && (lastChar === null || !REGEX_PRECEDING_CHARS.has(lastChar));
        if (!isRegexLike) {
          stack.push(currChar);
        }
      }
    }

    i += 1;
  }

  return html.slice(0, i);
}

/**
 * Find the JS object preceded by `precedingRegex` and return its string form.
 */
export function parseForObjectString(html: string, precedingRegex: RegExp): string {
  const match = precedingRegex.exec(html);
  if (!match) throw new HTMLParseError(`No matches for regex ${precedingRegex}`);
  const startIndex = match.index + match[0].length;
  return findObjectFromStartpoint(html, startIndex);
}

/**
 * Find the object string and JSON.parse it. Returns the parsed JS value.
 */
export function parseForObject<T = unknown>(html: string, precedingRegex: RegExp): T {
  const objectString = parseForObjectString(html, precedingRegex);
  try {
    return JSON.parse(objectString) as T;
  } catch (err) {
    throw new HTMLParseError(`Could not parse object: ${(err as Error).message}`);
  }
}

/**
 * Find every JS object preceded by `precedingRegex` (used to harvest ytcfg, etc.).
 */
export function parseForAllObjects<T = unknown>(html: string, precedingRegex: RegExp): T[] {
  const flags = precedingRegex.flags.includes('g') ? precedingRegex.flags : `${precedingRegex.flags}g`;
  const re = new RegExp(precedingRegex.source, flags);
  const out: T[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const startIndex = match.index + match[0].length;
    try {
      const objStr = findObjectFromStartpoint(html, startIndex);
      out.push(JSON.parse(objStr) as T);
    } catch {
      // Some matches won't be valid objects (e.g., ytcfg.set has both); skip.
      continue;
    }
    // Avoid infinite loop on zero-length matches
    if (re.lastIndex === match.index) re.lastIndex++;
  }
  if (out.length === 0) {
    throw new HTMLParseError(`No matches for regex ${precedingRegex}`);
  }
  return out;
}

/**
 * Splits the YouTube throttling array (the `c=[...]` array inside the n-function).
 * Mirrors pytube/parser.throttling_array_split — function literals can contain
 * commas, so a naive split won't work; we use brace balancing for them.
 */
export function throttlingArraySplit(jsArray: string): string[] {
  const results: string[] = [];
  let curr = jsArray.slice(1); // skip leading [
  // Strip the trailing ] if present
  if (curr.endsWith(']')) curr = curr.slice(0, -1);

  const funcRegex = /function\([^)]*\)/;

  while (curr.length > 0) {
    if (curr.startsWith('function')) {
      const match = funcRegex.exec(curr);
      if (!match) break;
      const matchEnd = match.index + match[0].length;
      // Find the function body which begins right after the )
      const functionBody = findObjectFromStartpoint(curr, matchEnd);
      const fullFunctionDef = curr.slice(0, matchEnd + functionBody.length);
      results.push(fullFunctionDef);
      // +1 to skip the comma separator (or trailing edge)
      curr = curr.slice(fullFunctionDef.length + 1);
    } else {
      const commaIdx = curr.indexOf(',');
      if (commaIdx === -1) {
        results.push(curr);
        break;
      }
      results.push(curr.slice(0, commaIdx));
      curr = curr.slice(commaIdx + 1);
    }
  }

  return results;
}
