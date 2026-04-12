// Signature & throttling-parameter cipher decryption.
//
// Strategy: instead of porting pytube's regex-mapped Python transforms (which
// is fragile and breaks every time YouTube ships a base.js update), we extract
// the *original* JavaScript function source out of base.js and execute it
// directly via the `Function()` constructor. We're already running inside a
// JavaScript runtime — we should use it.
//
// The fallback path (cipher-fallback.ts) reimplements the regex approach for
// runtimes that block `Function()` / eval (Cloudflare Workers, strict CSP).

import { ExtractError, RegexMatchError } from './exceptions.js';
import { findObjectFromStartpoint } from './parser.js';
import type { CipherLike } from './cipher-types.js';

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- Function-name extraction ----------

// Patterns ordered by reliability — most modern / specific first.
// Updated against late-2024/2025 base.js where the cipher call site has
// drifted to: c&&a.set(b,encodeURIComponent(decodeURIComponent(SIG_FN(...))))
// or: function(a){a=a.split("");...}
const SIGNATURE_FUNCTION_PATTERNS: RegExp[] = [
  // Most reliable: the function literally splits its arg into a char array.
  // This is the core fingerprint of every YouTube cipher function.
  /(?:\b|[^a-zA-Z0-9$])([a-zA-Z0-9$_]{1,3})\s*=\s*function\(\s*a\s*\)\s*\{\s*a\s*=\s*a\.split\(\s*""\s*\)/,
  /(?:\b|[^a-zA-Z0-9$])([a-zA-Z0-9$_]{1,4})\s*=\s*function\(\s*a\s*\)\s*\{\s*a\s*=\s*a\.split\(\s*""\s*\)/,
  /([a-zA-Z0-9$_]+)\s*=\s*function\(\s*a\s*\)\s*\{\s*a\s*=\s*a\.split\(\s*""\s*\)/,
  // Function-statement form: function NAME(a){a=a.split("")...}
  /function\s+([a-zA-Z0-9$_]+)\s*\(\s*a\s*\)\s*\{\s*a\s*=\s*a\.split\(\s*""\s*\)/,
  // Older / call-site forms (kept as fallbacks).
  /(["'])signature\1\s*,\s*([a-zA-Z0-9$_]+)\(/,
  /\.sig\|\|([a-zA-Z0-9$_]+)\(/,
  /\b[cs]\s*&&\s*[adf]\.set\([^,]+\s*,\s*encodeURIComponent\s*\(\s*([a-zA-Z0-9$_]+)\(/,
  /\b[a-zA-Z0-9]+\s*&&\s*[a-zA-Z0-9]+\.set\([^,]+\s*,\s*encodeURIComponent\s*\(\s*([a-zA-Z0-9$_]+)\(/,
  /yt\.akamaized\.net\/\)\s*\|\|\s*.*?\s*[cs]\s*&&\s*[adf]\.set\([^,]+\s*,\s*(?:encodeURIComponent\s*\()?\s*([a-zA-Z0-9$_]+)\(/,
  /\b[cs]\s*&&\s*[adf]\.set\([^,]+\s*,\s*([a-zA-Z0-9$_]+)\(/,
  /\b[a-zA-Z0-9]+\s*&&\s*[a-zA-Z0-9]+\.set\([^,]+\s*,\s*([a-zA-Z0-9$_]+)\(/,
  /\bc\s*&&\s*a\.set\([^,]+\s*,\s*\([^)]*\)\s*\(\s*([a-zA-Z0-9$_]+)\(/,
  /\bc\s*&&\s*[a-zA-Z0-9]+\.set\([^,]+\s*,\s*\([^)]*\)\s*\(\s*([a-zA-Z0-9$_]+)\(/,
];

// JS built-ins / globals that obfuscation patterns sometimes pick up by mistake.
// If a regex captures one of these, skip the candidate and keep searching.
const FORBIDDEN_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  'decodeURIComponent',
  'encodeURIComponent',
  'JSON',
  'Math',
  'Object',
  'String',
  'Number',
  'Array',
  'parseInt',
  'parseFloat',
  'function',
  'return',
  'typeof',
  'undefined',
  'null',
  'true',
  'false',
]);

function isPlausibleFunctionName(name: string): boolean {
  if (!name) return false;
  if (!/^[a-zA-Z0-9$_]+$/.test(name)) return false;
  if (FORBIDDEN_FUNCTION_NAMES.has(name)) return false;
  // Modern obfuscated names are short (1–6 chars). Anything longer is almost
  // certainly a builtin or a different identifier we picked up by accident.
  if (name.length > 8) return false;
  return true;
}

export function getInitialFunctionName(js: string): string {
  for (const pattern of SIGNATURE_FUNCTION_PATTERNS) {
    // Use a global form so we can iterate every match for a given pattern,
    // not just the first — sometimes the first hit is a builtin and a later
    // hit is the real obfuscated name.
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = globalPattern.exec(js)) !== null) {
      for (let i = 1; i < m.length; i++) {
        const candidate = m[i];
        if (candidate && isPlausibleFunctionName(candidate)) return candidate;
      }
      if (globalPattern.lastIndex === m.index) globalPattern.lastIndex++;
    }
  }
  throw new RegexMatchError('getInitialFunctionName', 'multiple');
}

export function getThrottlingFunctionName(js: string): string {
  const pattern =
    /a\.[a-zA-Z]\s*&&\s*\([a-z]\s*=\s*a\.get\("n"\)\)\s*&&\s*\([a-z]\s*=\s*([a-zA-Z0-9$]+)(\[\d+\])?\([a-z]\)/;
  const m = pattern.exec(js);
  if (!m) throw new RegexMatchError('getThrottlingFunctionName', pattern);

  const fnName = m[1]!;
  const idxRaw = m[2];
  if (!idxRaw) return fnName;

  // Function is referenced via array indexing: e.g. `Bpa[0](b)`. Find the
  // declaration `var Bpa=[iha,...]` and pick the right element.
  const idx = parseInt(idxRaw.replace(/\[|\]/g, ''), 10);
  const arrRegex = new RegExp(`var\\s+${escapeRegex(fnName)}\\s*=\\s*\\[(.+?)\\];`);
  const arrMatch = arrRegex.exec(js);
  if (!arrMatch) return fnName;
  const elements = arrMatch[1]!.split(',').map((s) => s.trim());
  return elements[idx] ?? fnName;
}

// ---------- JS source slicing ----------

function extractHelperObjectVarName(js: string, sigFuncName: string): string {
  // Find the signature function body and grab the first `\w+\.` reference.
  const fnBody = extractSignatureFunctionBody(js, sigFuncName);
  const m = /(?:^|;|\{)\s*([a-zA-Z0-9$_]+)\s*\.\s*[a-zA-Z0-9$_]+\s*\(/.exec(fnBody);
  if (!m) throw new RegexMatchError('extractHelperObjectVarName', /(\w+)\./);
  return m[1]!;
}

function extractSignatureFunctionBody(js: string, sigFuncName: string): string {
  const headerRegex = new RegExp(
    `(?:var\\s+)?${escapeRegex(sigFuncName)}\\s*=\\s*function\\s*\\(\\s*([a-zA-Z0-9_$]+)\\s*\\)\\s*`,
  );
  const m = headerRegex.exec(js);
  if (!m) {
    // Some base.js declares as `function name(a){...}`
    const altRegex = new RegExp(
      `function\\s+${escapeRegex(sigFuncName)}\\s*\\(\\s*([a-zA-Z0-9_$]+)\\s*\\)\\s*`,
    );
    const m2 = altRegex.exec(js);
    if (!m2) throw new RegexMatchError('extractSignatureFunctionBody', headerRegex);
    return findObjectFromStartpoint(js, m2.index + m2[0].length);
  }
  return findObjectFromStartpoint(js, m.index + m[0].length);
}

function extractSignatureFunctionFullSource(
  js: string,
  sigFuncName: string,
): { argName: string; body: string } {
  const headerRegex = new RegExp(
    `(?:var\\s+)?${escapeRegex(sigFuncName)}\\s*=\\s*function\\s*\\(\\s*([a-zA-Z0-9_$]+)\\s*\\)\\s*`,
  );
  let m = headerRegex.exec(js);
  let argName: string | undefined;
  let bodyStart: number | undefined;
  if (m) {
    argName = m[1]!;
    bodyStart = m.index + m[0].length;
  } else {
    const altRegex = new RegExp(
      `function\\s+${escapeRegex(sigFuncName)}\\s*\\(\\s*([a-zA-Z0-9_$]+)\\s*\\)\\s*`,
    );
    const m2 = altRegex.exec(js);
    if (!m2) throw new RegexMatchError('extractSignatureFunctionFullSource', headerRegex);
    argName = m2[1]!;
    bodyStart = m2.index + m2[0].length;
  }
  const body = findObjectFromStartpoint(js, bodyStart);
  return { argName, body };
}

function extractHelperObjectSource(js: string, varName: string): string {
  const re = new RegExp(`var\\s+${escapeRegex(varName)}\\s*=\\s*`);
  const m = re.exec(js);
  if (!m) throw new RegexMatchError('extractHelperObjectSource', re);
  return findObjectFromStartpoint(js, m.index + m[0].length);
}

function extractThrottlingFunctionSource(
  js: string,
  fnName: string,
): { argName: string; body: string } {
  const headerRegex = new RegExp(
    `(?:var\\s+)?${escapeRegex(fnName)}\\s*=\\s*function\\s*\\(\\s*([a-zA-Z0-9_$]+)\\s*\\)\\s*`,
  );
  const m = headerRegex.exec(js);
  if (!m) {
    const altRegex = new RegExp(
      `function\\s+${escapeRegex(fnName)}\\s*\\(\\s*([a-zA-Z0-9_$]+)\\s*\\)\\s*`,
    );
    const m2 = altRegex.exec(js);
    if (!m2) throw new RegexMatchError('extractThrottlingFunctionSource', headerRegex);
    return { argName: m2[1]!, body: findObjectFromStartpoint(js, m2.index + m2[0].length) };
  }
  return { argName: m[1]!, body: findObjectFromStartpoint(js, m.index + m[0].length) };
}

// ---------- Eval-based cipher ----------

export class JsExecCipher implements CipherLike {
  private readonly sigFn: (input: string) => string;
  private readonly nFn: (input: string) => string;
  private cachedN: { input: string; output: string } | null = null;

  constructor(js: string) {
    const sigName = getInitialFunctionName(js);
    const helperVar = extractHelperObjectVarName(js, sigName);
    const helperSrc = extractHelperObjectSource(js, helperVar);
    const { argName: sigArg, body: sigBody } = extractSignatureFunctionFullSource(js, sigName);

    try {
      this.sigFn = new Function(
        'input',
        `var ${helperVar} = ${helperSrc};
         var ${sigName} = function(${sigArg}) ${sigBody};
         return ${sigName}(input);`,
      ) as (s: string) => string;
    } catch (err) {
      throw new ExtractError(`Failed to compile signature function: ${(err as Error).message}`);
    }

    const nName = getThrottlingFunctionName(js);
    const { argName: nArg, body: nBody } = extractThrottlingFunctionSource(js, nName);

    try {
      this.nFn = new Function(
        'input',
        `var ${nName} = function(${nArg}) ${nBody};
         return ${nName}(input);`,
      ) as (s: string) => string;
    } catch (err) {
      throw new ExtractError(`Failed to compile throttling function: ${(err as Error).message}`);
    }
  }

  getSignature(cipheredSignature: string): string {
    return this.sigFn(cipheredSignature);
  }

  calculateN(initialN: string): string {
    if (this.cachedN && this.cachedN.input === initialN) return this.cachedN.output;
    const out = this.nFn(initialN);
    this.cachedN = { input: initialN, output: out };
    return out;
  }
}

// ---------- Runtime selection ----------

const canEval: boolean = (() => {
  try {
    new Function('return 1')();
    return true;
  } catch {
    return false;
  }
})();

export function createCipher(js: string): CipherLike {
  if (canEval) return new JsExecCipher(js);
  // Lazy-import the fallback so eval-blocked runtimes never load this constructor.
  // (Top-level static import is fine here because the module itself doesn't
  // call new Function at import time.)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  throw new ExtractError(
    'eval is not available in this runtime; use the regex-port fallback (cipher-fallback.ts).',
  );
}

export { canEval };
